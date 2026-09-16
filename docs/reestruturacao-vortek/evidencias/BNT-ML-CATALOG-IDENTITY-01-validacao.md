# BNT-ML-CATALOG-IDENTITY-01 — contenção e auditoria do catálogo

**Data:** 14–15/09/2026
**Estado:** contenção P0 aplicada no banco produtivo; dry-run integral somente leitura concluído; correções aguardam aprovação do manifesto.

## Resultado entregue

- guard final fail-closed para qualquer escrita automática de preço sem identidade atual `SEM_CONFLITO` e fonte ML disponível;
- preservação explícita da alteração manual individual, sem usar `custom_price` como prova;
- invalidação automática da liberação quando o snapshot muda em campo material;
- ledger privado de execuções, itens, projeção atual e decisões, com RLS e acesso apenas pelo backend;
- importação CSV/XLSX limitada a 15 MB e exatamente 1.550 `ml_item_id` únicos, com SHA-256 do arquivo;
- classificação determinística de modelo, capacidade, quantidade, comprimento, dimensão, voltagem, bateria, família, marca, GTIN, SKU e variante de cor;
- GTIN isolado deixou de criar proprietário local no refresh do catálogo;
- dry-run retomável em lotes de 20, reconciliação do baseline com o delta vivo, consulta ML atual, safety stops, manifesto imutável e aprovação separada;
- tela `Catálogo > Saneamento de identidade`, fila de revisão e os dez entregáveis executivos, além da fila premium separada.

O dry-run não altera relação, preço, estoque ou `produtos.ativo`. A aprovação do manifesto também não aplica correções. Ações remotas permanecem `REQUIRES_CONFIRMATION` e exigem administrador; não foi implementado bypass nem estado inicial `AUTO_SAFE`.

## Banco produtivo

O preflight comprovou o destino `192.168.1.162`, banco `postgres`, usuário administrativo interno, PostgreSQL 17.6, 138 migrations antes da ação e última versão `20260914090000`. Os pré-requisitos `anuncios_ml_outbox`, `catalogo_ml_snapshot`, `ml_pricing_groups`, `profiles`, UUID em `jobs.id` e JSONB em `anuncios_ml_outbox.payload` estavam presentes.

A migration `20260914180000_bnt_ml_catalog_identity_01.sql` foi ensaiada integralmente duas vezes em transação com `ROLLBACK`, `lock_timeout=5s` e `statement_timeout=60s`. Depois, foi aplicada em uma única transação serializável e registrada em `supabase_migrations.schema_migrations`.

Readback após commit:

- quatro tabelas `ml_catalog_identity_*`, todas com RLS;
- zero execuções, auditorias, projeções e ações;
- dois triggers de segurança ativos;
- funções de assert e claim presentes;
- zero grants diretos a `anon` ou `authenticated`;
- chamada manual aceita e chamada `price_to_win` sem projeção `SEM_CONFLITO` recusada;
- trigger da outbox aceitou o caminho manual comprovado e recusou o mesmo registro ao simular origem `price_to_win`, tudo em transação revertida;
- SQL registrado e arquivo versionado com SHA-256 idêntico `261c7215abe52b35da0bd96faa08da93222dc28a528cd5d0f38e860b9f044868`;
- 10.125 produtos ativos antes e depois;
- uma saída de preço pendente antes e depois, comprovadamente manual, com ator e operação individual.

Nenhum preço, vínculo, estoque, anúncio ML ou campo `produtos.ativo` foi alterado. Não houve chamada remota de mutação ao Mercado Livre.

## Validação de código

- 17/17 cenários novos do classificador, importador, guard, migration e interface;
- 69/69 regressões dirigidas de catálogo, pricing, permissões e shell;
- suíte integral: 1.501 aprovados, zero falhas e um teste previamente ignorado;
- `npm run validate` aprovado;
- `npm run build` aprovado com Next.js 16.3.3 e 142 rotas/páginas;
- `npm run check:build-secrets` e `git diff --check` aprovados;
- `npm audit --omit=dev`: cinco classes high já existentes em `axios`, `form-data`, `nodemailer`, `sharp` e `ws`; a cadeia introduzida pelo XLSX foi fixada por overrides compatíveis.

## Dry-run integral da fonte canônica reconstruída

O artefato `P0_CATALOGO_ML_1550_UNIVERSO_FONTE_2026-09-14.csv`, reconstruído deterministicamente do PDF original, passou os três gates antes da leitura viva:

- SHA-256 `59cdbbc17ae5d991a036b5fd4e0d584fa791f6747cab871b57424c220bc76d38`;
- 1.550 linhas e 1.550 `ml_item_id` distintos preenchidos;
- 1.549 SKUs distintos, preservando separadamente os dois anúncios de `VTK009697` (`MLB7210717968` e `MLB4907843137`).

A execução autoritativa `BNT-ML-CATALOG-IDENTITY-01-20260915031250` terminou em 15/09/2026, após join server-side por `anuncios_ml.ml_item_id` e `produto_id`, sem fallback por SKU: 1.550 anúncios, 1.550 snapshots e 1.550 produtos foram resolvidos. A leitura atual do Mercado Livre e do Supabase produtivo utilizou exclusivamente 3.308 requisições GET e 8 HEAD; o bloqueador registrou zero tentativa de método mutante.

Resultado da classificação conservadora:

- 21 `CONFLITO_CONFIRMADO`;
- 158 `PENDENCIA_VALIDACAO`;
- 1.371 `SEM_CONFLITO` candidatos a liberação somente após aprovação;
- zero `INCONCLUSIVO` e zero erro de execução;
- uma anomalia ML: `VTK017201` permaneceu `listed` pelo motivo vivo `shipping_mode_not_specified_me2`;
- os casos canônicos TP-Link, Hiksemi, Santo Angelo, Panasonic, Leson e a família Elgin A23/A27 permaneceram isolados;
- os dois `ml_item_id` de `VTK009697` foram avaliados individualmente, sem deduplicação silenciosa.

Os dez artefatos estão em `reports/catalog-identity-p0/BNT-ML-CATALOG-IDENTITY-01-2026-09-15-readonly-final/`. O manifesto lógico possui hash `321ee56989aba0814a7daf6f367829ebe0b64b97dd75e21123fb2e4f08e150ff`; o arquivo `10_rollback_manifest.json` possui SHA-256 `de0346275b6f2bc86a5efce31bf5e0e173ab531f8e572db6c8715e82ba3c8c1a`, e todos os checksums internos foram recalculados sem divergência.

Readback antes/depois confirmou zero alteração em vínculo, preço observado, `produtos.ativo` e `produtos.custom_price`. As quatro tabelas do ledger permaneceram vazias antes e depois. Os arquivos 05, 06, 07 e 08 contêm somente cabeçalho: nenhuma correção, repricing, fila econômica ou erro foi persistido nesta etapa.

Validação do executor e da regra final:

- 41/41 cenários dirigidos aprovados, incluindo fonte canônica real, barreira GET/HEAD, invariantes, duplicidade de SKU e regressões das heurísticas materiais;
- 76/76 cenários aprovados ao combinar a suíte dirigida com o contrato documental do Assistente;
- `npm run validate`, ESLint dirigido, `node --check`, `npm run build` com Next.js 16.3.3 e 142 rotas/páginas e `git diff --check` aprovados.

## Gates pendentes

1. Revisão e aprovação explícita do diff/manifesto antes de qualquer correção de vínculo.
2. Os 158 casos inconclusivos por evidência devem permanecer na fila manual e bloqueados para pricing.
3. A causa operacional de `VTK017201` deve ser tratada separadamente; desconto não corrige `shipping_mode_not_specified_me2`.
4. Filas econômicas e eventual liberação de pricing só podem ser reconstruídas depois do saneamento e do readback das correções aprovadas.

## Recuperação

O código pode ser revertido pelo commit funcional desta entrega. No banco, a recuperação preferencial é progressiva: primeiro reverter o código dependente; somente com autorização explícita remover o trigger `trg_ml_catalog_identity_outbox_guard`. As quatro tabelas e funções só podem ser removidas se continuarem vazias e nenhum consumidor estiver ativo. Enquanto a ordem executiva vigorar, retirar o guard não é uma ação de rollback autorizada.

## Fechamento produtivo controlado — preparação de 15/09/2026

A ordem de fechamento autorizou Rodrigo (`3e56ce48-f461-4784-848b-097d1e482a43`), confirmado por readback como administrador, e consolidou o universo em 1.526 identidades claras, 22 conflitos confirmados e duas pendências. A implementação de fechamento:

- preserva `ml_item_id` como unidade de trabalho e os dois anúncios de `VTK009697`;
- reapresenta as 1.371 projeções originalmente claras e os 155 releases executivos, mantendo os 24 bloqueios explícitos;
- serializa os quatro domínios concorrentes, renova os locks e aplica projeções em transações de no máximo 25 itens;
- captura hashes globais de produtos, anúncios, relações e outbox antes/depois;
- exige Rodrigo como ator, readback vivo, manifesto imutável e reconciliação `1.550 = 1.526 + 24`;
- não contém método mutante para o Mercado Livre nem escrita em preço, estoque, `custom_price`, `produtos.ativo`, vínculo ou status.

A composição canônica foi novamente conferida: 1.550 `ml_item_id`, 1.549 SKUs, 1.526 `SEM_CONFLITO`, 22 `CONFLITO_CONFIRMADO` e duas `PENDENCIA_VALIDACAO`. PostgreSQL 17.5 aceitou as migrations em transação revertida, aplicação e reaplicação idempotente. A suíte integral aprovou 1.545 testes, com três testes já marcados como ignorados, além de `npm run validate`, build Next.js 16.3.3 e verificação de secrets.

O preflight produtivo confirmou `192.168.1.162`, ledger ainda vazio e ausência da RPC de lote antes da migration. Entretanto, `SUPABASE_DB_URL` não estava disponível no ambiente seguro e o SSH autenticado à `.162` foi recusado. Conforme a própria ordem, a execução produtiva foi interrompida como `BLOCKED_CREDENTIAL` antes de migration, promoção, deploy ou escrita de dados. Nenhum estado produtivo foi alterado nesta tentativa.

## Execução produtiva controlada — resultado parcial de 15/09/2026

O acesso SSH seguro à `.162` foi estabelecido por chave local, sem versionar ou registrar senha. A release P0 isolada `b28a96741385481cdbdac9ff202c15e3e3bea7db`, derivada da base produtiva `1a21393bad6779df3b9d20da02221943c8dd5088`, foi promovida por fast-forward e publicada no serviço `local/bentevi-prod`. O delta não acrescentou nem modificou arquivos BVF; testes `bvf-*` foram excluídos do gate final por ordem executiva.

As migrations `20260915050000`, `20260915110000`, `20260915120000` e `20260915130000` foram aplicadas transacionalmente no PostgreSQL 17.6 após backup verificável. Os dois últimos deltas corrigem o schema do `pgcrypto` no snapshot de segurança e aceitam `produto_id` nulo no snapshot somente quando o anúncio local fornece o vínculo canônico; divergência não nula continua bloqueada.

O run final `a193f074-b307-4902-b250-188f752c6218`, manifesto `a63764e8f156d33665c30ce120b87573129ded32073288965c96fb26fb5f685d`, processou 1.550 auditorias e 1.550 ações, todas com Rodrigo (`3e56ce48-f461-4784-848b-097d1e482a43`) como ator. Os 155 releases da auditoria executiva foram liberados, incluindo os três title drifts autorizados. Sete drifts novos na população original foram bloqueados individualmente: `VTK017395`, `VTK017306`, `VTK017415`, `VTK017455`, `VTK018822`, `VTK017315` e `VTK017997`.

Resultado real: 1.519 `SEM_CONFLITO`, 22 `CONFLITO_CONFIRMADO` e 9 `PENDENCIA_VALIDACAO`, totalizando 1.550 com 31 bloqueados. O safety stop `RECONCILIATION_FAILED:1550:1519:31:7` manteve o run pausado e impediu declarar a P0 concluída. Snapshots before/after de produtos, preços, estoque, relações e outbox foram idênticos: zero repricing, relink, alteração de estoque, `custom_price` ou `produtos.ativo`.

Os artefatos finais e o pacote parcial estão em `reports/catalog-identity-p0/BNT-ML-CATALOG-IDENTITY-01-2026-09-15-production-closeout-final/` e na pasta Downloads. A próxima ação deve reauditar somente os sete novos drifts; a análise econômica permanece não autorizada enquanto a reconciliação 1.526/24 não for recuperada ou formalmente substituída.

## Fechamento produtivo — 16/09/2026

Os sete drifts anteriores e mais vinte divergências de título observadas após a sincronização completa foram revalidados por identidade. O readback confirmou SKU, `ml_item_id`, `catalog_product_id`, GTIN, marca, modelo, família e atributos materiais. O anúncio `VTK022543` já estava pausado e permaneceu pausado; o status operacional não foi alterado.

A release final `84069a6a2735e74e4316644e89765d3b5a53ae5d` foi promovida para `bentevi-prod`. O delta final não contém Video Factory e os testes BVF não foram executados. `npm run validate` e nove testes direcionados foram aprovados.

O run produtivo `2be391e2-668f-468e-8efa-07fdc2be4da1`, com Rodrigo (`3e56ce48-f461-4784-848b-097d1e482a43`) como ator, liberou os 27 registros após novo readback vivo. O ledger confirmou 27 ações concluídas. A reconciliação final ficou em 1.526 `SEM_CONFLITO`, 22 `CONFLITO_CONFIRMADO`, duas `PENDENCIA_VALIDACAO` e zero `INCONCLUSIVO`: `1.550 = 1.526 + 22 + 2`.

Os snapshots antes/depois do executor confirmaram zero alteração em preço, `custom_price`, estoque, `produtos.ativo`, vínculo, status de anúncio, outbox e relink. Nenhum repricing foi executado. Os 24 bloqueios continuam ativos para pricing. Os artefatos consolidados estão em `reports/catalog-identity-p0/BNT-ML-CATALOG-IDENTITY-01-2026-09-16-production-final/`.
