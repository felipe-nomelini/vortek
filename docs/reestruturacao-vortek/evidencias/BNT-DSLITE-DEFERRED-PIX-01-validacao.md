# BNT-DSLITE-DEFERRED-PIX-01 — confirmação posterior do PIX ao fornecedor

Data: 15/09/2026.

## Escopo

Permitir que, em **Pedidos > Vendas**, o usuário escolha entre confirmar o PIX
imediatamente ou continuar a criação do pedido DSLite com o pagamento pendente.
A escolha ocorre somente depois que a compra DSLite pré-paga foi criada e o
fluxo alcança o bloqueio de pagamento já existente.

O caminho posterior preserva a ação atual da venda: anexar o comprovante,
confirmar o PIX e enviá-lo ao fornecedor por WhatsApp. Nenhum comportamento
específico de fornecedor foi ampliado ou removido; em particular, a exceção da
BKR1 enquanto a etiqueta real do Mercado Livre não está liberada permanece
inalterada.

## Implementação

- O bloqueio `await_supplier_payment` abre uma decisão com duas ações:
  `Pagar agora` e `Pagar depois e continuar`.
- `Pagar agora` abre o mesmo formulário de comprovante já usado pelo sistema e
  conserva a confirmação, o envio por WhatsApp e a retomada DSLite existentes.
- `Pagar depois e continuar` inicia uma nova execução com o sinal explícito
  `continueWithSupplierPaymentPending`. Nenhum comprovante ou confirmação de
  pagamento é enviado nesse caminho.
- A API aceita esse sinal somente quando a venda já possui DSID e uma compra
  vinculada com `supplier_payment_mode=prepaid_pix` e
  `supplier_payment_status=pending`. O sinal é mutuamente exclusivo com a
  retomada posterior ao pagamento.
- A execução reutiliza o DSID existente, preserva o pagamento como pendente e
  continua as etapas de transportadora e etiqueta. A regra já existente decide
  entre etiqueta real, provisória ou espera pela liberação.
- A decisão de adiar fica registrada como
  `supplier_payment_deferred_by_user` na auditoria fiscal/operacional.
- A ação manual posterior de confirmar PIX em Vendas continua abrindo
  diretamente o formulário existente, sem repetir a escolha inicial.

Não foi criado estado paralelo, migration, coluna, job periódico ou fallback de
fornecedor. Os campos de pagamento e o job DSLite existentes continuam sendo as
fontes de verdade.

## Validação local

- Testes direcionados de pagamento, criação/retomada DSLite, etiqueta protegida,
  BKR1/Vanral, Pedidos e progresso: `42/42` aprovados.
- Suíte integral: `1.563` aprovados, zero falhos e três ignorados previstos.
- `npm run validate`: aprovado (ESLint e `tsc --noEmit`).
- `npm run build`: aprovado com Next.js `16.3.3`.
- `npm run check:build-secrets`: aprovado.
- `git diff --check`: aprovado.

O teste de regressão `tests/dslite-deferred-supplier-payment.test.js` cobre a
posição da escolha, os dois caminhos da interface, a ausência de comprovante no
adiamento, os guards do servidor, a reutilização do DSID, a permanência do
estado `pending`, a auditoria e a preservação da exceção BKR1.

## Produção Bentevi

O commit funcional `7592fd0c48adec061040717caa65f56e7094b4da` foi enviado a
`origin/dev` e promovido por fast-forward para `origin/bentevi-prod`, sem
integração com `main`. O webhook oficial do serviço `local/bentevi-prod` aceitou
o deploy, e o novo processo iniciou por volta de `2026-09-15T14:12:21Z`.

Depois da troca do container:

- `/api/ops/health` respondeu HTTP `200`, `success=true`, `ml_auth=ok` e
  configuração fiscal `ok`;
- `/login` respondeu HTTP `200` e `/pedidos` preservou o redirecionamento `307`
  sem sessão;
- `/api/pedidos` e `POST /api/dslite/pedido` responderam `401` sem sessão;
- o chunk público de Pedidos servido por produção apresentou SHA-256
  `7f94f95b54f26b1a649aaa0241006a77f8132a4b583f34820a8dfe163abb25fd`,
  idêntico ao build local, contendo a nova decisão e
  `continueWithSupplierPaymentPending`.

Nenhuma migration ou escrita de dados foi necessária. O deploy e o smoke não
criaram compra DSLite, não confirmaram PIX, não enviaram comprovante, etiqueta
ou WhatsApp e não alteraram Mercado Livre/Brasil NFe. `mobile/` permaneceu fora
do escopo. A primeira prova ponta a ponta deve ocorrer em uma venda real PIX que
naturalmente alcance essa etapa, acompanhando o mesmo DSID e confirmando depois
o comprovante; não foi fabricada uma operação externa apenas para o smoke.

## Validação operacional MKS

Em 15/09/2026, a venda Mercado Livre `2000018469395176` forneceu a primeira
prova ponta a ponta do pagamento posterior. A compra DSLite `409605`, já criada
para a MKS (`fornecedor_id=115`), estava presa no bloqueio PIX com pagamento
`pending`, sem comprovante e sem confirmação. O Mercado Livre respondeu com o
shipment `48019299014` em `ready_to_ship/invoice_pending`: a consulta foi válida,
mas a etiqueta real ainda não era imprimível.

O commit funcional `3c7b1cb230363fd09a8620cd0b91e03b18537e75` acrescentou a
MKS somente à regra de etiqueta provisória. A origem própria
`placeholder_release_window_mks` reutiliza os bytes do PDF aprovado para a BKR1,
sem transformar a MKS em BKR1 para pagamento, formato térmico ou WhatsApp. Fora
da janela fiscal, o fallback só ocorre quando a consulta ao ML conclui com
`checked=true` e `printable=false`; erro de rede, autenticação ou leitura não é
tratado como indisponibilidade normal.

Os cinco arquivos de testes direcionados passaram, assim como `npm run
validate`, `npm run build`, `npm run check:build-secrets` e `git diff --check`.
O SHA foi confirmado em `origin/dev` e `origin/bentevi-prod`. A primeira ação
Easypanel falhou antes do build por DNS ao resolver `codeload.github.com` e não
alterou o container; o retry controlado `cmu3h2a7b000207k3513u471e` terminou em
`done` às `2026-09-16T02:22:46Z`. O novo processo iniciou saudável, com Mercado
Livre e configuração fiscal em estado `ok`; login, redirecionamento autenticado
e bloqueios `401` também passaram no smoke.

O job canônico `18f27413-f336-451a-9b2e-6bd5500be1e0`, iniciado com chave
idempotente e `continueWithSupplierPaymentPending=true`, terminou `completo`,
11/11 etapas, sem pendências. O read-back confirmou:

- o mesmo pedido, a mesma compra e o mesmo DSID `409605`, sem duplicação;
- etiqueta genérica enviada com origem `placeholder_release_window_mks` e
  arquivo lógico `etiqueta_mks_aguardando_etiqueta_ml.pdf`;
- DSLite em `Solicitado`, transportadora Correios `31`, serviço `Etiqueta PDF`;
- pagamento ainda `pending` em R$ 960,00, sem comprovante e sem `confirmed_at`;
- nenhuma mensagem de WhatsApp enviada nessa retomada.

A confirmação posterior do PIX e o envio do comprovante permanecem como a
próxima ação manual normal da compra.

## Recuperação

Reverter progressivamente o commit funcional, promover o SHA da reversão para
`bentevi-prod` e reimplantar `local/bentevi-prod`. Não há rollback de banco.
Pedidos DSLite, etiquetas, pagamentos, documentos e mensagens eventualmente
realizados após a ativação são efeitos externos e não devem ser desfeitos por
restauração cega; precisam ser reconciliados individualmente por leitura e pelo
fluxo operacional correspondente. Para a extensão MKS, reverter
`3c7b1cb2`, promover o SHA da reversão e reimplantar desativa novos fallbacks,
mas não remove a etiqueta já aceita no DSID `409605`.
