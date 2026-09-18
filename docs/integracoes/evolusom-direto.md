# Integração direta Evolusom

O fornecedor `133` usa o catálogo, preço de custo e estoque `PR` da Evolusom quando `EVOLUSOM_DIRECT_ENABLED=true`. Os demais fornecedores continuam no fluxo existente. O SKU contratado é o mesmo SKU já usado no Bentevi.

## Preparação e ativação

1. Aplicar `20260918170000_evolusom_direct_purchase.sql` no Supabase Bentevi `.162` e confirmar as novas colunas de `compras` e `pedidos`.
2. Configurar `EVOLUSOM_API_TOKEN` somente no ambiente privado do serviço `local/bentevi-prod`. O valor pode ser salvo com ou sem o prefixo `Bearer`.
3. Manter `EVOLUSOM_DIRECT_ENABLED=false` durante a publicação. Para a primeira venda real acompanhada, alterar a flag para `true` no ambiente privado e redeployar o serviço.
4. Conferir catálogo/preço/estoque do fornecedor `133` e então processar uma venda real. Não usar pedidos fictícios nem chamar o POST triangular para teste.

O cliente HTTP limita as requisições a um intervalo mínimo de um segundo no processo, conforme limite de 60 por minuto informado pelo fornecedor. Se o serviço passar a executar em mais de uma instância, o limite precisará ser coordenado entre instâncias antes da ativação.

## Fluxo da venda

- O Bentevi emite a NF-e e verifica produto, quantidade e custo da oferta antes do pedido triangular.
- Se a etiqueta do ML ainda não estiver liberada, o pedido triangular recebe um link público assinado da etiqueta genérica da Evolusom. O código de rastreio real do ML continua obrigatório. Sem rastreio, email ou telefone, a compra permanece pendente e nenhuma chamada de criação é enviada.
- O identificador local `BNT-<número da venda>` é reservado antes do POST. Falha de rede após o envio marca a compra como incerta; o operador deve conferir o pedido na Evolusom antes de tentar novamente.
- Após a liberação da etiqueta real, a ação de WhatsApp da venda envia a etiqueta ao contato do fornecedor e ao segundo destinatário já configurado para a Evolusom.
- Compras PIX continuam com confirmação manual e comprovante. O envio do comprovante usa o fluxo individual existente; a liquidação consolidada do Oráculo não inclui compras diretas da Evolusom nesta primeira etapa.

Fonte do contrato: [Swagger triangular da Evolusom](https://api2.evolusom.com.br/v1/triangular/docs#/).

## Registro da preparação de 18/09/2026

- O banco `192.168.1.162` recebeu somente a migration `20260918170000`; read-back confirmou quatro colunas novas em `compras`, uma em `pedidos`, `dsid` anulável e zero compras diretas criadas.
- Antes da migration, foram copiados e conferidos os registros e metadados das tabelas afetadas em backup privado fora do repositório.
- O código foi validado com teste sintético do contrato, lint, TypeScript, build e checagem de secrets. O aplicativo respondeu ao health e ao login após deploy; nenhum endpoint autenticado da Evolusom foi chamado.
- A integração permanece desligada até a configuração privada do token e a decisão de processar a primeira venda real acompanhada.
