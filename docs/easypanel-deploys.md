# Deploys pelo Easypanel

Deploy normal de apps gerenciados pelo Easypanel deve passar pelo Deploy Webhook do próprio Easypanel. Isso mantém histórico, status e logs visíveis no painel.

## Configuração de produção

1. Confirme que o SHA validado de `dev` já foi enviado e que `origin/bentevi-prod` aponta para esse mesmo SHA por fast-forward.
2. No Easypanel, abra o serviço `local/bentevi-prod` (aplicação `app.bentevi.shop`) e confirme que sua fonte é a branch `bentevi-prod`.
3. Copie a URL de `Deploy Webhook` desse serviço produtivo.
4. Crie `.env.deploy.local` na raiz do repo:

```bash
EASYPANEL_DEPLOY_WEBHOOK_URL=https://...
EASYPANEL_DEPLOY_HTTP_METHOD=POST
EASYPANEL_DEPLOY_EXPECTED_BRANCH=dev
EASYPANEL_DEPLOY_CONNECT_TIMEOUT=10
EASYPANEL_DEPLOY_MAX_TIME=60
```

A URL completa contém um token: mantenha `.env.deploy.local` fora do Git e não reproduza seu valor em documentação ou logs. `EASYPANEL_DEPLOY_EXPECTED_BRANCH=dev` protege o worktree de edição; o serviço produtivo deve continuar configurado para buscar `bentevi-prod`, já promovida para o mesmo SHA antes do webhook.

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

O `--dry-run` executa as verificações de configuração/Git e termina antes de qualquer chamada HTTP. Ele não comprova que `bentevi-prod` recebeu o SHA; confirme isso separadamente antes do deploy. Para verificar também método, cabeçalho, corpo e falhas, execute:

```bash
node --test tests/easypanel-deploy-contract.test.js
```

O teste usa servidor em `127.0.0.1`, configuração sintética e Git simulado. Não lê `.env.deploy.local`, não acessa o Easypanel e não dispara deploy. Referências: [Deployments do Easypanel](https://easypanel.io/docs/services/app#deployments) e [envio de dados pelo curl](https://curl.se/docs/manpage.html#--data).

## Regra operacional

Use o webhook para deploy normal. Não use `docker build` + `docker service update` para apps do Easypanel, porque isso atualiza o container mas não registra deploy no painel.

Deploy direto por Docker fica reservado para emergência e deve ser comunicado como deploy invisível no Easypanel.

Serviços fora do Easypanel, como Supabase local e Cloudflare Tunnel, não aparecem no histórico do Easypanel.

## Runtime do Assistente Bentevi

A conferência de 08/09/2026 sobre Railpack ocorreu no antigo `local/vortek-erp-dev` e não comprova a configuração atual de `local/bentevi-prod`. Antes de depender de fases específicas do builder, confira o serviço produtivo e seus logs de build.

O Codex `0.153.4` é uma dependência de runtime fixa em `package.json`/lockfile, instalada pelo `npm ci` existente. `npm run start` disponibiliza `node_modules/.bin` no PATH do servidor e dos processos filhos. Não depende de instalação global ou mudança manual dentro do container. Após o deploy, confirmar o binário efetivamente incluído na imagem.

Perfil e autenticação continuam fora da imagem: diretório persistente privado exclusivo `assistant-codex`, configuração canônica, workspace vazio e login oficial do titular. Instalar o executável não autentica a assinatura nem habilita o envio de dados. O Assistente permanece sujeito às flags e gates vigentes.

Referências: [Railpack — Node/install](https://railpack.com/languages/node/#install) e [npm run — PATH das dependências](https://docs.npmjs.com/cli/v11/commands/npm-run/#description).
