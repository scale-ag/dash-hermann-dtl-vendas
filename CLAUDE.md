# CLAUDE.md — Dashboard de Vendas · Trader Lucrativo (DTL) · Hermann Greb

> Lido automaticamente pelo Claude Code. Mantenha atualizado.
> Repositório: `scale-ag/dash-hermann-dtl-vendas` · Pages: `https://scale-ag.github.io/dash-hermann-dtl-vendas/`

## Configuração do cliente

- **Cliente:** Hermann Greb · **Produto principal:** “Trader Lucrativo - Método Hermann Greb” (Hotmart, R$ 297).
- **Funil:** tráfego direto (Meta Ads → página de vendas → checkout Hotmart). Campanhas com prefixo **`DTL`**.
- **Modelo:** mesmo layout/engine de `scale-ag/dash-giaco-sdc-form7`, adaptado a VENDAS + aba **Otimização**.
  Abas: **Visão Geral · Meta Ads · Otimização · Insights de IA** (ids `geral`/`meta`/`otm`/`rel`).
- **Meta Ads:** planilha `1i2qU4Xwfy3M1bpThUyh7A8C4e5dGrbILPss_okqq-7E`, gid `0`
  (`Day, Campaign Name, Ad Set Name, Ad Name, Amount Spent, Impressions, Link Clicks, Landing Page Views, Checkouts Initiated, Reach`).
- **Vendas:** planilha `1_Er3ILbAY4ntIWL6Dxw_bvqDSqDfl36yAquz_RkbBOE`, aba `hotmart`, gid `1313255428`
  (`Data, Produto, Nome, Telefone, Email, UTM Source/Medium/Campaign/Content, Status, Faturamento, SCK`).
  Se o gid não trouxer `Produto`/`Status`, o build lê a aba pelo nome (gviz).
- `TAX_FACTOR = 1.13806` (toggle "Imposto Meta" ligado por padrão).
- O sandbox do agente não alcança `docs.google.com`; o runner do Actions alcança.

## Regra de VENDA VÁLIDA (`build.py` → `process`)

1. Status `APPROVED`/`COMPLETED` (reembolso/chargeback/cancelamento anula a compra mais recente do mesmo e-mail+produto);
2. não é teste (produto “test postback”, e-mail @example/test/teste.com, nome “Teste…”);
3. **dedupe:** a Hotmart grava a mesma compra 2× (APPROVED + COMPLETED, mesmo horário) → 1 compra = (e-mail, produto, dia);
4. **Funil por COMPRADOR** (`product_role`): **front** = Trader Lucrativo (R$ 297) · **upsell** = DNA Expert 6 meses
   (R$ 697) · **downsell** = DNA Expert 3 meses (R$ 397) · **LTV** = qualquer outra compra posterior do comprador do
   front (ex.: Sala Educacional ~R$ 1.490, em média ~11 dias depois).
5. Upsell/downsell/LTV são **vinculados ao comprador do front** (mesmo e-mail; compra do front mais recente até
   10 min depois — `LINK_TOLERANCE_MIN`) e **herdam o anúncio do front** (`via='comprador'`), a não ser que a UTM
   da própria compra seja mais precisa. Sem compra de front antes: só entra se a UTM for de campanha DTL (`via='utm'`).

Métricas (`derive` em `app.js`): `vendas` = compradores do front (CPA) · **Faturamento do funil** = front + upsell +
downsell → **ROAS funil** (principal) e **AOV** (= CPA de equilíbrio) · ROAS só do front · take rate do upsell
(upsells ÷ fronts) e do downsell (downsells ÷ quem recusou o upsell) · **LTV** fica FORA do ROAS do funil (ROAS c/ LTV à parte).

## UTM × Meta (cruzamento)

O padrão da UTM mudou em **14/11/2026**:
- **novo (nome):** `s=Meta-Ads|m={{adset.name}}|c={{campaign.name}}|co={{ad.name}}|t={{placement}}|utm_id={{campaign.id}}`
  → casamento **exato** Campanha + Conjunto + Anúncio (`lvl='ad'`).
- **antigo (ID):** `m=paid|s=ig|utm_id=<campanha>|co=<ID>|t=<ID>|c=<campanha>` → só a campanha é resolvida
  (`lvl='camp'`), pelo mapa ID→nome **aprendido** das vendas que trazem ID + nome + `CAMPAIGN_ID_MAP` manual.
- `CAMPAIGN_ID_MAP`: `120253321018810236` → *Teste de VSL ABERTA* (deduzido: única campanha, além da FECHADA que já tem
  ID próprio, ativa nos 16 dias com venda desse ID). `120253682500490236` segue sem mapa (5 vendas).
- **Para fechar o gap:** incluir `Campaign ID`, `Ad Set ID`, `Ad ID` na query do Meta — o build detecta as colunas e
  casa as vendas antigas por ID (testa `co` e `t` contra Ad ID e Ad Set ID).
- Origem: `meta` (UTM paga/ID/Meta-Ads), `organico` (link_in_bio, organic_*), `hotmart` (HOTMART_*), `sem_utm`.

### Rateio do gap (aba Otimização, `EST` em `app.js`)
Venda paga sem anúncio identificado → rateada entre os anúncios ativos **no mesmo dia** (dentro da campanha, se
conhecida) pela proporção de **checkouts iniciados** (fallback: views → cliques → gasto). Vira “Vendas est.”,
sempre rotulada como estimativa. A **decisão** (Escalar/Manter/Observar/Cortar) usa as vendas estimadas:
CPA ≤ meta → Escalar · até +30% → Manter · acima → Cortar · sem amostra (gasto < `SAMPLE_MIN_SPEND` e vendas <
volume mín.) → Observar · gastou o teto (meta×1,3) sem atingir o volume → Cortar. **Meta CPA padrão = CPA de
equilíbrio do funil** (`EQ_CPA` = faturamento front+upsell+downsell ÷ compradores do front, todo o histórico); o
gestor pode fixar outra no painel (ou `META_CPA` no build).

## Arquitetura

```
build/build.py            # lê os 2 CSVs, dedupe, origem, cruzamento UTM×Meta; emite sales[]/meta[] (registros brutos)
build/template.html       # esqueleto HTML (placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__)
build/identidade-visual.css  # TODAS as cores (tema claro/escuro)
build/estilos.css         # layout/componentes (+ bloco "Aba Otimização")
build/app.js              # lógica + render (KPIs, funil, tabelas, filtro cruzado, rateio, decisão, alertas)
build/relatorios.json     # Insights de Tráfego (vazio — sem Routine de IA)
.github/workflows/deploy.yml  # build + Pages (workflow_dispatch + schedule + push)
SETUP-CRON.md             # valores exatos do cron-job.org
```

**Regras das tabelas** (iguais ao modelo): cabeçalho sticky; ordenação tri-state; colunas redimensionáveis
(localStorage `dm_colw:<repo>`); “Total Geral” fixo; dimensão nunca truncada; seleção com Ctrl multi;
filtro cruzado bidirecional; tabela diária com último dia no topo; heatmap de cor fixa (Gasto · Vendas · ROAS).
Metas em `dm_metas:<repo>` (painel sincronizado entre Otimização e Insights).

## Rodar/testar local

```bash
python build/build.py --vendas-file hotmart.csv --meta-file queries.csv --out dist/index.html
```

## Publicação — problemas conhecidos
1. cron-job.org só funciona na `main`.
2. Pages em modo “GitHub Actions”.
3. **Token exposto em chat: revogar e gerar um novo** (fine-grained, só Actions: read/write neste repo).
