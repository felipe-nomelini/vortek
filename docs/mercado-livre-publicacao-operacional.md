# Publicação Mercado Livre — Procedimento Operacional

Este documento registra regras práticas validadas na criação de anúncios do Vortek.

## Regra central

Não criar anúncio até validar, por produto e por categoria:

1. categoria ML precisa;
2. atributos obrigatórios e condicionais;
3. valores permitidos pela categoria;
4. dados do fornecedor/fabricante e imagens;
5. preço, estoque e logística.

Nunca inventar especificação. Quando não houver evidência, usar `Não se aplica` apenas se a categoria aceitar.

## Fluxo obrigatório

1. Consultar produto local, oferta do fornecedor, GTIN, dimensões, peso, descrição e fotos.
2. Consultar previsão de categoria e validar domínio/categoria retornados pelo ML.
3. Consultar `GET /categories/{CATEGORY_ID}/attributes`.
4. Consultar atributos condicionais via `POST /categories/{CATEGORY_ID}/attributes/conditional` com payload completo.
5. Pesquisar fabricante/fornecedor/web quando atributo crítico estiver ausente.
6. Para atributos `list`, enviar o `value_id` oficial; não enviar texto livre fora da lista.
7. Criar um anúncio por vez e confirmar retorno ML antes do próximo.
8. Após criar, consultar item, atributos, descrição, imagem, status e substatus.

## Atributos

### Dados confirmados

Preencher com fonte confiável: fabricante, fornecedor, GTIN, embalagem ou documento técnico.

Exemplos:

- `MODEL`: modelo real do fabricante.
- `MOUNTING_PLACES`: usar valor oficial da lista. Para suporte Multivisão Easy, fornecedor informa parede e painel de madeira; ML aceita `Parede` (`value_id: 7720908`). "Painel de madeira" deve ficar na descrição.
- Cabo RCA: preencher tipo, comprimento, diâmetro, quantidade e gênero dos conectores quando confirmados.

### Não se aplica

Para atributos sem evidência ou incompatíveis com produto, enviar:

```json
{
  "id": "ATTRIBUTE_ID",
  "value_id": "-1",
  "value_name": null
}
```

Não usar `"value_name": "Null"`: ML pode aceitar HTTP 200 e descartar valor. Confirmar depois com:

```text
GET /items/{ITEM_ID}?attributes=attributes&include_internal_attributes=true
```

Preencher todos atributos visíveis da categoria: dado confirmado ou `Não se aplica`. Excluir somente atributos ocultos/fixos.

## Descrição

Descrição deve ser texto simples, factual e escaneável. Não copiar descrição bruta do fornecedor como bloco único.

Estrutura padrão:

```text
NOME DO PRODUTO

Resumo objetivo: produto, aplicação/compatibilidade e uso.

CARACTERÍSTICAS
• especificação confirmada
• especificação confirmada

BENEFÍCIOS
• benefício derivado de especificação confirmada
• benefício derivado de especificação confirmada

DIMENSÕES DA EMBALAGEM
• comprimento x largura x altura
• peso bruto

SKU: ...
```

Usar quebras de linha e bullets. Não prometer função, compatibilidade, certificação ou desempenho sem evidência.

Para anúncio próprio fora de catálogo, atualizar descrição existente com:

```text
PUT /items/{ITEM_ID}/description?api_version=2
```

### Anúncio de catálogo

Em `catalog_listing=true`, título, descrição e ficha são conteúdo do catálogo ML. Conferir o produto vivo e o vínculo após criação; não enviar POST/PUT de descrição. O ML rejeita edição com `Description is not modifiable on catalog listing item`. O endpoint de descrição do item pode retornar 404 mesmo quando `/products/{catalog_product_id}` contém a descrição: consultar o produto, sem interpretar esse 404 como anúncio incompleto.

Revisar contradições materiais no conteúdo do catálogo antes do POST. O texto personalizado preparado pelo ERP não substitui conteúdo de catálogo. Fonte: [Buscador de produtos — conteúdo de catálogo](https://developers.mercadolivre.com.br/buscador-de-produtos).

O frete vivo por dimensões anterior à criação pode diferir do frete vivo por `item_id`. A leitura econômica posterior é obrigatória; se ficar abaixo do piso, pausar, diagnosticar e corrigir sob autorização registrada antes de ativar. Registrar preço anterior/novo e ambas as memórias; nunca repetir POST de criação.

## Imagens

### Requisito

Autorização da Diretoria em 08/09/2026 para `EVOLUSOM_PREMIUM_BATCH_06`: usar Upscayl nas fotos abaixo do mínimo. Preservar a origem, registrar hashes do original e da saída, modelo, escala e revisão visual em `review.upscaylImages`. O preparador confere esses hashes, publica a imagem ampliada no Storage e envia os mesmos bytes ao ML. Só usar o resultado depois de conferir que continua representando o produto; imagem ampliada não comprova especificações ausentes. A leitura das dimensões após processamento ML continua obrigatória.

O bloqueio de tamanho do preparador segue a validação ML `3703`: pelo menos 500 px em um lado. Os 250 px no lado menor são preferência de qualidade, sem bloquear fotografias estreitas de cabos que atendam ao mínimo oficial. A aprovação efetiva do upload e do payload continua obrigatória.

URL de imagem precisa ser pública, estática, direta, sem redirecionamento e retornar `Content-Type` de imagem. Preferir JPG/PNG, mínimo 250 px em ambos lados e pelo menos 500 px em um lado; preferir resoluções maiores. Conferir também o tamanho após o processamento pelo ML. O limite inclui 500 px, conforme a [validação oficial de imagens](https://developers.mercadolivre.com.br/en_us/authentication-and-authorization/validations).

### Falha encontrada

URLs `https://evolusom.com.br/...jpg` retornavam:

```text
HTTP 301
Content-Type: text/html
```

ML não aceitou redirecionamento e deixou itens em `picture_download_pending`, depois `under_review / waiting_for_patch`.

### Correção padrão

1. Baixar origem direta (Evolusom usa `https://www.evolusom.com.br/...`).
2. Validar status HTTP, Content-Type e dimensões.
3. Salvar cópia no bucket público Supabase `product-images`.
4. Atualizar `produtos.imagens` com URL pública Vortek.
5. Atualizar ML via `PUT /items/{ITEM_ID}` com:

```json
{
  "pictures": [{ "source": "https://supabase.vortek.shop/storage/v1/object/public/product-images/..." }]
}
```

6. Consultar `/pictures/{PICTURE_ID}/errors` e status do item até processar.

Nunca usar URL de fornecedor que retorna 301/302, HTML, bloqueio ou Content-Type incompatível.

Nos lotes preparados, enviar as fotos dos anúncios tradicionais diretamente ao ML com `POST /pictures/items/upload` (multipart), usando os mesmos bytes verificados e guardados no Storage. Registrar os IDs na preparação e criar com `pictures: [{ id: picture_id }]`. O envio por `source` inicia uma etapa assíncrona de download; os IDs permitem reutilizar as imagens já enviadas. Conferir fotos e status após criar em ambos os casos. Fonte: [envio e associação de imagens](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/trabalhar-com-imagens).

## Estados pós-publicação

- `paused` + `picture_download_pending`: ML está baixando imagem por URL.
- `under_review` + `waiting_for_patch` + `picture_download_pending`: imagem anterior falhou; reenviar URL válida.
- `active`: publicação liberada.

Não tratar criação como concluída enquanto imagem e ficha não forem verificadas.

## Verificação final por anúncio

1. `ml_item_id` salvo no produto e em `anuncios_ml`.
2. Categoria/dominio corretos.
3. Atributos principais preenchidos.
4. Todos secundários preenchidos com dado real ou `Não se aplica`.
5. Descrição com resumo, características, benefícios e dimensões quando disponíveis.
6. Foto no Storage Vortek e URL pública direta.
7. Diagnóstico de imagem sem erro.
8. Status/substatus ML compatíveis com processamento ou publicação ativa.

## Publicação com política canônica M2M

A regra anterior de proteção universal de 50% foi aposentada. Seguir [o contrato canônico](pricing-radar-canonico.md).

1. Validar identidade, duplicidade, apresentação/quantidade, categoria, atributos e imagens reais.
2. Resolver oferta elegível e simular o alvo pela faixa de preço final, usando cotação ML viva e tributo central identificado como estimado ou confirmado.
3. Registrar aprovação individual e revisão explícita das pendências; não fabricar dados ausentes.
4. Revalidar as entradas aprovadas e criar no preço aprovado. Confirmar leitura remota e persistir vínculo e trilha econômica.
5. Recotar após criação; discrepâncias geram revisão. Fonte indisponível não autoriza pausa econômica automática.
6. Descontos por quantidade foram removidos. Leitura remota somente para auditoria; não criar, editar ou renovar faixas.

Qualidade, exposição e demanda são dimensões comerciais independentes. Dimensões normalizadas pelo ML não substituem silenciosamente o cadastro do fornecedor. Publicação automática em massa continua sem autorização.

## Fontes oficiais

- https://developers.mercadolivre.com.br/pt_br/pt_br/publicacao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes
- https://developers.mercadolivre.com.br/pt_br/como-comecar/qualidade-das-publicacoes
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos
- https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/trabalhar-com-imagens
- https://developers.mercadolivre.com.br/pt_br/envio-de-produto/diagnostico-de-imagens
- https://supabase.com/docs/guides/storage/serving/downloads

## Garantia comercial homologada

Seguir o [Cânon e os complementos expressamente aprovados](canon-comercial-vortek-bentevi-1.0.md). Fabricante comprovado → fornecedor comprovado → garantia do vendedor de 30 dias, conforme emenda homologada em 06/09/2026. Não aplicar prazo genérico de marca ou de outro produto.

O resolvedor mantém origem, prazo, unidade e evidência separados dos termos ML. Para fornecedor/fallback do vendedor, a representação aceita de vendedor não muda a origem interna nem permite descrição de garantia de fabricante. A categoria deve aceitar a representação; garantia ausente não vira 12 meses ou primeiro valor da lista. O readback confere os termos aprovados.

A instrução de 12 meses usada na coorte anterior é histórica e foi substituída para novas decisões pelo Cânon. Anúncios existentes não foram modificados por esta adequação.

## Lote CATALOG_EXPANSION_BATCH_01

A rota canônica exige preparação persistida, preço aprovado, consulta viva ao fornecedor e ML, chave por lote/produto e readback. Safety stop fica na trilha e no bloqueio operacional até revisão. A retomada exige validação posterior do mesmo produto/anúncio, referenciando expressamente o evento de parada. Correção de preço precisa de aprovação e aplicação confirmada, preservando os valores e memórias anteriores. Não reutilizar o runner histórico.

Uma nova tentativa após erro sem ID remoto exige autorização expressa do usuário e nova conferência completa da conta e das duas buscas por SKU. Registrar `CATALOG_EXPANSION_RETRY_AUTHORIZED` referenciando a tentativa original e a evidência da busca sem correspondências. Essa autorização permite uma única tentativa do mesmo produto, com chave própria; não apaga o pedido anterior, não libera outros produtos pendentes e não supera safety stops ou anúncio remoto já identificado. Repetição automática continua proibida.

## Revisão de categoria e substituição no lote

O preditor sugere categorias; a revisão compara a aplicação informada pela DSLite com toda a árvore e o domínio. A preparação registra `categoryReview` com versão, oferta/produto do fornecedor, texto de origem, aplicação, trecho usado, categoria, árvore e domínio. Preparações anteriores sem essa revisão não autorizam novos POSTs. A rota compara novamente a oferta viva antes da criação e confere a categoria no retorno.

Substituição de categoria usa `replacementAuthorizationId`, distinto da autorização de retentativa. A autorização persistida vincula produto, item antigo e nova preparação, com arquivo do anúncio anterior, exclusão confirmada e ausência de vendas/pedidos. Uma tentativa de substituição incompleta bloqueia o lote mesmo que o produto tenha uma publicação anterior validada. Não apagar eventos anteriores. Não reutilizar a verificação econômica do item antigo para o novo.

Antes de excluir: validar integralmente o novo payload e confirmar a ausência de vendas/pedidos. Usar o mecanismo existente de exclusão e desvinculação, confirmar `deleted`, registrar a autorização e criar exclusivamente pela rota canônica. Restrições de política do ML permanecem impeditivas. Se a categoria correta não oferecer `me2`, manter pendente; não escolher uma categoria incompatível para obter frete.

A validação de payload e o primeiro retorno `active` não encerram a moderação do ML. Ao observar `under_review/forbidden`, o reconciliador usado pelo webhook e pela sincronização registra uma parada idempotente para o lote de origem, inclusive se o vínculo local ainda não foi salvo. Se esse registro falhar, o webhook não confirma o processamento como concluído. Na retomada, o executor consulta novamente status, categoria e SKU mesmo quando já existe verificação econômica salva.

O executor confere as paradas persistidas antes de iniciar e antes de simular, aprovar, publicar ou ajustar preço. Falha de simulação ou publicação sem validação interrompe a execução; não aciona recuperação econômica genérica nem passa ao produto seguinte. O script temporário `evolusom-replacement-run.cjs` foi desativado após continuar indevidamente em erro de estado.

O relatório do lote usa todos os SKUs autorizados e consulta o estado remoto atual. Substituições são contadas separadamente de produtos únicos. Eventos históricos de validação não comprovam estado atual nem correção de categoria; o relatório não reescreve o manifesto.
