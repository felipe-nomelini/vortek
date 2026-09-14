# BNT-CATALOG-PRICE-LINK-01 — vínculo de anúncio de catálogo no preço manual

Data: 14/09/2026.

## Escopo

Corrigir o falso erro `Anúncio não pertence ao produto` ao revisar o preço de um
anúncio de catálogo que possui vínculo canônico em `catalogo_ml_snapshot`, mas
ainda não possui linha derivada em `anuncios_ml`. O caso produtivo usado para o
read-back foi o SKU `VTK017371`, produto
`8c1e94d9-b846-4d0b-9ce5-ffe3c766f700`, anúncio padrão `MLB7332095162` e anúncio
de catálogo `MLB7614730328`.

## Causa confirmada

`loadPricingDetail` validava o `mlItemId` informado somente contra
`anuncios_ml` ou contra o ponteiro primário de `produtos`. O catálogo estava
corretamente vinculado ao mesmo produto em `catalogo_ml_snapshot`, mas não tinha
linha em `anuncios_ml`; por isso a API devolvia `422` antes de consultar e
revalidar o anúncio no Mercado Livre.

A investigação também encontrou uma falha independente na sincronização
observada: o payload persistido em `catalogo_ml_snapshot` continha
`listing_type_id`, coluna inexistente nessa tabela. A RPC de persistência rejeita
projeções desconhecidas, fazendo os ciclos recentes terminarem sem progresso. O
primeiro aviso de `price_to_win` no log ocultava esse erro fatal posterior.

O primeiro ciclo amplo após essa correção avançou até `1700/7055` e revelou uma
segunda divergência histórica: alguns snapshots tinham preço anterior e um
`pricing_observed_at` posterior ao `last_updated` devolvido pelo ML. Embora o GET
atual confirmasse o preço já presente em `anuncios_ml` e na trilha, o watermark
interpretava a revisão remota antiga como uma coleta velha e rejeitava o lote com
`pricing_observation_outdated_or_conflicting`.

## Correção

- O vínculo informado agora é lido em paralelo de `anuncios_ml` e
  `catalogo_ml_snapshot`, além do ponteiro primário do produto.
- Uma fonte consistente é suficiente para reconhecer o anúncio; qualquer
  proprietário divergente em uma das fontes continua retornando `422` antes da
  consulta externa.
- `listing_type_id` permanece somente em memória durante a sincronização e é
  usado para atualizar `anuncios_ml`, sem ser enviado à projeção do snapshot.
- A persistência do snapshot separa a projeção econômica, observada no instante
  atual, do metadado `last_updated_ml`, salvo depois sem campo de preço. A
  reconciliação de `anuncios_ml` usa o instante atual somente no scan observado;
  webhooks continuam respeitando o `last_updated` fornecido pelo ML.
- Falha de persistência do snapshot retorna imediatamente
  `failure_reason=catalog_snapshot_upsert_failed` e ocupa a primeira posição dos
  erros do lote.

Não houve migration, DDL, alteração de preço nem remoção dos controles técnicos
de seller, identidade remota, concorrência, idempotência e read-back.

## Validação local

- Testes direcionados: `49/49` aprovados.
- Suíte completa final: `1463` aprovados, `0` falhos e `1` ignorado previsto.
- `npm run validate`: aprovado (lint e `tsc --noEmit`).
- `npm run build`: aprovado com Next.js `16.3.3`.
- `npm run check:build-secrets`: aprovado.
- `git diff --check`: aprovado.

## Produção Bentevi

O commit funcional inicial
`7228e3a21973fc3286bd6bb8c370e9214df96e72` e a correção final de watermark
`176be89d2f400018b0ff6108d4368e6afdfe6a98` foram enviados a `origin/dev`,
promovidos por fast-forward para `origin/bentevi-prod` e confirmados no serviço
`local/bentevi-prod`. O processo da versão final iniciou por volta de
`2026-09-14T04:26Z`; health, autenticação e leitura do Mercado Livre permaneceram
saudáveis. O runtime foi reconfirmado em `production`, branch `bentevi-prod` e
Supabase `192.168.1.162:8000`, sem expor credenciais.

Depois de confirmar ausência de job/lock concorrente, um lote canônico restrito
aos dois anúncios terminou HTTP `200`, com `seen=2`, `snapshot_upserted=2`,
`failed=0`, `pricing_fields_updated=0` e
`authoritative_stock_enqueued=0`. O read-back mostrou os dois snapshots ativos,
no mesmo produto, mesmo catálogo `MLB28689689` e preço observado de `R$ 68,91`.
As baselines de pricing também permanecem em `6891` centavos. O catálogo não foi
forçado para `anuncios_ml`: a sincronização preservou a pendência de validação de
identidade, e o novo vínculo por snapshot cobre esse estado sem fabricar
evidência.

O job completo `c2d113d5-2c87-4287-b72c-2a2e1078cafd`, iniciado pela
rota canônica `POST /api/sync/run`, comprovou 17 lotes e `1700/7055` itens sem
falha individual antes de encontrar o conflito de watermark histórico descrito
acima. O ML confirmou diretamente `R$ 3.437,78` para `MLB7111654714`, igual a
`anuncios_ml` e à trilha; somente o snapshot conservava `R$ 3.858,71`. A projeção
foi reconciliada pelo RPC observacional, sem escrita no ML. O job terminou em
`erro` depois de expor outro registro com o mesmo padrão, levando à correção
sistêmica em vez de novos reparos linha a linha.

Depois do deploy do SHA final, o mesmo manifesto foi retomado de forma
controlada em `1700/7055`, sem criar outro ciclo. Ele terminou em
`2026-09-14T05:43:18Z` com status `completo`, `7055/7055`, progresso `100%` e
`failed_items_count=0`; o manifesto foi limpo pela finalização canônica. Houve
uma repetição transitória de lote em `3900/7055`, recuperada automaticamente na
tentativa seguinte, e nenhum item foi abandonado. Ao final não havia job
observado ativo nem lock em `anuncios:ml_pull`.

O read-back final do `VTK017371` confirmou o produto
`8c1e94d9-b846-4d0b-9ce5-ffe3c766f700` e os snapshots `MLB7332095162` e
`MLB7614730328` com esse mesmo `produto_id`, seller `3294514937`, SKU local e
remoto `VTK017371`, catálogo `MLB28689689`, status ativo e preço `R$ 68,91`.
Não havia proprietário conflitante. A leitura direta do ML confirmou os dois
anúncios ativos, em BRL, no mesmo preço; nenhuma publicação ou alteração de
preço foi executada durante a validação.

## Recuperação

Reverter o commit funcional, promover o novo SHA de reversão para
`bentevi-prod` e reimplantar o serviço. Não existe migration ou alteração de
schema a desfazer. Os snapshots produzidos pelo ciclo são observações idempotentes
do estado remoto e não alteram o preço no Mercado Livre.
