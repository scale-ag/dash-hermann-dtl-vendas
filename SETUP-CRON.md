# Ativação + configuração do cron-job.org

## Passo 1 — Workflow na `main` (já feito)

O disparo por `workflow_dispatch` (o que o cron-job.org usa) só existe quando o
workflow está na `main`. A página fica em:

**https://scale-ag.github.io/dash-hermann-dtl-vendas/**

Para disparar na mão: aba **Actions** → *Build & Deploy Dashboard* → **Run workflow**.

## Passo 2 — Token do GitHub (fine-grained)

GitHub → *Settings* → *Developer settings* → **Fine-grained tokens** → *Generate*:
- Resource owner: **scale-ag**
- Repository access: **Only select repositories → `scale-ag/dash-hermann-dtl-vendas`**
- Permissions → Repository permissions → **Actions: Read and write**

O token vai **só** no cron-job.org — nunca no repositório nem em chat.
Se um token for exposto, revogue e gere outro.

## Passo 3 — Criar o cron job em https://cron-job.org

### URL
```
https://api.github.com/repos/scale-ag/dash-hermann-dtl-vendas/actions/workflows/deploy.yml/dispatches
```

### Método (Request method)
```
POST
```

### Schedule
```
A cada 30 minutos  (Every 30 minutes)
```

### Headers (chave → valor), um por linha
```
Accept: application/vnd.github+json
```
```
Authorization: Bearer TOKEN_AQUI
```
```
X-GitHub-Api-Version: 2022-11-28
```
```
Content-Type: application/json
```

### Request body
```
{"ref":"main"}
```

## Como saber se funcionou

- Resposta esperada: **HTTP 204 No Content**.
- Em **Actions** aparece uma execução nova a cada disparo.
- 401/403 = token errado ou sem **Actions: write** · 404 = owner/repo/arquivo errado ·
  422 = workflow fora da `main` ou body sem `{"ref":"main"}`.

O `schedule` nativo (`*/30 * * * *`) do `deploy.yml` fica como backup (o GitHub atrasa agendamentos).
