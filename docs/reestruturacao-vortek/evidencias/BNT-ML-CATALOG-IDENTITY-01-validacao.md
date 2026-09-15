# BNT-ML-CATALOG-IDENTITY-01 — contenção e auditoria do catálogo

**Data:** 14/09/2026
**Estado:** contenção P0 aplicada no banco produtivo; aplicação pronta em `dev`, ainda não publicada; dry-run aguardando o arquivo original.

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

## Gates pendentes

1. O CSV/XLSX original com exatamente 1.550 anúncios não está no workspace. Sem ele, não existe baseline verificável, checksum, classificação integral, diff ou manifesto para aprovação.
2. `dev` recebeu antes desta entrega o commit alheio `1a21393` de BVF Storage, cuja própria evidência registra publicação não autorizada. Como `bentevi-prod` ainda aponta para `92090c52`, promover o futuro SHA desta entrega publicaria também esse trabalho. O código desta missão deve permanecer somente em `dev` até o histórico produtivo convergir de modo autorizado.

## Recuperação

O código pode ser revertido pelo commit funcional desta entrega. No banco, a recuperação preferencial é progressiva: primeiro reverter o código dependente; somente com autorização explícita remover o trigger `trg_ml_catalog_identity_outbox_guard`. As quatro tabelas e funções só podem ser removidas se continuarem vazias e nenhum consumidor estiver ativo. Enquanto a ordem executiva vigorar, retirar o guard não é uma ação de rollback autorizada.
