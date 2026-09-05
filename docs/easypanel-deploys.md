# Deploys pelo Easypanel

Deploy normal de apps gerenciados pelo Easypanel deve passar pelo Deploy Webhook do próprio Easypanel. Isso mantém histórico, status e logs visíveis no painel.

## Configuração de homologação

1. No Easypanel, abra o serviço `vortek-erp-dev` (aplicação `dev.bentevi.shop`).
2. Copie a URL de `Deploy Webhook`.
3. Crie `.env.deploy.local` na raiz do repo:

```bash
EASYPANEL_DEPLOY_WEBHOOK_URL=https://...
EASYPANEL_DEPLOY_HTTP_METHOD=POST
EASYPANEL_DEPLOY_EXPECTED_BRANCH=dev
EASYPANEL_DEPLOY_CONNECT_TIMEOUT=10
EASYPANEL_DEPLOY_MAX_TIME=60
```

A URL completa contém um token: mantenha `.env.deploy.local` fora do Git e não reproduza seu valor em documentação ou logs. Neste worktree, publique somente a branch `dev` no serviço de homologação.

## Uso

```bash
npm run deploy:easypanel
```

Para validar sem disparar deploy:

```bash
npm run deploy:easypanel -- --dry-run
```

## Contrato HTTP e teste local

Com `POST`, o script envia `Content-Type: application/json` e corpo literal `{}`. O modo `GET` configurável permanece sem corpo. Respostas HTTP fora de 2xx e falhas de conexão encerram o comando com erro; não há retry automático. HTTP 2xx indica aceite do webhook, não conclusão do build ou implantação.

O `--dry-run` executa as verificações de configuração/Git e termina antes de qualquer chamada HTTP. Para verificar também método, cabeçalho, corpo e falhas, execute:

```bash
node --test tests/easypanel-deploy-contract.test.js
```

O teste usa servidor em `127.0.0.1`, configuração sintética e Git simulado. Não lê `.env.deploy.local`, não acessa o Easypanel e não dispara deploy. Referências: [Deployments do Easypanel](https://easypanel.io/docs/services/app#deployments) e [envio de dados pelo curl](https://curl.se/docs/manpage.html#--data).

## Regra operacional

Use o webhook para deploy normal. Não use `docker build` + `docker service update` para apps do Easypanel, porque isso atualiza o container mas não registra deploy no painel.

Deploy direto por Docker fica reservado para emergência e deve ser comunicado como deploy invisível no Easypanel.

Serviços fora do Easypanel, como Supabase local e Cloudflare Tunnel, não aparecem no histórico do Easypanel.
