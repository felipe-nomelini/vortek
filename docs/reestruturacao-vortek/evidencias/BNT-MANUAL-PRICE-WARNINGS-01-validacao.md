# BNT-MANUAL-PRICE-WARNINGS-01 — Preço manual sem bloqueios comerciais

Data: 13/09/2026

Branch de desenvolvimento: `dev`

Destino: `app.bentevi.shop` e Supabase Bentevi produtivo `.162`

## Resultado implementado

Os fluxos de Catálogo, Anúncios e Produtos passaram a permitir a decisão
manual mesmo quando margem, lucro, fontes econômicas, identidade comercial,
grupo M2M, variações ou igualdade com o preço observado exigem atenção. Todos
esses estados são preservados como avisos visíveis e auditáveis.

Os bloqueios técnicos permanecem: sessão e perfil autorizados, item pertencente
ao produto e ao seller conectado, valor positivo, operação concorrente,
idempotência, claim único e revalidação do preço remoto observado.

Quando a automação nativa do Mercado Livre está ativa, a operação registra a
intenção durável, envia `DELETE /pricing-automation/items/{ITEM_ID}/automation`
uma única vez e confirma a ausência antes do `PUT` de preço. Uma resposta
incerta entra em reconciliação somente por leitura. O botão genérico de nova
tentativa foi retirado para não repetir uma mutação cujo efeito é desconhecido.

O sucesso do preço agora depende do read-back do anúncio escolhido. Pares de
catálogo não atrasam nem invalidam essa confirmação; sua propagação permanece
assíncrona e é observada pelas sincronizações regulares.

## Banco e recuperação

A migration `20260913233000_manual_price_without_commercial_blocks.sql` torna o
grupo opcional para preço manual, acrescenta serialização por seller/item e os
marcos duráveis da remoção de automação. As funções transacionais deixam de
exigir governança econômica, grupo verificado e confirmação síncrona de todos
os pares, mantendo ACL exclusiva de `service_role` e RLS existente.

Antes da aplicação, o preflight confirmou o destino HTTP direto
`192.168.1.162`, PostgreSQL 17.6 no banco `postgres`, zero operação/outbox de
pricing aberta e zero duplicidade ativa por item. A fotografia privada e
recuperável das constraints, índices e seis funções substituídas foi salva fora
do repositório e conferida pelo SHA-256
`ee58f20c0c694fb15d3c5806ddb3f38c01dd9c825fcbd2b7fecefc58427755b9`.
A fotografia separada das 15 operações históricas cujo seller é derivado do
grupo foi conferida pelo SHA-256
`90accac310f9f697afb8e12b922e313eb340b1c810946342649a1f9c8331e0e1`.
A migration completa foi ensaiada no mesmo destino dentro de transação e
revertida com `ROLLBACK`; as colunas, backfill, constraint, índice e remoção dos
guards comerciais foram verificados antes do rollback.

O rollback seguro é progressivo: primeiro desabilitar novas execuções pelo
modo do executor, aguardar operações abertas e então restaurar as funções e a
constraint capturadas. Colunas auditáveis podem permanecer sem efeito. Depois
de uma mutação remota não se deve restaurar preço cegamente nem repetir o
comando; o item deve ser relido e reconciliado.

## Validação

- 107/107 testes direcionados cobrem avisos sem bloqueio, ausência de grupo,
  read-back somente do item, remoção única da automação e ausência de retry
  mutante;
- suíte completa: 1.454 cenários, 1.453 aprovados, zero falhas e um caso vivo
  explicitamente ignorado;
- `npm run validate`, `npm run build` com Next.js 16.3.3 e 133 páginas/rotas,
  `npm run check:build-secrets` e `git diff --check` aprovados;
- o ensaio local do Supabase não foi executado porque o Docker está
  indisponível para o usuário atual; o ensaio transacional no `.162` foi usado
  como validação SQL sem persistir alterações;
- SHA promovido, migration aplicada, deploy e smoke serão registrados abaixo
  após a publicação.
