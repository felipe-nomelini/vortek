# Bot Operacional por WhatsApp

## Objetivo

Permitir aprovar, reprovar e consultar erros operacionais pelo WhatsApp usando o número WAHA da Vortek.

## Webhook WAHA

Configure o webhook da sessão WAHA para eventos de mensagem:

```text
https://app.vortek.shop/api/webhooks/waha/ops?secret=SEU_SEGREDO
```

O segredo precisa bater com:

```bash
WAHA_OPS_WEBHOOK_SECRET=SEU_SEGREDO
```

## Variáveis Necessárias

```bash
OPS_WHATSAPP_AUTHORIZED_PHONES=21981172939,21970066090
GITHUB_OPS_TOKEN=github_pat_...
GITHUB_OWNER=felipe-nomelini
GITHUB_REPO=vortek
GITHUB_OPS_ERROR_LABELS=ops:error
```

Token GitHub fine-grained recomendado:

- Issues: read/write
- Pull requests: read/write
- Actions: read/write
- Contents: read/write

Opcional:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_OPS_WHATSAPP_MODEL=openai/gpt-5.4-mini
GITHUB_OPS_WORKFLOW=ops-autofix.yml
GITHUB_OPS_WORKFLOW_REF=main
```

Sem `OPENROUTER_API_KEY`, o bot funciona com comandos fixos.

## Conversa e Comandos

Com `OPENROUTER_API_KEY`, o bot interpreta mensagens naturais e responde como IA operacional.
Exemplos:

```text
ola
quais erros críticos estão abertos?
me mostra detalhes da issue 123
aprova a issue 123
```

Sem `OPENROUTER_API_KEY`, ou se a IA falhar, o bot usa comandos fixos:

```text
LISTAR ERROS
DETALHES 123
APROVAR 123
REPROVAR 123
MAIS DETALHES 123
AJUDA
```

## Segurança

- Comandos só são aceitos dos telefones em `OPS_WHATSAPP_AUTHORIZED_PHONES`.
- Toda entrada e resposta é registrada em `ops_whatsapp_events`.
- Aprovação via WhatsApp adiciona labels na issue e comenta a ação.
- Workflow GitHub só dispara se `GITHUB_OPS_WORKFLOW` estiver configurado.

## Fluxo

1. Alertas críticos criam ou atualizam uma GitHub Issue com label `ops:error`.
2. WhatsApp recebe alerta com número da issue e comandos disponíveis.
3. Usuário responde pelo WhatsApp.
4. Bot valida telefone e comando.
5. Bot atualiza GitHub Issue e opcionalmente dispara workflow.
