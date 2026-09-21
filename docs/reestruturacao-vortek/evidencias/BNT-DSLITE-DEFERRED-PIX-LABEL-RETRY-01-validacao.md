# Repetição da etiqueta DSLite após PIX adiado

Data: 21/09/2026. Venda ML `2000018531610674`, compra DSLite `410989`.

## Ocorrência

A compra foi criada e o operador escolheu `Pagar depois e continuar`. A decisão
ficou registrada em `supplier_payment_deferred_by_user` para a mesma compra e
DSID. A etiqueta real do ML foi obtida, mas o envio à DSLite falhou com HTTP
404. A compra permaneceu em `Aguardando Etiqueta`; `dslite_etiqueta_enviada`
permaneceu falso. O envio posterior da etiqueta por WhatsApp não comprovava o
envio à DSLite. A tela priorizava `Confirmar PIX`, ocultando a ação manual de
repetição; a rota manual também bloqueava todo PIX pendente da BKR1, inclusive
quando o adiamento já havia sido registrado.

## Correção

- A rota manual exige que o DSID solicitado seja o da venda. Para a BKR1 com
  PIX pendente, ela aceita a repetição somente quando a auditoria comprova o
  adiamento para a mesma venda, compra e DSID. Erro de leitura da auditoria
  impede o envio. O bloqueio anterior permanece para os demais casos.
- A projeção operacional expõe o adiamento comprovado. Uma falha de etiqueta
  com PIX ainda pendente passa a oferecer `Tentar envio à DSLite` como ação
  principal, mantendo `Confirmar PIX` como ação separada. Nenhum pagamento é
  confirmado pela repetição.
- A falha HTTP 404 original não teve causa externa exata confirmada. Não foi
  adicionado atraso, retry automático nem nova compra DSLite.

## Validação

- 26 testes direcionados aprovados, inclusive casamento de compra/DSID,
  projeção da falha e disponibilidade das duas ações.
- `npm run validate`, `npm run build`, `npm run check:build-secrets` e
  `git diff --check` aprovados com Node 22.
- Commit funcional `822a1d554931dc23e09a1a545b5f36cccb5e701a` enviado a
  `origin/dev` e promovido por fast-forward a `origin/bentevi-prod`.
- Primeiro deploy aceito pelo webhook falhou antes do build por DNS ao resolver
  `codeload.github.com`, conforme log do Easypanel informado pelo operador.
  Um segundo disparo foi aceito; o processo público reiniciou e o chunk de
  Pedidos servido por `app.bentevi.shop` tem SHA-256 idêntico ao build local.
  `/api/ops/health` e `/login` responderam 200, `/pedidos` redirecionou sem
  sessão e a rota de repetição respondeu 401 sem autenticação. A API de leitura
  do Easypanel não estava disponível neste ambiente; o SHA do contêiner ativo
  não foi verificado diretamente no painel.
- Leitura da produção `192.168.1.162` após o deploy, antes da repetição: compra `410989` ainda
  vinculada, PIX `pending`, etiqueta DSLite não enviada e registro de adiamento
  correspondente. Nenhuma migration ou escrita no banco foi necessária para
  publicar a correção.

## Aceite operacional

O operador acionou uma vez `Tentar envio à DSLite` na venda real após o deploy.
A auditoria registrou `ml_label_send_success` em `2026-09-21T11:41:02Z`.
Read-back em `.162` confirmou `dslite_etiqueta_enviada=true`, origem
`mercado_livre` e a mesma compra `410989`. O PIX continua `pending`, sem
comprovante e sem liquidação. O GET oficial da DSLite respondeu 200 para esse
DSID e apresentou status `Revisão` depois do envio. A falha de entrega da
etiqueta desta venda está resolvida; o processamento do pedido pela DSLite e a
confirmação futura do PIX continuam etapas operacionais distintas.
