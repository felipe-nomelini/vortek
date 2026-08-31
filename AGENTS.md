# Vortek — Engineering Agent Instructions

**Always-on engineering rules for every agent working in this repository.**

_Last reviewed: 2026-08-30_

---

## 0. Authority and precedence

These instructions apply to **every technical response, investigation, plan, code change, database change, integration task, Git operation, and deployment task** in Vortek.

If instructions conflict, follow this order:

1. current explicit user instruction;
2. this `AGENTS.md`;
3. task-specific Vortek operational documentation;
4. current Vortek code, schema, configuration, migrations, tests, and scripts;
5. current official documentation for external technologies and services;
6. project skills;
7. trustworthy secondary sources, only when official sources are insufficient.

Platform, runtime, sandbox, and security restrictions always take precedence when applicable.

**A generic skill must never override a Vortek-specific rule in this file or the actual state of the repository.**

---

## 0.1 Reestruturação — base de conhecimento dos Itens 1 a 17

A base canônica da auditoria, consolidação e execução da reestruturação está em:

`docs/reestruturacao-vortek/`

Ela foi incorporada em 2026-08-27 e deve ser usada como referência especializada, sem substituir a inspeção do código, schema, configuração, testes e documentação oficial atuais.

### Roteamento obrigatório

Para qualquer tarefa ligada à reestruturação, à nova versão ou ao Item 17:

1. leia primeiro este `AGENTS.md`;
2. leia `docs/reestruturacao-vortek/INSTRUCOES_AGENTE_VORTEK.md` como contexto complementar, mantendo a precedência definida na seção 0;
3. leia a etapa aplicável de `docs/reestruturacao-vortek/VORTEK_ITEM_17_PLANO_COMPLETO_EXECUCAO_HOMOLOGACAO.md`;
4. use `docs/reestruturacao-vortek/VORTEK_AUDITORIA_ITEM_16_CONSOLIDACAO.md` para localizar o identificador, a prioridade e as dependências do achado;
5. leia a auditoria detalhada do domínio afetado antes de concluir ou alterar;
6. confronte os achados com o estado atual do repositório e reconfirme contratos externos na documentação oficial atual.

Os documentos registram uma fotografia datada da auditoria. Status, versões, prazos, hipóteses e evidências operacionais podem envelhecer; não os apresente como estado atual sem nova verificação.

Execute somente uma ação do Item 17 por tarefa. Não avance para a ação ou etapa seguinte enquanto a atual não estiver validada. A base não autoriza merge em `main`, migration ou deploy em produção.

### Índice por domínio

- Item 1 — mapa geral: `VORTEK_AUDITORIA_ITEM_01_MAPA_GERAL_DO_SISTEMA.md`;
- Item 2 — pedidos, fulfillment e estoque interno: `VORTEK_AUDITORIA_ITEM_02_PEDIDOS_FULFILLMENT_ESTOQUE_INTERNO_ATUALIZADO.md`;
- Item 3 — produtos, fornecedores e kits: `VORTEK_AUDITORIA_ITEM_03_PRODUTOS_FORNECEDORES_KITS.md`;
- Item 4 — Mercado Livre, anúncios e catálogo: `VORTEK_AUDITORIA_ITEM_04_MERCADO_LIVRE_ANUNCIOS_CATALOGO.md`;
- Item 5 — fiscal: `VORTEK_AUDITORIA_ITEM_05_FISCAL.md`;
- Item 6 — compras, fornecedores e financeiro: `VORTEK_AUDITORIA_ITEM_06_COMPRAS_FORNECEDORES_FINANCEIRO.md`;
- Item 7 — sincronizações, jobs e scheduler: `VORTEK_AUDITORIA_ITEM_07_SINCRONIZACOES_JOBS_SCHEDULER.md`;
- Item 8 — webhooks e eventos: `VORTEK_AUDITORIA_ITEM_08_WEBHOOKS_EVENTOS.md`;
- Item 9 — autenticação, segurança e permissões: `VORTEK_AUDITORIA_ITEM_09_AUTH_SEGURANCA_PERMISSOES.md`;
- Item 10 — banco de dados: `VORTEK_AUDITORIA_ITEM_10_BANCO_DE_DADOS.md`;
- Item 11 — interface web: `VORTEK_AUDITORIA_ITEM_11_INTERFACE_WEB.md`;
- Item 12 — regras de negócio compartilhadas: `VORTEK_AUDITORIA_ITEM_12_REGRAS_NEGOCIO_COMPARTILHADAS.md`;
- Item 13 — performance e saúde operacional: `VORTEK_AUDITORIA_ITEM_13_PERFORMANCE_SAUDE_OPERACIONAL.md`;
- Item 14 — testes e validação: `VORTEK_AUDITORIA_ITEM_14_TESTES_VALIDACAO.md`;
- Item 15 — scripts, documentação e históricos: `VORTEK_AUDITORIA_ITEM_15_SCRIPTS_DOCUMENTACAO_HISTORICOS.md`;
- Item 16 — coleta e consolidação: `CHECKLIST_COLETA_PLANEJAMENTO_LIMPEZA_VORTEK_ITEM_16_ATUALIZADO.md` e `VORTEK_AUDITORIA_ITEM_16_CONSOLIDACAO.md`;
- Item 17 — plano completo e homologação: `VORTEK_ITEM_17_PLANO_COMPLETO_EXECUCAO_HOMOLOGACAO.md`.

Todos os nomes acima são relativos a `docs/reestruturacao-vortek/`.

---

# 1. Non-negotiable rules

These rules are mandatory.

1. **Never give a technical conclusion from model memory alone.**
   Inspect the current Vortek implementation relevant to the request first.

2. **Never assume the behavior of an external API, framework, library, service, CLI, or platform.**
   Consult its current official documentation before explaining, deciding, planning, or implementing behavior that depends on it.

3. **Never implement a fix before identifying the root cause, or proving why the root cause cannot currently be identified.**

4. **Never fix only the symptom when the root cause can be corrected safely inside Vortek.**

5. **Always choose the smallest correct, safe, maintainable, and reversible solution.**

6. **Do not create fallback paths, compatibility layers, parallel flows, extra retries, wrappers, helpers, services, abstractions, tables, jobs, queues, caches, scripts, or dependencies unless there is a proven need.**

7. **Never claim that something was tested, validated, executed, deployed, migrated, pushed, or verified unless it actually was.**

8. **Never expose credentials, secrets, tokens, cookies, private keys, passwords, webhook secrets, or sensitive environment values.**

These rules may be repeated later intentionally. Repetition of these core rules is reinforcement, not permission to weaken them.

---

# 2. Mandatory engineering cycle

For every technical request, follow this sequence.

## Gate A — Understand the real scope

Before acting:

1. identify exactly what the user asked;
2. identify the affected Vortek flow;
3. avoid expanding the task beyond that flow;
4. determine whether the user is asking for:
   - explanation;
   - investigation;
   - plan;
   - implementation;
   - validation;
   - Git operation;
   - deployment.

Do not turn a focused task into a broad audit or refactor.

If the user already asked to fix or implement something, do not stop after diagnosis to ask whether you should implement. Investigate first, then continue with the requested implementation when safe.

---

## Gate B — Gather local evidence

Before forming a technical conclusion:

1. inspect the current repository;
2. read the files directly related to the request;
3. trace callers and consumers when necessary;
4. inspect relevant:
   - routes;
   - services;
   - components;
   - hooks;
   - types;
   - schemas;
   - migrations;
   - tests;
   - jobs;
   - workers;
   - webhooks;
   - scripts;
   - configuration;
   - logs, when available;
5. confirm dependency/runtime versions from the repository when the answer depends on versions.

Use the current code as evidence of **how Vortek behaves now**.

Do not rely on old architecture descriptions when current code proves otherwise.

Do not read the entire repository without reason. Investigate only as far as necessary to understand the affected flow and its real dependencies.

---

## Gate C — Consult official documentation

For every external technology, platform, API, library, framework, CLI, or service involved:

1. identify the exact product and feature involved;
2. confirm the version used by Vortek when version matters;
3. consult the current official documentation;
4. read the documentation directly related to the exact behavior, endpoint, method, contract, error, configuration, or lifecycle involved;
5. compare the official contract with the current Vortek implementation.

**Finding the documentation homepage is not enough. Read the relevant documentation.**

Do not say or imply that documentation was consulted if it was not.

Official documentation is the primary source.

If official documentation does not answer the question:

1. say so briefly;
2. prefer the provider's official SDK source, official GitHub repository, changelog, release notes, or API schema;
3. use a trustworthy secondary source only when still necessary;
4. clearly separate verified fact from inference.

Never present a hypothesis or inference as a confirmed fact.

---

## Gate D — Find the root cause

For bugs or unexpected behavior, determine:

**Expected behavior → actual behavior → exact divergence point → root cause.**

Trace the complete relevant flow when applicable:

`input → auth → route → business rule → database → async processing → external integration → webhook/callback → persistence → UI`

Check, when relevant:

- origin of the data;
- business rules;
- state transitions;
- filters;
- permissions;
- authentication;
- authorization;
- RLS;
- database constraints;
- async ordering;
- retries;
- idempotency;
- concurrency;
- race conditions;
- cache;
- stale data;
- external API contracts;
- token expiration;
- pagination;
- rate limits;
- silent failures;
- incomplete error handling;
- duplicate processing.

Before implementing, be able to point to concrete evidence supporting the diagnosis.

For complex problems, maintain a small set of hypotheses and eliminate them with evidence. Do not expose hidden chain-of-thought; report only conclusions, evidence, and unresolved uncertainty.

---

## Gate E — Design the smallest correct fix

Before creating anything new, ask:

**Can this be solved by correcting, removing, consolidating, or reusing something that already exists?**

Prefer, in this order:

1. correct an existing rule or flow;
2. remove incorrect or unnecessary behavior;
3. reuse an existing implementation;
4. consolidate duplicated behavior;
5. simplify an existing implementation;
6. only then add something new.

If two solutions solve the problem correctly, prefer the one with:

- fewer concepts;
- fewer files;
- fewer states;
- fewer dependencies;
- fewer network calls;
- fewer moving parts;
- less duplicated data;
- less operational burden.

Do not add architecture for hypothetical future needs.

Do not create a generic abstraction for one isolated use case unless it solves a proven existing problem.

Do not introduce a second source of truth when one source can own the data.

---

## Gate F — Implement only what is necessary

When implementation was requested:

1. change only the responsible area;
2. preserve established Vortek patterns unless they are part of the proven problem;
3. do not silently change business rules;
4. do not mix cosmetic refactors with functional fixes;
5. do not modify unrelated areas merely because they could be improved;
6. do not add fallbacks "just in case";
7. do not suppress errors instead of fixing their cause;
8. do not use arbitrary delays, polling, retries, or cleanup jobs as a substitute for fixing deterministic logic.

A workaround is allowed only when:

- the real cause is outside Vortek's control, or cannot safely be fixed now;
- the workaround is operationally necessary;
- its temporary nature is explicit;
- it does not create a hidden parallel architecture.

When a permanent root fix is available and safe, use it instead.

---

## Gate G — Validate the affected behavior

After a change, run the smallest meaningful validation that proves the affected behavior.

Use repository scripts and existing tests whenever possible.

Current root project includes:

- `npm run typecheck`
- `npm run lint`
- `npm run validate`
- `npm run build`
- targeted `npm run test:*` scripts

Current mobile project includes:

- `npm run typecheck`
- `npm run doctor`

Choose validation based on the changed area.

Examples:

- type-only change → typecheck may be sufficient;
- logic bug with an existing test area → run the targeted test;
- build-sensitive framework/config change → build;
- mobile dependency/config change → mobile typecheck and/or doctor;
- database change → verify schema/behavior safely;
- integration change → validate the relevant contract or safe test path.

Do not run destructive operations merely to "validate".

If validation cannot be executed, state exactly what was not validated and why.

---

## Gate H — Report concisely

For a bug fix, normally report only:

1. **cause**;
2. **evidence**;
3. **change**;
4. **validation executed**;
5. **remaining risk**, only if relevant.

For a technical question, answer the conclusion first and include only the evidence necessary to support it.

Do not dump the investigation process unless the user asks for it.

---

# 3. Root-cause rule

The objective is not to make the visible error disappear.

The objective is to make the underlying Vortek behavior correct.

Forbidden as default fixes when the actual cause can be fixed:

- catching and ignoring an error;
- retrying an invalid operation;
- adding arbitrary `setTimeout` or delay;
- refreshing the page to hide stale state;
- periodically repairing data that is being written incorrectly;
- duplicating data to avoid fixing ownership;
- adding a second endpoint around a broken endpoint;
- keeping both old and new flows "for safety";
- adding a fallback provider without a proven availability requirement;
- adding a cron to repair a deterministic state-transition bug;
- adding client-side compensation for incorrect backend state.

If a symptom-level mitigation is temporarily necessary, label it as mitigation and continue to identify the root cause whenever that root cause is controllable by Vortek.

---

# 4. Simplicity rule

Vortek should remain easy to understand and hard to break.

Before adding any of the following:

- file;
- helper;
- hook;
- service;
- wrapper;
- abstraction;
- endpoint;
- table;
- column duplicating existing data;
- queue;
- worker;
- cron;
- cache;
- retry layer;
- dependency;
- script;
- deployment path;

first search for the existing mechanism that should own the behavior.

**Removal, consolidation, and reuse are preferred to addition.**

Do not over-engineer.

Do not refactor for aesthetics.

Do not introduce patterns only because they are fashionable or common in other projects.

A pattern is justified only when it solves a real Vortek problem.

---

# 5. One-solution rule

When one solution is clearly best, recommend and implement that solution.

Do not present multiple alternatives merely to appear thorough.

Only present alternatives when there is a real unresolved tradeoff that materially affects the user's decision.

Do not add optional complexity without a concrete requirement.

---

# 6. Scope control

Do only what was requested.

If you find another issue outside the task:

- do not modify it automatically;
- mention it briefly only if it is important, dangerous, or directly affects the requested work.

Do not fix unrelated bugs merely because they are easy.

Do not broaden a bug fix into a redesign.

Do not broaden a question into an audit.

Do not change schema, business rules, API contracts, or public behavior without evidence that the requested task requires it.

---

# 7. Current Vortek architecture

Treat this section as orientation, **not as a permanent version source**.

Before any version-sensitive decision, read the current `package.json`, lockfile, configuration, and relevant code.

## Web application

The root application currently uses the Vortek web stack centered on:

- Next.js App Router;
- React;
- TypeScript;
- Ant Design;
- Supabase;
- Zod.

Do not assume Axios or TanStack Query are part of the root web architecture. Verify current dependencies before introducing or using them.

Prefer existing project patterns over adding a new client/data layer.

## Mobile application

The `mobile/` application is a separate Expo/React Native application and currently uses, among other project dependencies:

- Expo;
- React Native;
- TypeScript;
- TanStack Query;
- Supabase;
- Zod.

Do not apply web-only architectural assumptions to mobile.

Do not apply mobile dependencies or patterns to the web app unless there is a proven reason.

---

# 8. Database and Supabase

Vortek uses **self-hosted/local Supabase**, not Supabase Cloud as its operational project environment.

This project-specific rule overrides generic skills or documentation examples that assume Supabase Cloud project setup.

Do not ask for:

- Supabase Cloud project refs;
- Supabase Cloud dashboard access;
- Supabase Cloud personal access tokens;
- Supabase Cloud MCP authentication

as a prerequisite for operating the Vortek self-hosted environment.

For a Supabase/database task:

1. inspect current Vortek schema and migrations;
2. inspect code that reads and writes the affected data;
3. inspect RLS, grants, functions, triggers, indexes, and constraints when relevant;
4. consult current official Supabase/PostgreSQL documentation for the exact feature involved;
5. verify the self-hosted environment before assuming cloud behavior.

## Environment identity — non-negotiable

For every database or Supabase operation in this `vortek-dev` worktree, the environments are:

### Production — read only

- `192.168.1.160` is **PRODUCTION** for database/Supabase purposes.
- Access to the Supabase/PostgreSQL stack on `192.168.1.160` from this worktree is restricted to necessary **READ ONLY** diagnostics.
- Never execute migrations, DDL, DML, RPC/function changes, grants, secret changes, configuration changes, administrative writes, test writes, or any other mutation on `192.168.1.160`.
- A container name, Docker label, directory, DNS name, endpoint, application environment variable, or service name containing `dev` or `supabase-dev` on `192.168.1.160` does **not** change its classification as production and does **not** authorize writes.
- The homologation web service may run on the Easypanel host `192.168.1.160`; this does not make the Supabase/PostgreSQL stack on that host a development database.
- If the user requests an urgent production correction while working in this directory, stop and state that it must be executed from the dedicated `vortek-prod` workspace.

### Development and homologation — writable

- `192.168.1.162` is the **only** `supabase-dev` authorized for development/homologation writes.
- Apply migrations, DDL, DML, test data, function/RPC changes, grants, configuration changes, and every other database mutation only to `192.168.1.162`.
- Do not infer the target environment from a public URL, container location, label, hostname, runtime variable, or previously opened connection. Confirm the network destination itself.

### Mandatory preflight before every database write

Before opening a writable transaction or executing any mutating command:

1. resolve and display the actual destination host without printing credentials;
2. confirm that the destination is exactly `192.168.1.162`;
3. confirm that the environment is the independent `supabase-dev`;
4. inspect the migration history and current affected schema on that same destination;
5. rehearse the migration with `ROLLBACK` when applicable;
6. stop immediately if the destination is `192.168.1.160`, differs from `192.168.1.162`, or remains ambiguous.

Never treat indirect runtime evidence as authorization to override this environment map.

Before asking the user for a missing Supabase credential, first inspect the authorized local project/server configuration when access is available.

Never print secret values discovered in `.env`, server configuration, logs, or command output.

For destructive database changes, consider:

- existing data;
- compatibility;
- migration path;
- backup;
- rollback;
- dry-run or preview;
- reprocessing requirements.

Do not create duplicate persistent fields merely to avoid correcting the real source of truth.

---

# 9. External integrations

Never guess external API behavior.

For integrations such as:

- Mercado Livre;
- Mercado Pago;
- DSLite;
- Brasil NFe;
- WAHA / WhatsApp;
- e-mail providers;
- notification providers;
- GitHub;
- Easypanel;
- Supabase;
- any SDK or external API;

verify the exact official contract involved.

Check as relevant:

- authentication;
- request contract;
- response contract;
- documented states/statuses;
- errors;
- retries;
- rate limits;
- pagination;
- idempotency;
- token expiration;
- webhook delivery;
- ordering;
- duplicate delivery;
- side effects.

Do not implement behavior the official API does not support.

---

# 10. Mercado Livre special rule

Before creating, updating, repairing, validating, or diagnosing a Mercado Livre listing, read:

`docs/mercado-livre-publicacao-operacional.md`

This is mandatory.

Also consult the current official Mercado Livre documentation relevant to the exact operation.

Do not invent product specifications, attributes, category behavior, status behavior, image requirements, shipping behavior, or API contracts.

---

# 11. Async flows

For queues, jobs, workers, cron, synchronization, webhooks, callbacks, and background processing, always verify:

- can it run twice?
- can events arrive out of order?
- can it fail halfway?
- is retry safe?
- is the operation idempotent?
- is concurrency controlled?
- are failures observable?
- can it be safely reprocessed?
- can stale state overwrite newer state?

A flow is not reliable merely because it succeeds on the happy path.

Prefer correcting event ownership/state transitions over adding compensating background repair.

---

# 12. Performance

Do not optimize without evidence.

First identify the actual source of cost or latency.

Check:

- query count;
- external-call count;
- repeated processing;
- N+1 patterns;
- pagination;
- unnecessary data loading;
- large client-side processing;
- sequential work that is safely independent;
- missing indexes;
- repeated network fetches.

Prefer eliminating unnecessary work before adding cache.

Do not add caching merely as a workaround for an inefficient or incorrect flow.

---

# 13. Security

Security and data integrity outrank convenience and aesthetic cleanup.

Never expose or commit:

- passwords;
- tokens;
- cookies;
- API keys;
- webhook secrets;
- private keys;
- service-role credentials;
- database passwords;
- SSH secrets.

You may inspect authorized secret configuration when necessary for the task, but never reproduce secret values in user-facing output or source code.

If a secret appears to be versioned:

1. do not repeat it;
2. report the exposure;
3. remove it from active source/config where appropriate;
4. recommend rotation;
5. consider repository history if relevant.

Check authentication, authorization, permissions, and RLS when they are part of the affected flow.

---

# 14. Git working rules

Use the existing local Vortek project folder.

Do not create:

- helper clones;
- temporary repositories;
- alternate worktrees;
- side checkouts

unless the user explicitly requests one or the existing project folder is unusable.

Before editing project files, inspect the working tree state.

**Preserve pre-existing user changes.**

Do not:

- overwrite unrelated local modifications;
- discard unrelated changes;
- stage unrelated changes;
- commit unrelated changes;
- push unrelated changes

without explicit user instruction.

Stage and commit the files belonging to the requested task.

Do not use destructive Git operations such as force reset, force checkout, history rewriting, or force push without explicit need and user authorization.

If paths contain spaces, parentheses, or shell metacharacters, quote them correctly.

Use `rtk` when it is available and provides a correct equivalent, because it can reduce command-output noise. `rtk` is a convenience, not a reason to block or complicate the task.

---

# 15. Deployment

Normal Vortek deployment path:

`local project → validated code → GitHub main → Easypanel deployment`

Never edit application files directly inside Easypanel as a normal deployment method.

Use the repository deployment script and its configured environment:

`npm run deploy:easypanel`

The deploy webhook URL must come from authorized environment configuration such as `EASYPANEL_DEPLOY_WEBHOOK_URL`.

**Never hardcode the deploy webhook URL or secret in `AGENTS.md`, source code, or committed configuration.**

Do not deploy unless deployment was requested or clearly included in the current task.

Before deployment, ensure the code intended for deployment is committed and available on the expected Git branch.

Do not publish unrelated local work merely to obtain a clean working tree.

---

# 16. Tools and skills

Tools and skills are implementation aids, not sources of truth.

Use the simplest available tools that let you:

- read/search the repository;
- inspect Git state;
- run validation;
- inspect logs;
- access official documentation;
- interact safely with authorized infrastructure.

If a tool is unavailable, use the simplest safe equivalent.

Do not build workaround machinery merely because a preferred tool is missing.

## Skills

A skill may provide specialized workflow knowledge.

A skill must not override:

- this `AGENTS.md`;
- current Vortek code;
- current Vortek infrastructure;
- task-specific Vortek documentation;
- verified official API behavior.

Generic skills often contain generic assumptions. Verify those assumptions against Vortek before following them.

In particular, generic Supabase skills must not change the project's self-hosted Supabase model into a Supabase Cloud workflow.

Any skill or cached instruction that identifies `192.168.1.160` as the writable Vortek Supabase environment is stale for this worktree. `AGENTS.md` and the explicit environment map in section 8 take precedence: `.160` is production/read-only and `.162` is the only writable `supabase-dev`.

Caveman or other response-compression skills are not required. Follow the communication rules in this file directly.

---

# 17. Communication with the user

Default language: **Brazilian Portuguese**.

Be technical internally and simple externally.

Every response should be:

- direct;
- short;
- precise;
- evidence-based;
- focused on the requested task.

Start with the conclusion.

Do not give a long explanation followed by a short conclusion.

Do not give an architecture lesson unless requested.

Do not use unnecessary jargon.

If a technical term is necessary, explain it in one short sentence when needed.

Do not repeat the same conclusion in multiple sections.

Do not list many alternatives when one solution is clearly better.

When uncertainty remains, state exactly what is confirmed and what is not.

Do not expose internal chain-of-thought. Provide evidence and conclusions instead.

---

# 18. Forbidden behaviors

The following are prohibited:

- answering external API behavior from memory;
- saying "according to the docs" without reading the relevant official docs;
- implementing before understanding the affected flow;
- trial-and-error coding without evidence;
- treating a symptom when the root cause can be fixed;
- hiding an error instead of correcting it;
- adding retries as a default fix;
- adding arbitrary delays as a default fix;
- adding a cron/job to compensate for deterministic broken logic;
- creating duplicate sources of truth;
- creating unnecessary fallback flows;
- keeping old and new implementations in parallel without a real compatibility requirement;
- broad refactors for narrow bugs;
- changing business rules implicitly;
- adding new dependencies when existing capabilities solve the problem;
- fixing unrelated issues without authorization;
- editing production files directly as a shortcut;
- exposing secrets;
- claiming tests or operations that were not executed.

---

# 19. Final self-check before every technical conclusion

Before giving a final technical answer or completing an implementation, verify:

- [ ] Did I inspect the current Vortek files relevant to this request?
- [ ] Did I confirm current versions/configuration when the answer depends on them?
- [ ] Did I identify every external service or library whose behavior matters?
- [ ] Did I read the relevant current official documentation for those external dependencies?
- [ ] Is my conclusion supported by code, logs, contracts, or other concrete evidence?
- [ ] For a bug, did I identify the root cause rather than only the symptom?
- [ ] Is the proposed/implemented solution the smallest correct solution?
- [ ] Did I avoid unnecessary abstractions, fallbacks, parallel flows, retries, services, and dependencies?
- [ ] Did I stay inside the requested scope?
- [ ] Did I preserve unrelated user work?
- [ ] Did I validate the affected behavior when implementation occurred?
- [ ] Am I accurately stating what was and was not executed?
- [ ] Did I avoid exposing any secret?

If a mandatory item is not satisfied, do not present the missing conclusion as confirmed fact.

---

# 20. Final principle

The goal is not the most sophisticated architecture.

The goal is the **simplest architecture that solves Vortek's real problem correctly**.

Investigate deeply.

Verify external behavior in official sources.

Fix the cause.

Change the minimum necessary.

Validate the result.

Explain simply.

Stop when the requested task is complete.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
