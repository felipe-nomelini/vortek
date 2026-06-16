# Deploys pelo Easypanel

Deploy normal de apps gerenciados pelo Easypanel deve passar pelo Deploy Webhook do próprio Easypanel. Isso mantém histórico, status e logs visíveis no painel.

## Configuração

1. No Easypanel, abra o serviço `vortek-erp`.
2. Copie a URL de `Deploy Webhook`.
3. Crie `.env.deploy.local` na raiz do repo:

```bash
EASYPANEL_DEPLOY_WEBHOOK_URL=https://...
EASYPANEL_DEPLOY_HTTP_METHOD=POST
```

## Uso

```bash
npm run deploy:easypanel
```

Para validar sem disparar deploy:

```bash
npm run deploy:easypanel -- --dry-run
```

## Regra operacional

Use o webhook para deploy normal. Não use `docker build` + `docker service update` para apps do Easypanel, porque isso atualiza o container mas não registra deploy no painel.

Deploy direto por Docker fica reservado para emergência e deve ser comunicado como deploy invisível no Easypanel.

Serviços fora do Easypanel, como Supabase local e Cloudflare Tunnel, não aparecem no histórico do Easypanel.
