# BNT-KIT-SUPPLIER-SOURCE-01 — origem fixa de fornecedor para kits

Data: 15/09/2026.

## Escopo

Fazer o fornecimento externo de todo kit simples respeitar a origem configurada
em `produto_kits.fornecedor_dslite_id` e o produto individual vinculado em
`produto_kit_componentes`. Estoque interno físico continua prevalecendo quando
há saldo liberado. Produtos que não são kits preservam a seleção automática ou
manual já existente.

O caso que revelou a divergência foi o kit `VTK016028`, formado por 48 unidades
do produto individual `VTK001502`. Sua origem configurada é BKR1 (`108`), SKU de
origem `2295CX48` e produto DSLite `2295`.

## Causa confirmada

O pai do kit não possui oferta direta. Capacidade, pricing, snapshot de CMV,
preview da venda e criação DSLite expandiam o kit para o componente e então
reutilizavam a preferência genérica desse componente. Como a oferta MKS custava
R$ 10,00 e a BKR1 R$ 10,06, o fluxo podia escolher MKS, embora o kit estivesse
configurado para BKR1. Na lista de Produtos, a ausência de oferta direta do pai
também permitia que o identificador vazio colidisse visualmente com a opção de
estoque interno.

## Correção

- Um resolvedor central exige kit ativo, um único componente ativo e não
  aninhado, fornecedor configurado ativo e oferta operacional correspondente.
- Capacidade, custo do kit, memória econômica, CMV, preview de compra, lista,
  detalhe e PDF usam a mesma origem. Kit incompleto fica indisponível; não há
  fallback para outro fornecedor.
- A criação DSLite fixa o fornecedor do kit antes de validar as linhas do XML.
  Em pack misto, essa origem governa também os itens comuns que possuam oferta
  compatível; fornecedores de kits diferentes interrompem a compra.
- O XML fiscal e a compra usam diretamente o identificador DSLite da oferta do
  componente. Para duas unidades de `VTK016028`, a linha é `2295` com quantidade
  96.
- A interface apresenta `Origem do kit`/`Fornecedor configurado`, e a seleção de
  fornecedor do kit é somente leitura.
- A RPC de busca passou a projetar e filtrar o fornecedor e o SKU de origem do
  kit, preservando assinatura, formato, `security definer`, `search_path` e
  execução exclusiva de `service_role`.
- O recálculo só enfileira Mercado Livre quando o estoque do kit realmente muda.
  Automação de preço continua bloqueada.

Kits compostos permanecem sem fulfillment DSLite. Na fotografia produtiva, os
sete kits compostos existentes estavam inativos; os 1.021 kits ativos eram
simples e tinham oferta correspondente ao único fornecedor configurado.

## Validação local

- Testes direcionados finais: `109/109` aprovados.
- Suíte integral: `1.557` aprovados, zero falhos e três ignorados previstos.
- `npm run validate`: aprovado (ESLint e `tsc --noEmit`).
- `npm run build`: aprovado com Next.js `16.3.3`.
- `npm run check:build-secrets`: aprovado.
- `git diff --check`: aprovado.
- O replay no Supabase DEV local não foi executado porque o runtime Docker local
  estava indisponível. As migrations foram transacionais, aplicadas somente
  depois do preflight do `.162` e conferidas por read-back.

## Produção Bentevi

Os commits `529cc09ce8f45148fc9b88c0990999eb671f01c9` e
`4b2cba9bbfd0e58d2d26dfedad1e6fd499b3c98e` foram enviados para `origin/dev` e
promovidos por fast-forward para `origin/bentevi-prod`, sem integração com
`main`. O deploy oficial do SHA final foi aceito pelo webhook do serviço
`local/bentevi-prod`; o novo processo iniciou por volta de
`2026-09-15T13:33:19Z`. O health permaneceu HTTP `200`, `success=true` e
`ml_auth=ok`.

O preflight confirmou conexão gravável direta com `192.168.1.162`, PostgreSQL
`17.6`, banco `postgres` e usuário efetivo `postgres`. As migrations
`20260915113000_kit_supplier_source_search.sql` e
`20260915114000_repair_pending_kit_order_cmv.sql` foram registradas. A RPC final
tem uma única assinatura de dez parâmetros, `security definer`,
`search_path=pg_catalog, pg_temp`, execução por `service_role` e nenhuma execução
por `anon` ou `authenticated`. A busca por `VTK016028` filtrada pelo fornecedor
`108` retornou um item, fornecedor BKR1 e estoque 2.

Antes das escritas, a tabela privada
`private.kit_supplier_source_backup_20260915_529cc09c` guardou 1.021 snapshots
de pais de kit, um pedido, um item e a definição/ACL da RPC. A verificação
totalizou 1.024 linhas e digest
`ec1d47dac65a955f7b90369f1907c2ee`. A tabela não concede acesso a `anon`,
`authenticated` ou `service_role`.

O job canônico `6b047268-40eb-4bbf-89ad-2a92f4628e36`, restrito ao fornecedor
BKR1, terminou `completo` em 47.086 ms: 20 páginas, 1.951 registros vistos,
1.756 atualizados, 177 sem produto local, zero linha falha e cursor esgotado. O
recálculo atualizou 338 kits. O read-back de todos os 1.021 kits ativos encontrou
zero divergência de custo e zero divergência de estoque contra a oferta do
fornecedor configurado.

Foram criadas 17 intenções `kit_stock_automation`: todas terminaram `done`, sem
erro e com uma tentativa. Houve 17 operações de quantidade confirmadas e três
operações adicionais de pausa com HTTP `200`; três anúncios ficaram com
quantidade zero/pausados e os demais com quantidade positiva/ativos. Nenhuma
intenção tinha `desired_price`; `ml_price_products_updated` e
`ml_price_outbox_enqueued` permaneceram zero.

No caso `VTK016028`, o read-back final confirmou fornecedor BKR1, estoque 2,
custo R$ 482,88, origem `2295CX48` e oferta do produto DSLite `2295` a R$ 10,06.
O saldo interno físico continuou zero.

## Ocorrência concorrente na venda original

Durante o primeiro build, antes do restart que ativou a correção, o processo
antigo criou a compra DSLite `409605` para a venda `2000018469395176`. A compra
foi registrada às `2026-09-15T13:26:50Z` com MKS (`115`), produto `2295`, 96
unidades, valor de fornecedor R$ 960,00 e pagamento pendente. A nota e o vínculo
DSLite já existiam quando a migration de reparo tentou adquirir a linha.

O guard interrompeu a primeira tentativa sem aplicar mudança. A migration foi
então ajustada e promovida para fazer no-op quando já existe `dslite_id`: o CMV
da venda permaneceu R$ 480,00 unitário/R$ 960,00 total e o lucro R$ 167,54,
coerentes com a compra MKS efetivamente criada. Não foi gravado evento falso de
reparo.

Cancelar ou recriar essa compra e seus documentos para transferi-la à BKR1 é um
efeito externo diferente do reparo local planejado e depende de decisão
operacional específica. A correção sistêmica vale para novas compras; a compra
`409605` não foi cancelada, desvinculada, duplicada nem paga por esta ação.

## Recuperação

Reverter progressivamente os commits funcionais, promover o novo SHA de
reversão para `bentevi-prod` e reimplantar. Restaurar cegamente os snapshots do
backup não é seguro depois de novas sincronizações; se houver incidente, parar
o writer do domínio `produtos:dslite_preco`, comparar as linhas atuais com a
tabela privada e restaurar somente o delta comprovadamente causado por esta
ação. A definição anterior da RPC também está no backup privado.

As 17 alterações já confirmadas no Mercado Livre não são desfeitas por rollback
de código ou banco. Reconciliar o estado remoto por leitura e, se necessário,
publicar a capacidade correta pela outbox canônica. A compra DSLite `409605` é
um efeito externo preservado e exige plano próprio antes de qualquer
cancelamento ou substituição.
