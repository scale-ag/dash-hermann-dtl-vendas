# Dashboard de Vendas · Trader Lucrativo (DTL) · Hermann Greb

Dashboard **100% na nuvem** de **vendas por tráfego direto** (Meta Ads → página de
vendas → checkout Hotmart), cruzando o gasto do Meta Ads com as vendas reais da
Hotmart pela UTM. Mesmo modelo/visual de `scale-ag/dash-giaco-sdc-form7`
(HTML/CSS/JS + Chart.js), publicado no **GitHub Pages** e reconstruído a cada
~30 min pelo GitHub Actions (disparado pelo cron-job.org).

**URL pública:** https://scale-ag.github.io/dash-hermann-dtl-vendas/

Somente leitura das planilhas. O build **nunca** escreve de volta.

## Abas

1. **Visão Geral** — funil `Gasto → Impressões → Cliques → Views da página → Checkouts → Front (R$ 297) → Upsell · Downsell → Faturamento do funil`
   (CPM, Frequência, CTR, CPC, Connect Rate, Conv. página, Custo/checkout, CPA, Conv. checkout, take rates, ROAS funil, AOV),
   evolução diária, tabela diária com heatmap, 12 KPIs (vendas/dia, AOV = CPA de equilíbrio, take rate upsell/downsell,
   ROAS só do front, resultado do funil, LTV posterior + dias até o LTV, % via Meta, top anúncio, melhor dia, IG:FB)
   e distribuições (origem, produto/papel, plataforma, posicionamento).

   **Funil por comprador:** upsell (DNA Expert 6m) e downsell (DNA Expert 3m) herdam o anúncio que trouxe o comprador
   do front; compras posteriores (Sala Educacional) entram como **LTV**, fora do ROAS do funil.
2. **Meta Ads** — só vendas com UTM de Meta; combinação diária; indicadores por dia (CPM/CTR · Connect/Conv. página ·
   CPA/ROAS); vendas por anúncio; donut checkout→venda; compilado por menor CPA; 3 tabelas hierárquicas
   Campanha → Conjunto → Anúncio com filtro cruzado e gráfico de CPA por dia; lista de vendas (mascarada).
3. **Otimização** — o **gap de dados** do Gerenciador: vendas reais × checkouts do pixel, % de rastreio até o
   anúncio/campanha, vendas pagas sem anúncio identificado (por ID), **rateio** das vendas sem anúncio pelos
   checkouts do dia (“Vendas est.”), decisão **Escalar/Manter/Observar/Cortar** por campanha e por anúncio,
   sinais automáticos (escalar, cortar, dias gastando sem vender, connect baixo, checkout que não fecha),
   vendas por posicionamento/plataforma/hora.
4. **Insights de IA** — espelho da Visão Geral + metas + Top Anúncios + Insights de Tráfego (`build/relatorios.json`, vazio por enquanto).

**Imposto Meta:** `TAX_FACTOR = 1.13806` (13,806%) sobre o gasto; toggle ligado por padrão.

## Fontes (Google Sheets, somente leitura)

| Planilha | ID | Aba (gid) |
|---|---|---|
| Meta Ads — `QUERIES TDL META` | `1i2qU4Xwfy3M1bpThUyh7A8C4e5dGrbILPss_okqq-7E` | `0` |
| Vendas — `Base [Applications] [UTMs]`, aba `hotmart` | `1_Er3ILbAY4ntIWL6Dxw_bvqDSqDfl36yAquz_RkbBOE` | `1313255428` (fallback pelo nome `hotmart`) |

## Rodar/testar local

```bash
python build/build.py --vendas-file hotmart.csv --meta-file queries.csv --out dist/index.html
```

Valores do cron-job.org: **`SETUP-CRON.md`**. Regras de negócio: **`CLAUDE.md`**.
