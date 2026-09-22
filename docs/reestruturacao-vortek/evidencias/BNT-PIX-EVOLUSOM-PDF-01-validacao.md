# Bentevi — PIX opcional, andamento Evolusom e origem no PDF

Data: 22/09/2026. Correção funcional: `795a929eb9e1dda1ba398d39c7932c43b1894405`.

## Causa comprovada

- A chave PIX da Evolusom estava cadastrada no fornecedor `133`, mas a projeção da compra direta para Vendas não preenchia `supplier_pix_key` nem os campos de comprovante e referência.
- A venda `2000018568398610` tinha compra Evolusom `63012097`, etiqueta real armazenada, situação `etiqueta_impressa` e auditoria de WhatsApp com envio concluído. O andamento exigia `dslite_id`, ausente por ser compra direta, e a ação da Evolusom continuava como espera pela etiqueta real.
- O PDF de Vendas mostrava o número somente para pedidos DSLite; a compra Evolusom não era incluída na coluna Origem.
- As telas web e os dois caminhos da API de confirmação individual ainda exigiam comprovante, embora a liquidação consolidada já o tratasse como opcional.

## Delta

A projeção de Vendas passa a transportar a chave PIX e os campos de pagamento da compra Evolusom. O cálculo operacional reconhece seu número como compra válida; nesta primeira versão, encerrava a espera pela etiqueta quando a auditoria registrava o envio real por WhatsApp. A correção posterior abaixo substituiu esse critério pela entrega confirmada no pedido. O PDF mostra `Evolusom #<número>` em Origem. Compras e Vendas aceitam confirmar PIX sem arquivo; o caminho legado não tenta enviar WhatsApp sem comprovante, e o adaptador individual confirma a liquidação sem fazer upload. Nenhuma migration ou alteração de dados foi necessária.

## Validação e publicação

- 33 testes direcionados passaram, incluindo compra Evolusom, WhatsApp, andamento e PIX sem comprovante. `npm run validate`, `npm run build`, `npm run check:build-secrets` e `git diff --check` passaram.
- O código funcional foi enviado a `origin/dev` e promovido por fast-forward a `origin/bentevi-prod` no mesmo SHA. O webhook oficial retornou HTTP 200; depois, o processo de `app.bentevi.shop` reiniciou e a página publicada de Compras continha o texto novo de comprovante opcional.
- Após o deploy, health e login responderam HTTP 200, enquanto `/api/pedidos` sem sessão respondeu 401.
- Leitura apenas do Supabase produtivo `.162`: venda `2000018568398610` em `etiqueta_impressa`, compra Evolusom `63012097` paga, chave PIX presente, comprovante existente, etiqueta real armazenada e evento de envio real por WhatsApp com sucesso. Não houve escrita no banco nem novo envio de mensagem nesta validação.
- O painel Easypanel não estava acessível para leitura autenticada neste ambiente; o SHA da imagem ativa não pôde ser obtido diretamente. A troca do processo e o arquivo publicado confirmam a nova versão web, mas não substituem a conferência do manifesto da imagem no painel.

Recuperação de código, se necessária: corrigir progressivamente em `dev`, validar, promover o novo SHA por fast-forward e reimplantar `local/bentevi-prod`. Não há rollback de schema ou dados desta ação.

## Correção definitiva do andamento da etiqueta — 22/09/2026

Correção funcional: `288189948e9d5dc98e6ec17f0901ca306cc55951`.

A primeira correção encerrava a espera da Evolusom pelo evento de sucesso na auditoria do WhatsApp. O fluxo de envio já registra no próprio pedido `label_type=real`, `label_delivery_channel=whatsapp` e `label_delivered_at` somente quando o destinatário principal corresponde ao telefone cadastrado do fornecedor. A etapa e a urgência passaram a usar essa entrega confirmada como fonte. Um sucesso de envio a outro número continua registrado como tentativa, mas não conclui a entrega ao fornecedor. A lista recarrega o estado persistido após o job, sem marcar sucesso local antecipadamente.

Leitura somente da produção `.162` encontrou quatro compras diretas Evolusom com entrega real confirmada: `2000018568398610`, `2000018570255102`, `2000018572188636` e `2000018573920696`. Seis compras diretas ainda aguardam etiqueta real. Entre as compras antigas com DSLite, `2000018377834366` tinha evento de sucesso, mas não tinha entrega confirmada e o sufixo do destinatário não coincidia com o telefone cadastrado do fornecedor; a etapa permanece pendente para uma entrega válida. Nenhum dado foi alterado e nenhuma mensagem foi enviada nesta correção.

Passaram 32 testes direcionados, `npm run validate`, `npm run build`, `npm run check:build-secrets` e `git diff --check`. O SHA funcional foi enviado a `origin/dev` e promovido por fast-forward a `origin/bentevi-prod`. O webhook Easypanel retornou HTTP 200; o processo produtivo reiniciou e um chunk publicado continha `supplier_label_delivered`. Health e login retornaram 200, e `/api/pedidos` sem sessão retornou 401. O painel Easypanel permaneceu indisponível para comprovar diretamente o SHA da imagem ativa.
