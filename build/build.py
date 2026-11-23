#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) de VENDAS por trafego direto do funil
"Trader Lucrativo" (campanhas DTL) a partir de DUAS planilhas do Google Sheets
(somente leitura):

  - "QUERIES TDL META" (gid 0): investimento/impressoes/cliques/views da pagina/
    checkouts/alcance do gerenciador (Meta Ads), uma linha por
    dia x campanha x conjunto x anuncio.
  - "Base [Applications] [UTMs]", aba "hotmart" (gid 1313255428): cada linha e um
    evento de compra da Hotmart (APPROVED/COMPLETED/...) com produto, valor e UTMs
    (colunas UTM Source/Medium/Campaign/Content + SCK).

VENDA VALIDA — ver sale_status_kind()/process():
  1. status aprovado (APPROVED/COMPLETED); reembolso/chargeback/cancelamento
     anulam a compra correspondente;
  2. nao e teste (produto "test postback", e-mail de teste);
  3. deduplicada: a Hotmart grava a MESMA compra 2x (APPROVED + COMPLETED, mesmo
     horario) -> 1 compra = (e-mail, produto, dia).
  4. Produto PRINCIPAL ("Trader Lucrativo") entra sempre (todas as origens);
     outros produtos (DNA Expert, Sala...) so entram como BACK-END quando a UTM
     e de uma campanha DTL (Meta Ads).

CRUZAMENTO vendas x Meta Ads (a UTM mudou de formato ao longo do tempo):
  - formato NOME (desde 14/11/2026):
      s=Meta-Ads | m=<conjunto> | c=<campanha> | co=<anuncio> | t=<posicionamento> | utm_id=<ID campanha>
    -> casamento EXATO por Campanha + Conjunto + Anuncio.
  - formato ID (antes de 14/11/2026):
      m=paid | s=<ig/fb/an> | utm_id=<ID campanha> | co=<ID> | t=<ID> | c=<ID campanha>
    -> a aba de Queries NAO tem colunas de ID, entao: a campanha e resolvida pelo
       mapa ID->nome APRENDIDO das vendas que trazem os dois (formato nome) +
       CAMPAIGN_ID_MAP manual; conjunto/anuncio so se a aba de Queries ganhar as
       colunas "Campaign ID / Ad Set ID / Ad ID" (detectadas automaticamente).
  A aba "Otimizacao" rateia as vendas sem anuncio identificado entre os anuncios
  pelo volume de checkouts do Meta no mesmo dia (estimativa, sempre rotulada).

Este script apenas LE as planilhas (export CSV publico) e emite os REGISTROS
BRUTOS (sales[] e meta[]) dentro do HTML. Filtros, agregacoes, KPIs, tabelas,
graficos, imposto e o rateio sao calculados no navegador. Nunca escreve nada de volta.

Teste local: --vendas-file / --meta-file apontando para CSVs baixados.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

# Meta Ads — "QUERIES TDL META", aba "QUERIES META TRADER LUCRATIVO".
SPREADSHEET_ID_META = "1i2qU4Xwfy3M1bpThUyh7A8C4e5dGrbILPss_okqq-7E"
GID_META = "0"
# Vendas — "Base [Applications] [UTMs]", aba "hotmart".
SPREADSHEET_ID_VENDAS = "1_Er3ILbAY4ntIWL6Dxw_bvqDSqDfl36yAquz_RkbBOE"
GID_VENDAS = "1313255428"
SHEET_NAME_VENDAS = "hotmart"   # fallback (gviz por NOME) se o gid nao trouxer as colunas de venda
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
GVIZ_URL = "https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&sheet={sheet}"

# Identificação do cliente/conta (textos da página).
CLIENT_NAME = "Hermann Greb"
MAIN_PRODUCT = "Trader Lucrativo · Vendas"
# Produto PRINCIPAL (front-end): nome do produto na Hotmart CONTÉM este texto.
MAIN_PRODUCT_MATCH = "trader lucrativo"
MAIN_PRODUCT_SHORT = "Trader Lucrativo"
# Funil de produtos (por COMPRADOR): front -> upsell -> (se recusar) downsell. Tudo que o comprador do
# front compra depois e não é upsell/downsell vira LTV (ex.: Sala Educacional), fora do ROAS do funil.
UPSELL_MATCH = ("dna expert 6",)      # DNA Expert 6 meses (R$ 697) — upsell
DOWNSELL_MATCH = ("dna expert 3",)    # DNA Expert 3 meses (R$ 397) — downsell
ROLE_LABELS = {"front": "Front", "up": "Upsell", "down": "Downsell", "ltv": "LTV"}
LINK_TOLERANCE_MIN = 10               # upsell gravado até 10 min ANTES do front ainda conta como do mesmo comprador
# Prefixo comum a TODAS as campanhas do funil:  DTL | E6-VEN | P2-FRIO | CONV | ABO | 2026-10-18 | Teste de Ads
MAIN_PRODUCT_PREFIX = "DTL"

# Mapa MANUAL de ID de campanha -> nome (opcional). O build já aprende sozinho o
# mapa a partir das vendas que trazem ID + nome na UTM; use isto só para IDs que
# aparecem apenas no formato antigo (só ID). Ex.: {"120253321018810236": "DTL | ... | Teste de VSL ABERTA"}
#   120253321018810236 -> VSL ABERTA: deduzido em 19/11/2026 — das 6 campanhas, só VSL ABERTA e VSL
#   FECHADA tinham gasto nos 16 dias com venda desse ID, e a FECHADA já tem ID próprio (120253321291190236).
CAMPAIGN_ID_MAP: dict[str, str] = {
    "120253321018810236": "DTL | E6-VEN | P2-FRIO | CONV | ABO | 2026-10-12 | Teste de VSL ABERTA",
}

# --------------------------------------------------------------------------- #
# Fusos horarios — "Data" da Hotmart vem no horario de Brasilia (sem offset) e o
# "Day" do Meta Ads ja vem fechado no fuso da conta.
LEADS_TZ_NAME = "America/Sao_Paulo"
ACCOUNT_TZ_NAME = "America/Sao_Paulo"
try:
    from zoneinfo import ZoneInfo
    ACCOUNT_TZ = ZoneInfo(ACCOUNT_TZ_NAME)
except Exception:
    ACCOUNT_TZ = timezone(timedelta(hours=-3))

BRT = timezone(timedelta(hours=-3))   # carimbo "ultima atualizacao"
TAX_FACTOR = 1.13806   # imposto sobre o gasto de mídia paga (Meta Ads) = 13,806%.
                       # Toggle "Imposto Meta" já vem LIGADO (app.js STATE.tax=true).

# --------------------------------------------------------------------------- #
# Regras de decisão (abas Otimização e Insights de IA)
# --------------------------------------------------------------------------- #
SAMPLE_MIN_SPEND = 150.0   # gasto mínimo (R$, sem imposto) p/ JULGAR um anúncio
SAMPLE_MIN_VENDAS = 2      # vendas mínimas p/ julgar com segurança
TOP_ADS_N = 10
# Metas & parâmetros (DEFAULTS do painel editável; o gestor edita no navegador).
META_CPA = None            # CPA alvo (R$/venda do front). None = usa o CPA de EQUILÍBRIO do funil
                           # (ticket médio front+upsell+downsell por comprador, calculado no navegador).
META_ROAS = None           # ROAS alvo (x) — opcional, só referência visual
VOLUME_MIN_AMOSTRAL = SAMPLE_MIN_VENDAS
N_DIAS_CORTE = 3

# --------------------------------------------------------------------------- #
# Leitura
# --------------------------------------------------------------------------- #
FETCH_RETRIES = 3
FETCH_RETRY_DELAY = 15


def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "dash-vendas-bot/1.0"})
    last_err: Exception | None = None
    for attempt in range(1, FETCH_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            return list(csv.reader(io.StringIO(raw)))
        except (TimeoutError, urllib.error.URLError) as exc:
            last_err = exc
            if attempt < FETCH_RETRIES:
                print(f"[fetch_csv] tentativa {attempt}/{FETCH_RETRIES} falhou ({exc!r}); "
                      f"tentando de novo em {FETCH_RETRY_DELAY}s...", file=sys.stderr)
                time.sleep(FETCH_RETRY_DELAY)
    raise last_err


def read_csv_file(path: str) -> list[list[str]]:
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        return list(csv.reader(f))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    return strip_accents((s or "").strip().lower())


def nkey(s: str | None) -> str:
    """Chave de casamento de nomes: minúsculo, sem acento, espaços colapsados."""
    return re.sub(r"\s+", " ", norm(s))


def to_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v).strip())
    if not s:
        return 0.0
    if "," in s and "." in s:
        # o ÚLTIMO separador é o decimal ("1.397,00" ou "1,397.00")
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(v: str) -> str | None:
    """Dia do "Day" do Meta Ads (já no fuso da conta)."""
    if not v:
        return None
    s = str(v).strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    s = s.split()[0] if s else s
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


_DT_RE = re.compile(r"^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?")


def detect_dmy(values: list[str]) -> bool:
    """A planilha pode estar em pt-BR (dd/mm) ou en-US (mm/dd). Decide pela coluna inteira."""
    dmy = mdy = 0
    for v in values:
        m = _DT_RE.match((v or "").strip())
        if not m or len(m.group(1)) == 4:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12:
            dmy += 1
        elif b > 12:
            mdy += 1
    return dmy >= mdy


def parse_sale_dt(v: str, dmy: bool) -> datetime | None:
    s = (v or "").strip()
    if not s:
        return None
    try:   # ISO (com ou sem offset)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(ACCOUNT_TZ).replace(tzinfo=None)
        return dt
    except ValueError:
        pass
    m = _DT_RE.match(s)
    if not m:
        return None
    p1, p2, p3 = m.group(1), m.group(2), m.group(3)
    hh, mi, ss = int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0)
    try:
        if len(p1) == 4:
            y, mo, d = int(p1), int(p2), int(p3)
        else:
            y = int(p3) + (2000 if len(p3) == 2 else 0)
            d, mo = (int(p1), int(p2)) if dmy else (int(p2), int(p1))
        return datetime(y, mo, d, hh, mi, ss)
    except ValueError:
        return None


def first_last_initial(name: str) -> str:
    parts = (name or "").strip().split()
    if not parts:
        return "—"
    first = parts[0].capitalize() if parts[0].isupper() else parts[0]
    return first if len(parts) == 1 else f"{first} {parts[-1][:1].upper()}."


def mask_email(e: str) -> str:
    e = (e or "").strip()
    if "@" not in e:
        return "—"
    user, dom = e.split("@", 1)
    keep = user[:2] if len(user) > 2 else user[:1]
    return f"{keep}****@{dom.lower()}"


def mask_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")
    return f"…{digits[-4:]}" if len(digits) >= 4 else "—"


# --------------------------------------------------------------------------- #
# Indexacao das colunas
# --------------------------------------------------------------------------- #
def header_index(header, wanted, fallback):
    """1º passe: nome exato (normalizado); 2º passe: cabeçalho que CONTÉM o alias."""
    idx = {}
    hn = [norm(h) for h in header]
    for key, aliases in wanted.items():
        found = None
        for a in aliases:
            a = norm(a)
            for i, h in enumerate(hn):
                if h == a:
                    found = i
                    break
            if found is not None:
                break
        if found is None:
            for a in aliases:
                a = norm(a)
                for i, h in enumerate(hn):
                    if a and a in h:
                        found = i
                        break
                if found is not None:
                    break
        idx[key] = found if found is not None else fallback.get(key)
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


# --------------------------------------------------------------------------- #
# UTM — parser dos 3 formatos que existem na planilha
# --------------------------------------------------------------------------- #
_ID_RE = re.compile(r"^\d{15,20}$")
_KV_KEYS = r"(?:utm_[a-z]+|s|m|c|co|t)"
_KV_SPLIT = re.compile(r"\|(?=" + _KV_KEYS + r"=)")
_KV_ITEM = re.compile(r"^(" + _KV_KEYS + r")=(.*)$", re.S)
_POS_SPLIT = re.compile(r"(?<! )\|(?! )")        # "a|b | c|d": só corta pipe SEM espaço em volta
_META_SOURCES = ("meta-ads", "meta ads", "facebook-ads", "facebook ads", "facebook_ads", "meta", "fb ads")
_PLAT = {"ig": "Instagram", "instagram": "Instagram", "fb": "Facebook", "facebook": "Facebook",
         "an": "Audience Network", "audience_network": "Audience Network", "msg": "Messenger",
         "messenger": "Messenger", "th": "Threads", "threads": "Threads"}
_JUNK_ADSET = {"paid", "social", "bio", "cpc", "auto", "video", "descricao", "trafego", "email"}


def is_id(v: str | None) -> bool:
    return bool(v) and bool(_ID_RE.match(str(v).strip()))


def parse_kv(s: str) -> dict:
    out = {}
    for part in _KV_SPLIT.split(s or ""):
        m = _KV_ITEM.match(part.strip())
        if m:
            out.setdefault(m.group(1), m.group(2).strip())
    return out


def utm_fields(sck: str, src: str, med: str, camp: str, cont: str) -> dict:
    """Normaliza a UTM em {source, medium, campaign, content, term, cid}.
    1º o SCK (string completa e estável), depois as colunas UTM."""
    f = {"source": "", "medium": "", "campaign": "", "content": "", "term": "", "cid": ""}
    sck = (sck or "").strip()
    kv = parse_kv(sck) if re.search(r"(^|\|)" + _KV_KEYS + "=", sck) else {}
    if kv:
        f["source"] = kv.get("s", kv.get("utm_source", ""))
        f["medium"] = kv.get("m", kv.get("utm_medium", ""))
        f["campaign"] = kv.get("c", kv.get("utm_campaign", ""))
        f["content"] = kv.get("co", kv.get("utm_content", ""))
        f["term"] = kv.get("t", kv.get("utm_term", ""))
        f["cid"] = kv.get("utm_id", "")
    elif sck and "|" in sck:
        # formato posicional antigo: source|medium|campaign|content|term
        parts = [p.strip() for p in _POS_SPLIT.split(sck)]
        for k, v in zip(("source", "medium", "campaign", "content", "term"), parts):
            f[k] = v
    elif sck:
        f["source"] = sck
    # completa com as colunas UTM (que às vezes vêm "s=..."/"utm_id=..." deslocadas)
    cols = {"source": src, "medium": med, "campaign": camp, "content": cont}
    for k, v in cols.items():
        v = (v or "").strip()
        if not v:
            continue
        m = _KV_ITEM.match(v)
        if m and "{" not in v:
            key = {"s": "source", "m": "medium", "c": "campaign", "co": "content", "t": "term",
                   "utm_id": "cid"}.get(m.group(1), k)
            if not f.get(key):
                f[key] = m.group(2).strip()
        elif not f.get(k):
            f[k] = v
    # "ig_paid_<campanha>_<conjunto>_<anuncio>"
    mm = re.search(r"_paid_(\d{15,20})_(\d{15,20})_(\d{15,20})", " ".join(f.values()))
    if mm and not f["cid"]:
        f["cid"] = mm.group(1)
    if not f["cid"] and is_id(f["campaign"]):
        f["cid"] = f["campaign"].strip()
    return f


def classify_source(f: dict) -> str:
    blob = norm(" ".join(v for v in f.values() if v))
    if not blob:
        return "sem_utm"
    srcn, medn = norm(f["source"]), norm(f["medium"])
    # "paid_metaads", "meta_ads", "fb_paid"...: token "paid" ou "metaads" na origem = tráfego pago do Meta
    paid_tok = bool(re.search(r"(^|[_\-\s])paid([_\-\s]|$)", srcn)) or "metaads" in re.sub(r"[_\-\s]", "", srcn)
    if (f["cid"] or "paid" in (srcn, medn) or paid_tok or srcn in _META_SOURCES or srcn.startswith("facebook-ads")
            or srcn.startswith("meta-ads") or "_paid_" in blob
            or norm(f["campaign"]).startswith(norm(MAIN_PRODUCT_PREFIX) + " |")):
        return "meta"
    if "hotmart" in blob or "new_club" in blob:
        return "hotmart"
    return "organico"


def platform_of(f: dict) -> tuple[str, str | None]:
    """(plataforma, posicionamento). s=ig/fb no formato ID; t=Instagram_Feed no formato nome."""
    term = (f["term"] or "").strip()
    pos = None
    if term and not is_id(term) and re.match(r"^(instagram|facebook|audience|messenger|threads|an_|fb_|ig_)", term, re.I):
        pos = term.replace("_", " ")
    s = norm(f["source"])
    plat = _PLAT.get(s)
    if not plat and pos:
        p0 = norm(pos).split()[0]
        plat = {"instagram": "Instagram", "facebook": "Facebook", "audience": "Audience Network",
                "messenger": "Messenger", "threads": "Threads"}.get(p0)
    return plat or "Não informado", pos


# --------------------------------------------------------------------------- #
# Status / teste
# --------------------------------------------------------------------------- #
_OK_STATUS = {"approved", "completed", "aprovado", "completo", "complete", "paid", "pago"}
_RF_STATUS = {"refunded", "chargeback", "cancelled", "canceled", "cancelado", "reembolsado",
              "protested", "dispute", "disputa", "estornado"}
_TEST_EMAIL_DOMAINS = ("teste.com", "test.com", "example.com")


def sale_status_kind(st: str) -> str | None:
    s = norm(st)
    if s in _OK_STATUS:
        return "ok"
    if s in _RF_STATUS:
        return "rf"
    return None


def is_test_sale(product: str, name: str, email: str) -> bool:
    if "test" in norm(product) and "postback" in norm(product):
        return True
    e = norm(email)
    if "@" in e and e.split("@", 1)[1] in _TEST_EMAIL_DOMAINS:
        return True
    first = (norm(name).split() or [""])[0]
    return bool(re.match(r"^(teste|test)\d*$", first))


def product_role(p: str) -> str:
    n = norm(p)
    if norm(MAIN_PRODUCT_MATCH) in n:
        return "front"
    if any(m in n for m in UPSELL_MATCH):
        return "up"
    if any(m in n for m in DOWNSELL_MATCH):
        return "down"
    return "ltv"


def product_short(p: str) -> str:
    s = (p or "").strip()
    if norm(MAIN_PRODUCT_MATCH) in norm(s):
        return MAIN_PRODUCT_SHORT
    return s or "Não informado"


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
def process(vendas_rows, meta_rows):
    # ---- Meta Ads (Queries) ----
    mheader = meta_rows[0] if meta_rows else []
    midx = header_index(
        mheader,
        {"day": ["day", "data", "date"], "campaign": ["campaign name", "campanha"],
         "adset": ["ad set name", "adset name", "conjunto"], "ad": ["ad name", "anuncio"],
         "spent": ["amount spent", "valor gasto", "gasto", "spend"], "impr": ["impressions", "impressoes"],
         "clicks": ["link clicks", "cliques no link"], "lpv": ["landing page views", "visualizacoes da pagina"],
         "ic": ["checkouts initiated", "initiate checkout", "finalizacoes de compra iniciadas"],
         "reach": ["reach", "alcance"],
         # opcionais — se a query ganhar estas colunas o casamento por ID fica completo
         "camp_id": ["campaign id", "id da campanha"], "adset_id": ["ad set id", "adset id", "id do conjunto"],
         "ad_id": ["ad id", "id do anuncio"]},
        {"day": 0, "campaign": 1, "adset": 2, "ad": 3, "spent": 4, "impr": 5, "clicks": 6, "lpv": 7, "ic": 8, "reach": 9},
    )
    # header_index cai no "contém": "ad id" casaria com "ad set id"/"campaign id"? (não — só se exato falhar
    # e o alias estiver contido). Garante que IDs só valem se o cabeçalho tiver "id".
    for k in ("camp_id", "adset_id", "ad_id"):
        i = midx.get(k)
        if i is None or i >= len(mheader) or "id" not in norm(mheader[i]).split():
            midx[k] = None
    print(f"  [meta] colunas mapeadas: {midx}", file=sys.stderr)

    meta = []
    camps: dict[str, str] = {}                     # nkey -> nome canônico
    adsets: dict[tuple, str] = {}                  # (camp, nkey adset) -> nome canônico
    ads: dict[tuple, str] = {}                     # (camp, adset, nkey ad) -> nome canônico
    ad_by_name: dict[str, set] = defaultdict(set)  # nkey ad -> {(camp, adset, ad)}
    id_camp: dict[str, str] = {}
    id_adset: dict[str, tuple] = {}
    id_ad: dict[str, tuple] = {}
    for row in meta_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        day = parse_date(cell(row, midx["day"]))
        camp = cell(row, midx["campaign"])
        if not day and not camp:
            continue
        camp = camp or "(sem campanha)"
        adset = cell(row, midx["adset"]) or "(sem conjunto)"
        ad = cell(row, midx["ad"]) or "(sem anúncio)"
        camp = camps.setdefault(nkey(camp), camp)
        adset = adsets.setdefault((camp, nkey(adset)), adset)
        ad = ads.setdefault((camp, adset, nkey(ad)), ad)
        ad_by_name[nkey(ad)].add((camp, adset, ad))
        if midx["camp_id"] is not None and is_id(cell(row, midx["camp_id"])):
            id_camp[cell(row, midx["camp_id"])] = camp
        if midx["adset_id"] is not None and is_id(cell(row, midx["adset_id"])):
            id_adset[cell(row, midx["adset_id"])] = (camp, adset)
        if midx["ad_id"] is not None and is_id(cell(row, midx["ad_id"])):
            id_ad[cell(row, midx["ad_id"])] = (camp, adset, ad)
        meta.append({
            "d": day, "camp": camp, "adset": adset, "ad": ad,
            "sp": round(to_float(cell(row, midx["spent"])), 4),
            "im": to_float(cell(row, midx["impr"])),
            "cl": to_float(cell(row, midx["clicks"])),
            "lpv": to_float(cell(row, midx["lpv"])),
            "ic": to_float(cell(row, midx["ic"])),
            "rc": to_float(cell(row, midx["reach"])),
        })

    # ---- Vendas (Hotmart) ----
    vheader = vendas_rows[0] if vendas_rows else []
    vidx = header_index(
        vheader,
        {"date": ["data", "date", "data da compra"], "product": ["produto", "product"],
         "name": ["nome", "name"], "phone": ["telefone", "phone"], "email": ["email", "e-mail"],
         "u_source": ["utm source"], "u_medium": ["utm medium"], "u_campaign": ["utm campaign"],
         "u_content": ["utm content"], "status": ["status"], "value": ["faturamento", "valor", "price"],
         "sck": ["sck"]},
        {},
    )
    missing = [k for k in ("date", "product", "status", "value") if vidx.get(k) is None]
    if missing:
        raise SystemExit(f"ERRO: a aba de vendas não tem as colunas {missing}. Cabeçalho lido: {vheader}")
    print(f"  [vendas] colunas mapeadas: {vidx}", file=sys.stderr)

    dmy = detect_dmy([cell(r, vidx["date"]) for r in vendas_rows[1:]])
    events = []
    descartes = Counter()
    for row in vendas_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        kind = sale_status_kind(cell(row, vidx["status"]))
        if kind is None:
            descartes["status_nao_aprovado"] += 1
            continue
        product = cell(row, vidx["product"])
        name, email = cell(row, vidx["name"]), cell(row, vidx["email"])
        if is_test_sale(product, name, email):
            descartes["teste"] += 1
            continue
        dt = parse_sale_dt(cell(row, vidx["date"]), dmy)
        if dt is None:
            descartes["sem_data"] += 1
            continue
        f = utm_fields(cell(row, vidx["sck"]), cell(row, vidx["u_source"]), cell(row, vidx["u_medium"]),
                       cell(row, vidx["u_campaign"]), cell(row, vidx["u_content"]))
        events.append({"dt": dt, "kind": kind, "product": product, "name": name, "email": email,
                       "phone": cell(row, vidx["phone"]), "value": to_float(cell(row, vidx["value"])), "f": f})

    # ---- mapa ID de campanha -> nome, APRENDIDO das vendas que trazem os dois ----
    learned: dict[str, Counter] = defaultdict(Counter)
    for e in events:
        f = e["f"]
        if f["cid"] and f["campaign"] and not is_id(f["campaign"]):
            cn = camps.get(nkey(f["campaign"]))
            if cn:
                learned[f["cid"]][cn] += 1
    camp_id_map = {cid: c.most_common(1)[0][0] for cid, c in learned.items()}
    camp_id_map.update({k: camps.get(nkey(v), v) for k, v in CAMPAIGN_ID_MAP.items()})
    camp_id_map.update(id_camp)   # IDs da própria aba de Queries têm prioridade

    # ---- dedupe: 1 compra = (e-mail, produto, dia). Reembolso anula a compra. ----
    def info_score(f):
        return sum(1 for v in f.values() if v) + (3 if f["campaign"] and not is_id(f["campaign"]) else 0)

    buys: dict[tuple, dict] = {}
    refunds = []
    for e in sorted(events, key=lambda x: x["dt"]):
        who = norm(e["email"]) or (norm(e["name"]) + re.sub(r"\D", "", e["phone"])[-8:])
        key = (who, norm(e["product"]), e["dt"].date())
        if e["kind"] == "rf":
            refunds.append((who, norm(e["product"]), e["dt"]))
            continue
        cur = buys.get(key)
        if cur is None:
            buys[key] = dict(e, dup=0)
        else:
            cur["dup"] += 1
            if info_score(e["f"]) > info_score(cur["f"]):
                keep_dt = cur["dt"]
                cur.update(e)
                cur["dt"] = keep_dt
    refunded = 0
    for who, prod, rdt in refunds:   # anula a compra mais recente até a data do reembolso
        cand = [k for k, b in buys.items() if k[0] == who and k[1] == prod and b["dt"] <= rdt + timedelta(days=1)
                and not b.get("rf")]
        if cand:
            k = max(cand, key=lambda k: buys[k]["dt"])
            buys[k]["rf"] = 1
            refunded += 1
    dup_total = sum(b["dup"] for b in buys.values())

    # IDs de campanha do funil DTL (para decidir o que entra quando não há vínculo pelo comprador)
    dtl_ids = set(cid for cid, cn in camp_id_map.items() if nkey(cn).startswith(nkey(MAIN_PRODUCT_PREFIX)))
    for b in buys.values():
        if product_role(b["product"]) == "front" and b["f"]["cid"]:
            dtl_ids.add(b["f"]["cid"])

    def attribute(f):
        """Origem + dimensões da UTM de UMA compra (sem olhar o comprador)."""
        src = classify_source(f)
        plat, pos = platform_of(f)
        camp = adset = ad = None
        lvl = "none"
        cid = f["cid"] or None
        num_ids = [v for v in (f["content"], f["term"], f["medium"]) if is_id(v)]
        if src == "meta":
            # 1) IDs de anúncio/conjunto (se a aba de Queries tiver as colunas de ID)
            for i in num_ids:
                if i in id_ad:
                    camp, adset, ad = id_ad[i]
                    break
            if ad is None:
                for i in num_ids:
                    if i in id_adset:
                        camp, adset = id_adset[i]
                        break
            # 2) nomes (formato novo da UTM)
            if camp is None:
                cname = f["campaign"] if f["campaign"] and not is_id(f["campaign"]) else ""
                camp = camps.get(nkey(cname)) if cname else None
                if camp is None and cid:
                    camp = camp_id_map.get(cid)
            if camp is not None and adset is None:
                an = f["medium"] if f["medium"] and not is_id(f["medium"]) and norm(f["medium"]) not in _JUNK_ADSET else ""
                adset = adsets.get((camp, nkey(an))) if an else None
            if camp is not None and ad is None:
                adn = f["content"] if f["content"] and not is_id(f["content"]) else ""
                if adn:
                    if adset is not None:
                        ad = ads.get((camp, adset, nkey(adn)))
                    if ad is None:   # anúncio com nome único dentro da campanha
                        hits = [t for t in ad_by_name.get(nkey(adn), ()) if t[0] == camp]
                        if len(hits) == 1:
                            _, adset, ad = hits[0]
            if camp is None:     # campanha sem nome/ID conhecido, mas anúncio com nome único na conta
                adn = f["content"] if f["content"] and not is_id(f["content"]) else ""
                hits = list(ad_by_name.get(nkey(adn), ())) if adn else []
                if len(hits) == 1:
                    camp, adset, ad = hits[0]
            lvl = "ad" if ad else ("adset" if adset else ("camp" if camp else "none"))
        in_dtl = src == "meta" and ((camp is not None and nkey(camp).startswith(nkey(MAIN_PRODUCT_PREFIX)))
                                    or (cid in dtl_ids)
                                    or nkey(f["campaign"]).startswith(nkey(MAIN_PRODUCT_PREFIX) + " |"))
        cid_label = (f"(ID {cid})" if cid else "(campanha não identificada)") if (src == "meta" and camp is None) else None
        return {
            "src": src, "plat": plat, "pos": pos,
            "camp": camp if camp is not None else cid_label,
            "adset": adset if adset is not None else ("(não identificado)" if src == "meta" else None),
            "ad": ad if ad is not None else ("(não identificado)" if src == "meta" else None),
            "lvl": lvl if src == "meta" else None,
            "cid": cid, "ids": " · ".join(num_ids) if num_ids else None, "in_dtl": in_dtl,
        }

    _RANK = {"ad": 3, "adset": 2, "camp": 1, "none": 0}
    rank = lambda a: _RANK.get(a["lvl"], 0) if a["src"] == "meta" else -1

    # compradores do FRONT (e-mail -> compras do front em ordem)
    ordered = sorted(buys.values(), key=lambda x: x["dt"])
    attr = {id(b): attribute(b["f"]) for b in ordered}
    who_of = lambda b: norm(b["email"]) or (norm(b["name"]) + re.sub(r"\D", "", b["phone"])[-8:])
    fronts: dict[str, list] = defaultdict(list)
    for b in ordered:
        if product_role(b["product"]) == "front" and not b.get("rf"):
            fronts[who_of(b)].append(b)

    buyer_ids: dict[str, int] = {}   # id ANÔNIMO do comprador (inteiro sequencial, sem relação com o e-mail)
    sales = []
    lvl_count = Counter()
    src_count = Counter()
    role_count = Counter()
    via_count = Counter()
    ids_sem_nome = 0
    for b in ordered:
        role = product_role(b["product"])
        a = attr[id(b)]
        via = "utm"
        lag = None
        cohort_dt = None
        if role != "front":
            # vínculo pelo COMPRADOR: a compra do front mais recente até esta (tolerância de 10 min,
            # porque o upsell às vezes é gravado no mesmo minuto ou antes do front)
            prev = [x for x in fronts.get(who_of(b), ()) if x["dt"] <= b["dt"] + timedelta(minutes=LINK_TOLERANCE_MIN)]
            if prev:
                fr = prev[-1]
                fa = attr[id(fr)]
                lag = max(0, round((b["dt"] - fr["dt"]).total_seconds() / 60))
                cohort_dt = fr["dt"]
                # herda a atribuição do front, a não ser que a UTM da própria compra seja MAIS precisa
                if rank(fa) >= rank(a):
                    a = fa
                    via = "comprador"
            elif not a["in_dtl"]:
                continue   # não é do funil DTL (nem comprador do front, nem UTM de campanha DTL)
        if a["src"] == "meta" and a["lvl"] != "ad" and (a["cid"] or a["ids"]):
            ids_sem_nome += 1
        lvl_count[a["lvl"] if a["src"] == "meta" else a["src"]] += 1
        src_count[a["src"]] += 1
        role_count[role] += 1
        via_count[via] += 1
        # LTV (ex.: Sala Educacional, vendida no evento de TERÇA) entra na data do FRONT do comprador
        # (coorte): o período "Este mês" mostra o LTV de quem ENTROU no mês, mesmo que compre numa terça seguinte.
        d_attr = cohort_dt if (role == "ltv" and cohort_dt is not None) else b["dt"]
        sales.append({
            "d": d_attr.strftime("%Y-%m-%d"),
            "dp": b["dt"].strftime("%Y-%m-%d"),   # data real da compra
            "b": buyer_ids.setdefault(who_of(b), len(buyer_ids) + 1),
            "h": b["dt"].hour,
            "pr": product_short(b["product"]),
            "role": role,                       # front | up | down | ltv
            "main": 1 if role == "front" else 0,
            "via": via,                         # utm = UTM da própria compra · comprador = herdou do front
            "lag": lag,                         # minutos desde a compra do front (só não-front vinculadas)
            "v": round(b["value"], 2),
            "src": a["src"], "plat": a["plat"], "pos": a["pos"],
            # dimensões (nome canônico da aba de Queries quando casou)
            "camp": a["camp"], "adset": a["adset"], "ad": a["ad"], "lvl": a["lvl"],
            "cid": a["cid"], "ids": a["ids"],
            "rf": b.get("rf", 0),
            "nm": first_last_initial(b["name"]),
            "em": mask_email(b["email"]),
            "ph": mask_phone(b["phone"]),
        })

    dates = sorted({d for d in ([s["d"] for s in sales] + [m["d"] for m in meta if m["d"]])})
    meta_dates = sorted({m["d"] for m in meta if m["d"]})
    now_brt = datetime.now(BRT)
    hoje_conta = datetime.now(ACCOUNT_TZ)
    return {
        "build": {
            "generated_at_brt": now_brt.strftime("%d/%m/%Y %H:%M"),
            "build_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "today": hoje_conta.strftime("%Y-%m-%d"),
            "date_min": meta_dates[0] if meta_dates else (dates[0] if dates else None),
            "date_max": dates[-1] if dates else None,
            "meta_date_max": meta_dates[-1] if meta_dates else None,   # último dia na aba de Queries do Meta
            "tax_factor": TAX_FACTOR,
            "account_tz": ACCOUNT_TZ_NAME,
            "client_name": CLIENT_NAME,
            "main_product": MAIN_PRODUCT,
            "main_product_short": MAIN_PRODUCT_SHORT,
            "prefix": MAIN_PRODUCT_PREFIX,
            "sample_min_spend": SAMPLE_MIN_SPEND,
            "sample_min_vendas": SAMPLE_MIN_VENDAS,
            "top_ads_n": TOP_ADS_N,
            "meta_cpa": META_CPA,
            "meta_roas": META_ROAS,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "n_dias_corte": N_DIAS_CORTE,
            "meta_has_ids": bool(id_ad or id_adset),
            "camp_id_map": camp_id_map,
            # diagnóstico
            "descartes": dict(descartes),
            "duplicadas": dup_total,
            "reembolsos": refunded,
            "rastreio": dict(lvl_count),
            "origens": dict(src_count),
            "ids_sem_nome": ids_sem_nome,
            "papeis": dict(role_count),
            "vinculo": dict(via_count),
            "roles": ROLE_LABELS,
        },
        "sales": sales,
        "meta": meta,
        "briefings": {},
    }


# --------------------------------------------------------------------------- #
# Insights de Tráfego (aba Insights de IA)
# --------------------------------------------------------------------------- #
def load_briefings(path: str) -> dict:
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (ValueError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #
def render(data, template_path):
    base = os.path.dirname(os.path.abspath(template_path))

    def readf(name):
        with open(os.path.join(base, name), "r", encoding="utf-8") as f:
            return f.read()

    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    styles = readf("identidade-visual.css") + "\n" + readf("estilos.css")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    tpl = tpl.replace("__STYLES__", styles)
    tpl = tpl.replace("__APP_JS__", readf("app.js"))
    tpl = tpl.replace("__DATA_JSON__", payload)
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def load_vendas(local: str | None) -> list[list[str]]:
    if local:
        return read_csv_file(local)
    rows = fetch_csv(EXPORT_URL.format(sid=SPREADSHEET_ID_VENDAS, gid=GID_VENDAS))
    head = [norm(h) for h in (rows[0] if rows else [])]
    if not ("produto" in head and "status" in head):
        print(f"[vendas] gid {GID_VENDAS} não trouxe as colunas de venda ({head[:6]}...); "
              f"lendo a aba '{SHEET_NAME_VENDAS}' pelo nome.", file=sys.stderr)
        rows = fetch_csv(GVIZ_URL.format(sid=SPREADSHEET_ID_VENDAS, sheet=urllib.parse.quote(SHEET_NAME_VENDAS)))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendas-file", help="CSV local da aba hotmart (vendas)")
    ap.add_argument("--meta-file", help="CSV local da aba de Queries (Meta Ads)")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    vendas_rows = load_vendas(args.vendas_file)
    meta_rows = read_csv_file(args.meta_file) if args.meta_file else \
        fetch_csv(EXPORT_URL.format(sid=SPREADSHEET_ID_META, gid=GID_META))

    data = process(vendas_rows, meta_rows)
    briefings_path = os.path.join(os.path.dirname(os.path.abspath(args.template)), "relatorios.json")
    data["briefings"] = load_briefings(briefings_path)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.template))

    b = data["build"]
    S = data["sales"]
    ok = [s for s in S if not s["rf"]]
    sp = sum(m["sp"] for m in data["meta"])
    by = lambda r: [s for s in ok if s["role"] == r]
    fmt = lambda r: f"{len(by(r))} (R$ {sum(s['v'] for s in by(r)):,.2f})"
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo    : {b['date_min']} -> {b['date_max']} (hoje {b['today']})", file=sys.stderr)
    print(f"  funil      : front {fmt('front')} · upsell {fmt('up')} · downsell {fmt('down')} · "
          f"LTV {fmt('ltv')} · {b['reembolsos']} reembolso(s)", file=sys.stderr)
    print(f"  vínculo    : {b['vinculo']} (comprador = herdou o anúncio da compra do front)", file=sys.stderr)
    print(f"  duplicadas : {b['duplicadas']} evento(s) APPROVED/COMPLETED repetidos removidos", file=sys.stderr)
    print(f"  descartes  : {b['descartes']}", file=sys.stderr)
    print(f"  origens    : {b['origens']}", file=sys.stderr)
    print(f"  rastreio   : {b['rastreio']} (ad=anúncio casado · camp=só campanha · none=sem nome/ID conhecido)",
          file=sys.stderr)
    print(f"  ID->campanha aprendido: {len(b['camp_id_map'])} · Queries com colunas de ID: {b['meta_has_ids']}",
          file=sys.stderr)
    print(f"  meta       : último dia {b['meta_date_max']} · {len(data['meta'])} linhas · gasto R$ {sp:,.2f} (sem imposto; fator {TAX_FACTOR})",
          file=sys.stderr)
    print(f"  out        : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
