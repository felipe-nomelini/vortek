# Migracao WAHA WEBJS para GOWS

## Objetivo

Reduzir instabilidade de sessao e erros `WAHA HTTP 500` migrando o WAHA de `WEBJS`
para `GOWS`.

## Evidencia

- WAHA atual em producao retornou `WEBJS`.
- Issues recentes registraram `STOPPED`, `STARTING`, `FAILED` e `WAHA HTTP 500`.
- A documentacao WAHA indica que `GOWS` nao usa browser e comunica direto via
  WebSocket.

## Pre-requisitos

- Manter o container/sessao `WEBJS` atual intacto ate validar `GOWS`.
- Criar um servico WAHA paralelo no Easypanel, ou outro host, com imagem:
  `devlikeapro/waha:gows`.
- Configurar o servico paralelo com:

```env
WHATSAPP_DEFAULT_ENGINE=GOWS
WAHA_API_KEY=<mesma-chave-ou-chave-nova>
```

Use volume/storage separado do servico `WEBJS`.

## Pareamento

1. Subir o servico `GOWS`.
2. Criar/iniciar a sessao `default`.
3. Parear o WhatsApp via QR/pairing.
4. Confirmar:

```bash
npm run waha:gows:smoke
```

Sem `WAHA_TEST_RECIPIENT_PHONE`, o script valida apenas:

- `/api/version`
- `/api/sessions/default`
- engine `GOWS`
- status `WORKING`

Com `WAHA_TEST_RECIPIENT_PHONE`, tambem valida:

- `POST /api/sendText`
- `POST /api/sendFile`

## Cutover

1. Pausar envios automaticos por alguns minutos, se houver operacao sensivel em andamento.
2. Trocar `WAHA_BASE_URL` do Vortek para o servico `GOWS`.
3. Garantir:

```env
WAHA_EXPECTED_ENGINE=GOWS
WAHA_SESSION=default
```

4. Rodar:

```bash
npm run waha:gows:smoke
```

5. Disparar deploy do Vortek, se a troca de env exigir redeploy.
6. Enviar uma etiqueta real controlada.
7. Monitorar `integration_status` e `whatsapp_label_send_*` por 1 hora.

## Rollback

1. Voltar `WAHA_BASE_URL` para o servico `WEBJS`.
2. Confirmar `GET /api/sessions/default` como `WORKING`.
3. Rodar smoke com:

```bash
WAHA_EXPECTED_ENGINE=WEBJS npm run waha:gows:smoke
```

4. Reativar envios automaticos.

## Riscos conhecidos

- Payload de webhook pode diferir entre engines.
- Comportamento de midia pode diferir; por isso `sendFile` deve ser testado antes
  do corte.
- QR/sessao do `GOWS` nao deve reaproveitar storage do `WEBJS` sem teste explicito.
