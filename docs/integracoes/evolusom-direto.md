# Integração direta Evolusom

O fornecedor `133` usa o catálogo, preço de custo e estoque `PR` da Evolusom quando `EVOLUSOM_DIRECT_ENABLED=true`. Os demais fornecedores continuam no fluxo existente. O SKU contratado é o mesmo SKU já usado no Bentevi.

## Preparação e ativação

1. Aplicar `20260918170000_evolusom_direct_purchase.sql` no Supabase Bentevi `.162` e confirmar as novas colunas de `compras` e `pedidos`.
2. Configurar `EVOLUSOM_API_TOKEN` somente no ambiente privado do serviço `local/bentevi-prod`. O valor pode ser salvo com ou sem o prefixo `Bearer`.
3. Ativar `EVOLUSOM_DIRECT_ENABLED=true` somente depois de configurar o token e redeployar o serviço.
4. Conferir catálogo/preço/estoque do fornecedor `133` e então processar uma venda real. Não usar pedidos fictícios nem chamar o POST triangular para teste.

O cliente HTTP limita as requisições a um intervalo mínimo de um segundo no processo, conforme limite de 60 por minuto informado pelo fornecedor. Se o serviço passar a executar em mais de uma instância, o limite precisará ser coordenado entre instâncias antes da ativação.

## Atualização automática

- Com a integração direta ativa, o fornecedor `133` é retirado das rotinas de catálogo e preço/estoque da DSLite e da reconciliação pelo XML da DSLite.
- Dois jobs próprios consultam somente a Evolusom: `sync_evolusom_catalogo` e `sync_evolusom_preco_estoque`. Cada execução processa até cinco páginas de 100 itens e conserva o cursor para a execução seguinte.
- O catálogo inclui produtos novos. O job de preço/estoque atualiza custo e estoque PR, recalcula a oferta preferencial e usa a fila existente para publicar mudanças de estoque no Mercado Livre.
- Uma oferta que deixou de existir na Evolusom só é inativada e zerada depois de uma varredura iniciada na primeira página, concluída com o mesmo total de produtos e sem erro de leitura. Se o total mudar durante o ciclo, a limpeza é adiada para a próxima varredura completa.

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
- Na preparação inicial, a integração permaneceu desligada até a configuração privada do token. A ativação posterior passou a permitir consultas GET e manteve o POST triangular reservado para vendas reais.

## Auditoria de leitura de 18/09/2026

- O GET autenticado percorreu 75 páginas e retornou 7.416 SKUs únicos, todos com preço e estoque PR válidos; 3.391 possuíam estoque positivo.
- A comparação somente leitura encontrou 7.351 SKUs em comum com a base existente, 65 presentes apenas na Evolusom e 111 presentes apenas na base antiga. Havia 912 diferenças de custo e 1.726 diferenças de estoque.
- Essa auditoria não alterou o banco e não chamou o endpoint de criação de pedido.
