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
- o SHA de implementação `82daca5e59d63f52305c58d371210d9a8d95ff29`
  foi enviado a `origin/dev` e promovido por fast-forward, sem integração com
  `main`, para `origin/bentevi-prod`.

## Aplicação e read-back produtivos

A migration `20260913233000` foi aplicada no Supabase Bentevi `.162`. O
read-back confirmou a versão registrada, as três colunas duráveis de automação,
RLS ativa, ACL das funções negada a `anon`/`authenticated` e concedida a
`service_role`, índice ativo por item, 15 sellers históricos preenchidos, zero
seller ausente, zero operação ativa e zero outbox de preço aberta.

Os três casos exibidos como inconclusivos na interface foram reconciliados por
leitura no banco e na conta produtiva real do Mercado Livre:

| Anúncio | Preço solicitado | Estado da operação | Preço vivo |
|---|---:|---|---:|
| `MLB7390922484` | R$ 299,00 | `confirmed` | R$ 299,00 |
| `MLB7608349030` | R$ 497,00 | `confirmed` | R$ 497,00 |
| `MLB7608375398` | R$ 608,00 | `confirmed` | R$ 608,00 |

O read-back também confirmou o seller esperado e a moeda BRL nos três itens.
Nenhuma mutação adicional foi enviada para produzir essa conferência.

O webhook produtivo respondeu HTTP 200 e o processo do serviço reiniciou. O
smoke posterior aprovou health e login com HTTP 200, redirecionamento das páginas
protegidas de Anúncios e Catálogo com HTTP 307 e rejeição sem sessão das APIs de
decisão e confirmação com HTTP 401. Um chunk servido por
`app.bentevi.shop` respondeu HTTP 200 e contém o novo texto que delimita o envio
ao anúncio escolhido, comprovando o artefato web novo em produção.
