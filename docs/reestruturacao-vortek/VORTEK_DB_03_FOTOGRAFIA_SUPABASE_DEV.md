# Vortek — DB-03 — Fotografia real do banco

**Situação:** fotografia e hardening de desenvolvimento concluídos; produção diferida para release autorizada
**Ambiente:** `supabase-dev` em `192.168.1.162`  
**Captura:** 30/08/2026  
**PostgreSQL:** `17.6`  
**Branch/commit de referência:** `dev` / `6ef555c516e2`  
**Fingerprint estrutural:** `a2efd12ef5ed7bedac94e8f6f0be24b657fe124d5488e752ba9081d24702e1d3`

## 1. Escopo e método

A coleta consultou somente metadados dos schemas `public`, `private` e `graphql_public`. O último está exposto no PostgREST, mas não contém relações. A configuração confirmada expõe `public,graphql_public` e mantém `public` no search path extra.

O coletor abriu uma transação `READ ONLY` e consultou os catálogos `pg_class`, `pg_policy`, `pg_constraint`, `pg_index`, `pg_default_acl` e `pg_proc`. ACLs foram expandidas com `aclexplode`; definições de funções foram reduzidas a fingerprints e não foram gravadas.

O snapshot completo e reproduzível está em:

`reports/db-03/supabase-dev-2026-08-30.json`

Ele não contém dados de negócio, credenciais, valores de ambiente, conexão autenticada ou corpos de funções.

Fontes oficiais usadas na interpretação:

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security);
- [PostgreSQL 17 — Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html);
- [PostgreSQL 17 — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html);
- [PostgreSQL 17 — acldefault/aclexplode](https://www.postgresql.org/docs/17/functions-info.html);
- [PostgreSQL 17 — SECURITY DEFINER](https://www.postgresql.org/docs/17/sql-createfunction.html).

## 2. Resultado estrutural

| Verificação | Resultado DEV |
|---|---:|
| Migrations no repositório / banco | `91 / 91`, paridade exata |
| Tabelas em `public` | `40` |
| Tabelas com RLS | `37` |
| Policies | `9` |
| Constraints | `136` |
| Índices | `163` |
| Funções `SECURITY DEFINER` relevantes | `12` |

Confirmações positivas:

- todas as 40 tabelas públicas pertencem a `postgres` e possuem chave primária;
- não existem constraints não validadas;
- não existem índices inválidos, não prontos ou inativos;
- `graphql_public` não contém tabela, view ou materialized view;
- nenhuma tabela usa `FORCE ROW LEVEL SECURITY`; isso foi registrado como postura atual, sem tratá-lo isoladamente como erro;
- `service_role` e `postgres` possuem `BYPASSRLS`, coerente com o backend privilegiado atual.

## 3. Achados confirmados

### DB-03.A — Três tabelas públicas sem RLS

- `ops_whatsapp_events`;
- `whatsapp_alert_events`;
- `whatsapp_alert_settings`.

As três foram criadas depois da migration geral de hardening e não receberam `ENABLE ROW LEVEL SECURITY`. Nenhuma delas possui grant CRUD para `anon` ou `authenticated`, portanto a fotografia não comprovou leitura ou escrita direta de linhas. Mesmo assim, a postura viola a regra explícita exigida para tabelas em schema exposto.

### DB-03.B — Grants e default privileges residuais

A migration `20260610001532_harden_public_table_access.sql` removeu CRUD dos papéis de cliente, mas alterou somente parte dos default privileges. No PostgreSQL 17 permaneceram para `anon` e `authenticated`:

- tabelas futuras: `MAINTAIN`, `REFERENCES`, `TRIGGER` e `TRUNCATE`;
- sequences futuras: `UPDATE`.

Onze relações criadas posteriormente carregam os quatro privilégios residuais para ambos os papéis:

- `catalogo_ml_refresh_items`;
- `estoque_interno_movimentacoes`;
- `ops_whatsapp_events`;
- `pedidos_operacionais`;
- `produto_kit_componentes`;
- `produto_kits`;
- `push_notification_outbox`;
- `push_subscriptions`;
- `short_links`;
- `whatsapp_alert_events`;
- `whatsapp_alert_settings`.

Além disso, `authenticated` possui `SELECT` em `profiles` e `pedidos_operacionais`. O primeiro é intencional e limitado por policy. Um probe com `SET ROLE authenticated` confirmou `profiles = 0` sem JWT e bloqueou `pedidos_operacionais` com `42501`, devido às dependências da view.

RLS não governa `TRUNCATE` nem `REFERENCES`, conforme o contrato do PostgreSQL. O achado é uma inconsistência real de menor privilégio, ainda que não tenha sido comprovada exposição CRUD direta no DEV.

### DB-03.C — RPCs privilegiadas ainda executáveis por `authenticated`

Três funções `SECURITY DEFINER` aceitam `EXECUTE` de `authenticated`:

- `search_pedidos_paginated`;
- `search_produtos_paginated`;
- `search_produtos_resumo`.

Os consumidores atuais encontrados em `src` usam `createServiceClient()` por rotas Next.js; os dois scripts operacionais encontrados também usam cliente privilegiado. Não foi encontrado consumidor web/mobile direto que necessite desses grants.

O probe autenticado executou as três RPCs com sucesso, mas todas retornaram total zero porque o DEV está vazio para esses domínios. Assim, a capacidade de execução está comprovada; vazamento de linhas não está comprovado neste ambiente.

### DB-03.D — `SECURITY DEFINER` com hardening desigual

Das 12 funções:

- três dispatchers usam `search_path = pg_catalog, pg_temp` e execução somente por `postgres`;
- sete usam `search_path = public`;
- duas usam search path vazio; uma delas, `search_pedidos_paginated`, é executável por `authenticated`.

O schema `public` concede `USAGE`, mas não `CREATE`, a `PUBLIC`, `anon` e `authenticated`. Portanto, não foi comprovado um caminho atual para esses papéis injetarem objetos em `public`. Ainda assim, as sete funções não seguem o padrão endurecido já adotado pelos dispatchers, e as duas funções com configuração vazia precisam ser revisadas junto com todas as referências não qualificadas.

### DB-03.E — Policies com escopo nominal impreciso

As nove policies atuais estão associadas ao papel PostgreSQL `PUBLIC`, inclusive policies chamadas “Admin pode gerenciar...” e “Todos podem ver...” nas tabelas de kits. Grants e expressões RLS continuam participando da autorização, então o nome não prova acesso irrestrito. A divergência entre nome e papel real deve ser corrigida quando o hardening for executado para que a intenção fique verificável.

## 4. Decisão da DB-03

A fotografia de desenvolvimento está concluída e reproduzível. Nenhum grant, policy, função, schema, índice, constraint ou dado foi alterado.

Antes de qualquer limpeza destrutiva, deve ser planejada separadamente uma ação de hardening para:

1. tornar explícita a postura RLS das três tabelas;
2. remover grants residuais atuais e corrigir default privileges de `postgres`;
3. confirmar e reduzir os grants `authenticated` das três RPCs;
4. endurecer `search_path` e execução das funções privilegiadas;
5. alinhar nomes, papéis e intenção das policies de kits.

A conferência de produção permanece adiada para a preparação autorizada da promoção. Esta tarefa não consultou produção, não aplicou migration e não realizou deploy.

## 5. Hardening derivado da fotografia

O hardening foi executado em 30/08/2026 exclusivamente no `supabase-dev`, pela migration:

`20260830220000_harden_public_schema_after_db03.sql`

O snapshot pós-hardening está em:

`reports/db-03/supabase-dev-2026-08-30-post-hardening.json`

Fingerprint estrutural reproduzido em duas capturas consecutivas:

`72eb24ae6e9a4d5f24a61097f97cfd89448ac9c921754e752e2aa26c7b97a7e8`

### Resultado

- migrations do repositório e banco em paridade exata `92/92`;
- `40/40` tabelas públicas com RLS;
- nenhum grant de relação ou sequence para `anon`;
- para `authenticated`, somente `SELECT` em `profiles` e `UPDATE` das colunas `nome` e `avatar_url`;
- nenhum default privilege de tabela ou sequence de `postgres` para papéis de cliente;
- `pedidos_operacionais` e as três RPCs privilegiadas deixaram de aceitar acesso direto de `authenticated`;
- `service_role` permaneceu com acesso às RPCs, kits e tabelas operacionais;
- todas as 12 funções `SECURITY DEFINER` registradas usam `search_path = pg_catalog, pg_temp`;
- as quatro policies de cliente dos kits foram removidas, mantendo RLS default-deny;
- nenhuma linha das três tabelas que receberam RLS foi modificada.

### Validação

- ensaio integral da migration com transação e `ROLLBACK`: aprovado;
- probes reais de `anon` e `authenticated`: bloqueios esperados com `42501`;
- probes reais de `service_role`: pedidos, produtos, resumos, kits e tabelas WhatsApp aprovados;
- página pública de kits em `dev.vortek.shop`: HTTP `200` e conteúdo esperado;
- `npm run test:db-schema-snapshot`: `11/11` aprovado;
- `tests/sec-01-role-control.test.js`: `3/3` aprovado;
- `node --check scripts/capture-db-03-snapshot.js`, `npm run validate` e `git diff --check`: aprovados;
- commit funcional `1e91a23` enviado somente para `origin/dev`;
- build e deploy web: **N/A**, pois o runtime da aplicação não foi alterado.

### Rollback e pendência

O rollback exato está registrado na migration e reabre deliberadamente os achados de segurança; ele não deve ser executado automaticamente. Produção, `main`, `app.vortek.shop` e o Supabase de produção permaneceram intocados.

A única pendência remanescente da DB-03 é comparar a fotografia com produção durante uma preparação de release explicitamente autorizada.
