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

A imagem atual do ML e a [imagem fornecida pela Evolusom](https://www.evolusom.com.br/resistencia-para-ferro-de-solda-hikari-hk-plus-cr30-220v-com2pc-106673)
mostram visualmente a mesma resistência, não um ferro completo. A foto do
fornecedor é ilustrativa e mostra uma peça; o nome do produto no fornecedor
informa duas peças. Não há segunda foto na página do fornecedor. O arquivo
original obtido do domínio `www.evolusom.com.br` é JPEG `1000 × 1000`, com
SHA-256 `7230f5ebae7c73e2c304a818b7e0cc56f0295577bd1fc5bd34a7331524ebed06`.
A URL original no cadastro redireciona; o objeto público do Bentevi será
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

## Resultado

Pendente de execução e read-back produtivo.
