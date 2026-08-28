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

Atualizar descrição existente com:

```text
PUT /items/{ITEM_ID}/description?api_version=2
```

## Imagens

### Requisito

URL de imagem precisa ser pública, estática, direta, sem redirecionamento e retornar `Content-Type` de imagem. Preferir JPG/PNG, mínimo 250 px em ambos lados e um lado maior que 500 px.

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

## Safe Publication Mode

O ciclo industrial e a otimização comercial são independentes.

1. Validar identidade, duplicidade, categoria/catálogo obrigatório, atributos e imagens.
2. Criar o item e obter o frete real por `item_id`.
3. Aplicar imediatamente preço de proteção com margem operacional mínima de 50%, usando o maior frete comprovado disponível.
4. Confirmar read-back remoto e persistir o vínculo local transacionalmente.
5. Registrar `QUALITY_OPTIMIZATION_PENDING`; qualidade, performance, completeness, health e recomendações não bloqueiam criação ou persistência industrial.
6. Registrar `COMMERCIAL_OPTIMIZATION_PENDING`; Buy Box, `price_to_win` e competitividade não bloqueiam este ciclo.

Preço protetivo não é preço comercial definitivo. Dimensões normalizadas pelo Mercado Envios não substituem silenciosamente o cadastro mestre do fornecedor.

## Preços por Quantidade (B2B)

O Vortek publica preços por quantidade no contrato percentual do Mercado Livre. A regra pertence ao backend; o navegador apenas solicita e exibe a prévia retornada por ele.

Procedimento obrigatório para alterar o preço de um anúncio:

1. consultar `GET /items/{ITEM_ID}/prices?display_version=true` e guardar o `version` atual;
2. bloquear a atualização automática se existir preço líquido B2B (`amount_tax_inclusion_type = net`);
3. confirmar que o preço `standard` remoto ainda é o preço-base esperado;
4. consultar `POST /prices-per-quantity/v1/recommendations` para as quantidades `3`, `5` e `10`;
5. usar a política Vortek de `3%`, `4%` e `5%` somente quando a recomendação responder `204`;
6. publicar em `POST /items/{ITEM_ID}/prices/price-per-quantity` com `type = discount_percentage`, contextos `channel_marketplace` e `user_type_business`, `eligible = true` e o header `X-Version`;
7. quando houver faixa absoluta legada, usar `remove-absolute-pxq=true` na mesma operação;
8. reler `GET /items/{ITEM_ID}/prices` e só considerar concluído quando quantidades e percentuais coincidirem com o payload.

Resposta `409` ou mudança do preço-base é conflito retomável pelo outbox existente. Erro de elegibilidade, recomendação inválida, preço líquido B2B ou divergência no read-back não autoriza inventar percentuais nem criar outro fluxo.

## Fontes oficiais

- https://developers.mercadolivre.com.br/pt_br/pt_br/publicacao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes
- https://developers.mercadolivre.com.br/pt_br/como-comecar/qualidade-das-publicacoes
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos
- https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/trabalhar-com-imagens
- https://developers.mercadolivre.com.br/pt_br/envio-de-produto/diagnostico-de-imagens
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b
- https://supabase.com/docs/guides/storage/serving/downloads
