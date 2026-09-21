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
- O job `sync_evolusom_pedidos_compra` consulta a cada ciclo de dois minutos até 20 compras diretas, começando pelas menos recentemente atualizadas. Cada consulta avança `compras.updated_at` para distribuir as próximas rodadas. Usa o GET de status do pedido triangular, confere o número retornado e mantém `compras.status` igual ao estado do `pedido_lojista`. A leitura não envia outro POST e não altera o status de pagamento ou da etiqueta. Falhas ficam registradas no job; uma falha de acesso 401/403 encerra o ciclo. O intervalo é de agendamento, não uma garantia de atualização em tempo real.
- Uma oferta que deixou de existir na Evolusom só é inativada e zerada depois de uma varredura iniciada na primeira página, concluída com o mesmo total de produtos e sem erro de leitura. Se o total mudar durante o ciclo, a limpeza é adiada para a próxima varredura completa.

## Fluxo da venda

- O Bentevi emite a NF-e e verifica produto, quantidade e custo da oferta antes do pedido triangular.
- Antes do POST triangular, o Bentevi consulta o envio no ML. Se a etiqueta já estiver imprimível, baixa e salva o PDF real e envia seu link público assinado à Evolusom. Falha no download ou no armazenamento mantém a compra pendente, sem substituir uma etiqueta liberada pela genérica. Se a etiqueta ainda não estiver liberada, o pedido triangular recebe o link da etiqueta genérica. Nessa condição, se o ML ainda não informar rastreio, `transporte.codrastreio` usa `99999999999`, conforme o exemplo fornecido; esse código não é gravado como rastreio real no Bentevi. Com etiqueta real, a ausência do rastreio mantém a compra pendente. Email e telefone conhecidos são enviados; campos ausentes ou inválidos seguem como `null`.
- Nos novos pedidos, `nfe.url` recebe um link curto `app.bentevi.shop/s/<código>`, criado e conferido antes do POST. Ele aponta para o link público assinado da DANFE, que entrega o PDF pelo domínio do Bentevi sem redirecionar ao endereço interno do Supabase `.162`. Se o link curto falhar, o pedido não é enviado à Evolusom. Pedidos já criados não são reenviados.
- O Bentevi reserva em `compras.evolusom_request_code` um código numérico de oito dígitos para cada compra direta: `80000000` mais os últimos sete dígitos do número da venda. A derivação é estável para chamadas concorrentes, e a unicidade local é protegida por índice no banco; eventual colisão bloqueia a criação antes do POST. O mesmo código é enviado em `codigo_pedido` e preservado em retomadas. A escolha de oito dígitos segue o exemplo `80002719` do Swagger e evita o erro observado com 16 dígitos, mas o limite exato e o escopo de unicidade ainda dependem de confirmação da Evolusom. `data_pedido` representa a reserva da compra, gravada em `compras.data_criacao` e preservada em uma retomada; não é a data da venda no ML nem a emissão da NF-e. Falha de rede após o envio marca a compra como incerta; o operador deve conferir o pedido na Evolusom antes de tentar novamente.
- Uma rejeição HTTP 400 documentada pela Evolusom como erro de validação permite nova tentativa manual com a mesma reserva. O Bentevi mostra os campos rejeitados sem expor os valores retornados na interface. Resultado incerto continua sem reenvio até conferência do fornecedor.
- O job de criação guarda a resposta integral do POST da Evolusom em `jobs.log.private_evolusom_response`, acessível por leitura administrativa do banco, inclusive quando o número não puder ser extraído. A rota de acompanhamento do job não devolve esse campo privado. Isso permite conferir o contrato real e reconciliar a compra sem repetir um POST aceito.
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

## Primeira venda real em 21/09/2026

- Na venda `2000018567229898`, o primeiro job autorizou a NF-e e parou pela ausência de rastreio real. A correção publicada no SHA `5925c40b` passou a usar `99999999999` apenas com etiqueta provisória.
- A tentativa seguinte reservou `BNT-2000018567229898` às 11h18 (Brasília), enviou um POST triangular e recebeu HTTP 400. A compra ficou em `rejected`, sem número de pedido retornado; nenhum POST adicional foi feito nesta ação.
- O cliente anterior descartava o corpo do HTTP 400, então o motivo exato dessa primeira rejeição não ficou disponível no Bentevi. A consulta autenticada de cadastro confirmou o CNPJ habilitado para dropshipping; DANFE e etiqueta provisória responderam pelos links públicos assinados.
- A reserva rejeitada continuava aparecendo como `compra_id` na projeção da lista de Vendas, ocultando a ação de criação apesar de a coluna Compra mostrar `Não Criado`. A projeção passa a oferecer retomada para reservas `prepared` ou `rejected` sem número remoto; estados `sent` e `uncertain` seguem aguardando conferência.
- A resposta real de validação veio em `message.codigo_pedido`: a Evolusom exige número, e rejeitou `BNT-2000018567229898`. Uma nova tentativa com `codigo_pedido` numérico `2000018567229898`, a mesma reserva e a mesma `data_pedido` recebeu HTTP 200, mas o corpo não foi preservado nessa execução. Portanto, o HTTP 200 **não comprova** criação remota; a reserva continua em `uncertain` até conferência com a Evolusom.

## Segunda venda real em 21/09/2026

- A venda `2000018567961756` teve NF-e autorizada. O primeiro POST triangular desta venda preservou a resposta completa em `jobs.log.private_evolusom_response` sem expô-la na rota de acompanhamento.
- A Evolusom respondeu HTTP 200 com **`status: 500`, `data: []` e erro `ORA-01438`** dentro do corpo. O erro ocorreu no `insert` de `PCPEDC`; a associação dos parâmetros mostra os 16 dígitos do número da venda em `NUMPEDWEB`. A consulta do `NUMPED` tentado retornou `No query results for model EcommercePedidoTriangular`. O Bentevi passou a distinguir HTTP 200 de sucesso de negócio: `status` interno maior ou igual a 400 encerra o job com erro legível e mantém a resposta privada para reconciliação.
- Após confirmar a ausência do pedido remoto, a mesma compra foi retomada com `codigo_pedido` numérico `87961756`, preservando `data_criacao` de 13h02 (Brasília). O POST retornou somente `{codigo: "63012091", status: "Bloqueado", message: "Pedido inserido com sucesso"}`. O Bentevi gravou o pedido remoto `63012091` na compra e na venda, PIX de R$ 15,30 pendente e etiqueta provisória. O GET `/v1/pedidos/triangular/63012091/status` respondeu HTTP 200, `status: 200`, `codigo_pedido: "87961756"`, `pedido_lojista.numero: "63012091"`, `pedido_lojista.status: "Bloqueado"`, `pedido_cliente: null` e um bloqueio com motivo `Pedido Dropshipping`. O `data_pedido` desse GET foi 13h19, horário da criação remota; o `data_pedido` enviado no POST continuou sendo o da reserva local.
- O modal “Pagar depois e continuar” ainda procurava apenas `pedidos.dslite_id` e respondeu 409, embora a compra direta estivesse criada. A continuação da Evolusom passa a conferir `evolusom_order_id`, compra e PIX pendente, registrar o adiamento e concluir a decisão no painel sem outro POST triangular. A etiqueta real ainda depende da liberação pelo Mercado Livre e do envio via WhatsApp.
- O limite de dígitos e a regra de unicidade de `codigo_pedido`/`NUMPEDWEB` não constam no Swagger disponível; ele apenas exemplifica um código de oito dígitos. A aceitação desta venda comprova o formato usado, mas não define o limite formal.

## Terceira venda real em 21/09/2026

- A venda `2000018570255102` usa a oferta ativa `380381` da Evolusom (`133`), quantidade 1. A primeira execução emitiu a NF-e e encerrou antes de criar compra ou enviar POST triangular: o ML ainda não informou rastreio nem disponibilizou etiqueta, e `ml_fiscal_release_at` estava vazio.
- A escolha da etiqueta provisória dependia indevidamente da presença de uma janela de liberação do ML. Para pedidos diretos da Evolusom, a etiqueta genérica e o rastreio provisório do exemplo passam a ser usados quando a etiqueta real ou o rastreio ainda faltam, mesmo sem `ml_fiscal_release_at`. O rastreio provisório continua fora do campo de rastreio real do Bentevi; a etiqueta real será enviada após liberação.
