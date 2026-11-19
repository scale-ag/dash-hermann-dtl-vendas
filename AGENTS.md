# AGENTS.md — Dash de Vendas · Trader Lucrativo (DTL)

> Contexto completo em **`CLAUDE.md`**.

- **Repo:** `scale-ag/dash-hermann-dtl-vendas` · **Pages:** https://scale-ag.github.io/dash-hermann-dtl-vendas/
- **Abas:** Visão Geral · Meta Ads · Otimização · Insights de IA.
- **Fontes:** Queries do Meta (gid 0) + aba `hotmart` da base de UTMs (gid 1313255428). Somente leitura.
- **Funil:** Gasto → Impressões → Cliques → Views da página → Checkouts → Vendas → Faturamento.
- **Venda válida:** APPROVED/COMPLETED, sem teste, deduplicada (e-mail+produto+dia); back-end só de campanha DTL.
- **Cruzamento:** UTM com nome (desde 14/11) = exato até o anúncio; UTM antiga (ID) = só campanha; resto vai p/ rateio por checkouts.
- **Imposto:** `TAX_FACTOR=1.13806`, toggle ligado.

| Quero mudar… | Arquivo |
|---|---|
| IDs/gids, produto principal, prefixo, mapa de IDs, metas padrão | `build/build.py` |
| Cores | `build/identidade-visual.css` |
| Layout | `build/estilos.css` |
| KPIs, tabelas, rateio, decisão, alertas | `build/app.js` |
| Textos fixos | `build/template.html` |
| Publicação | `.github/workflows/deploy.yml` · `SETUP-CRON.md` |
