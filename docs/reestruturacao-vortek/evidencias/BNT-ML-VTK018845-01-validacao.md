# BNT-ML-VTK018845-01 — correção do anúncio MLB7602426324

## Recorte e diagnóstico

Corrigir somente o anúncio `MLB7602426324` do produto `VTK018845`, preservando
o ID, o preço e a quantidade. A leitura autenticada de 25/09/2026 confirmou o
seller `3294514937`, zero vendas, preço `R$ 31,67`, quantidade `4`, status
`under_review / waiting_for_patch`, um único item `MLBU5137272890` na família
`4199865100544848` e nenhuma operação de preço ou outbox aberta para o item.

O fornecedor Evolusom identifica o item `106673` como **Resistência Para Ferro
De Solda Hikari HK Plus CR30 220 V Com 2 Pç**. O anúncio tem título `Hikari
220v`, modelo `Hikari`, atributos de ferro completo e descrição de ferros
Power de 85 W/90 W. O cadastro local traz a categoria `Antenas Para Tv`.
A moderação `INCONSISTENCY_CHECK` aponta título e imagem.

A imagem anterior do ML e a [imagem fornecida pela Evolusom](https://www.evolusom.com.br/resistencia-para-ferro-de-solda-hikari-hk-plus-cr30-220v-com2pc-106673)
mostram visualmente a mesma resistência, não um ferro completo. A foto do
fornecedor é ilustrativa e mostra uma peça; o nome do produto no fornecedor
informa duas peças. Não há segunda foto na página do fornecedor. O arquivo
original obtido do domínio `www.evolusom.com.br` é JPEG `1000 × 1000`, com
SHA-256 `7230f5ebae7c73e2c304a818b7e0cc56f0295577bd1fc5bd34a7331524ebed06`.
A URL original no cadastro redirecionava. O objeto público do Bentevi foi
validado sem redirecionamento antes de substituir a referência.

O backup privado anterior a qualquer escrita está em
`~/.local/share/bentevi-backups/VTK018845-MLB7602426324-before-20260925.json`,
com SHA-256 `bcb284c5c606fc2f62af147a622dfda19320530c43131b7f48f98f50ddcd3e56`.
Ele contém o produto, a oferta, o snapshot local, o item, a descrição, o User
Product, a família e a moderação; não contém credenciais.

## Gates da correção

1. Hospedar a foto comprovada do fornecedor no bucket público `product-images`
   e conferir GET direto, MIME, dimensões e hash.
2. Ajustar somente o cadastro mestre deste SKU: categoria local, descrição
   factual e imagem verificada, com read-back.
3. Atualizar primeiro a descrição remota; depois corrigir nome da família,
   modelo, atributos sem evidência e foto no mesmo ID, com leitura após cada
   envio e novamente após a propagação assíncrona.
4. Preservar preço e quantidade; não enviar preço junto da ficha nem forçar
   status ativo. Se a moderação persistir ou o ML rejeitar campo essencial,
   deixar o anúncio sem exposição e registrar o bloqueio. Não criar outro ID.

## Execução e resultado — 25/09/2026

- Foto do fornecedor armazenada em
  `product-images/evolusom/106673/vtk018845-7230f5eb.jpg` no Supabase
  Bentevi `.162`: GET público direto `200`, JPEG `1000 × 1000`, `53.523` bytes
  e SHA-256 igual ao original. O diagnóstico de imagem do ML retornou `200`,
  sem detecções. A imagem processada pelo ML recebeu o ID
  `939352-MLB118250476047_092026`, estado `ACTIVE`, sem erro no endpoint
  `/pictures/{id}/errors`. Conferência visual mostrou a resistência.
- O único produto `7c2fe4cc-42e4-4964-b8f7-0f083876a1ab` recebeu categoria
  local `Resistências para ferro de solda`, descrição factual e a URL da foto
  no Storage. PATCH condicionado a ID, SKU, anúncio e versão anterior afetou
  uma linha; o estoque local continuou em `4`. A sincronização de catálogo do
  fornecedor atualiza a oferta e o snapshot preferencial; sua rotina não
  sobrescreve categoria, descrição ou imagens de produtos existentes.
- A descrição remota foi alterada antes da ficha, com resposta `200` e GET
  posterior idêntico. Ela informa resistência Hikari HK Plus CR30 220 V,
  pacote com 2 peças e que a foto ilustrativa mostra uma peça. Não restou a
  descrição dos ferros Power 85 W/90 W.
- O primeiro `PUT /items/MLB7602426324` com `family_name`, atributos e foto
  foi rejeitado integralmente (`400`, `BODY_INVALID_FIELDS`, campo
  `family_name`); não houve alteração desse envio. O endpoint documentado de
  família `PUT /user-products-families/4199865100544848` aceitou (`201`) o
  nome `Kit 2 Resistências Hikari HK Plus CR30` e o modelo `HK Plus CR30`.
  Após a propagação, o título gerado foi
  `Kit 2 Resistências Hikari Hk Plus Cr30 220v`.
- A propagação ativou automaticamente o item enquanto a foto ainda não fora
  trocada. O seller o pausou por esta operação (`200`, `paused_by_seller`).
  Em seguida, `PUT /items` aceitou (`200`) a foto e os atributos: removidos
  `MAX_TEMPERATURE` e `TIP_MATERIAL`; embalagem ajustada aos dados do
  fornecedor já presentes no cadastro (`3 × 6 × 14 cm`, `50 g`). A primeira
  leitura da foto ainda mostrava o placeholder de processamento. O recurso
  `/pictures/{id}` confirmou a imagem `ACTIVE`; um `PUT` com esse ID processado
  vinculou a foto ao item (`200`) e a leitura seguinte mostrou a URL real.
- A garantia `Garantia do vendedor — 90 dias` permaneceu como condição de
  venda anterior: a fonte do fornecedor consultada não especifica garantia.
  Não foi criada uma promessa de garantia de fábrica.
- Depois da foto `ACTIVE` e de `GET /moderations/last_moderation/MLB7602426324-ITM`
  retornar `404` (moderação anterior ausente), o seller retirou a pausa
  temporária (`PUT status=active`, `200`). O read-back final confirmou item
  `active`, sem substatus, mesmo ID, seller `3294514937`, zero vendas, título
  acima, foto da resistência, SKU `VTK018845`, GTIN `7893007012014`, modelo
  `HK Plus CR30`, tensão `220V`, potência `30 W`, preço `R$ 31,67` e quantidade
  `4`. Família e User Product continuaram contendo somente este item. O
  snapshot local `anuncios_ml` foi atualizado pela sincronização e refletiu
  título, thumbnail, status `ativo` e preço. Nenhuma operação aberta do outbox.

As respostas e leituras completas, sem credenciais, estão em arquivos privados
`~/.local/share/bentevi-backups/VTK018845-MLB7602426324-*-20260925.json`.
O read-back final está em
`VTK018845-MLB7602426324-final-readback-20260925.json` no mesmo diretório.
O SHA promovido e a verificação do deploy serão registrados em
`VTK018845-MLB7602426324-release-20260925.json` no mesmo diretório.
Não houve migration, alteração de código web, ensaio no banco produtivo ou
mudança de preço/quantidade. A conferência final da API produtiva do Bentevi
`/api/ops/health` retornou `200` e `success=true`.
