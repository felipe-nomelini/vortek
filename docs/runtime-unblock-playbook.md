# Runtime Unblock Playbook (Codex + Vortek)

This playbook standardizes MCP setup and network diagnostics for Vortek operational flows.

## 1) MCP Standardization

Project MCP configuration now lives in `.mcp.json` and includes:

- `vortek-dataset` (tool: `consultar_dataset`)
- `firecrawl`
- `supabase`
- `forge_extension` (existing)
- `context7` (optional helper)

If a session still does not expose these tools, restart/reload the Codex session after updating `.mcp.json`.

To sync these servers into Codex local registry:

```bash
npm run sync:codex-mcp
```

To start a local engineering session with explicit unrestricted shell profile:

```bash
npm run codex:engineering
```

## 2) Network/Policy Diagnostics

Run:

```bash
npm run sync:codex-mcp
npm run diagnose:runtime
```

The script checks:

- sandbox flags (`CODEX_SANDBOX_NETWORK_DISABLED`)
- DNS resolution for required domains
- HTTPS reachability for required domains
- direct Mercado Livre item fetch
- explicit `blocked_by_policy` detection (`PolicyAgent`)

Domains covered:

- `api.mercadolibre.com`
- `developers.mercadolivre.com.br`
- `api.dslite.com.br`
- `www.brasilnfe.com.br`

## 3) What This Repo Can and Cannot Change

This repository can:

- align MCP definitions (`.mcp.json`)
- provide diagnostics and fallback process

This repository cannot:

- override platform-level sandbox flags
- override central PolicyAgent allow/deny rules

When diagnostics show blocked DNS/HTTP, the fix must be applied in runtime/policy configuration (outside repo code).
Use `docs/policyagent-unblock-checklist.md` as the handoff document for platform admins.

## 4) Official Fallback (when shell network remains blocked)

Use this sequence for audit/correction tasks:

1. `consultar_dataset`
2. `firecrawl_search` (or `search_docs` for Supabase)
3. `firecrawl_scrape`
4. implement/fix based on collected evidence

This keeps the workflow functional even with shell network restrictions.

## 5) Supabase Type Sync (mandatory with schema changes)

Whenever a migration changes any table/field used by API routes, `src/types/database.ts`
must be updated in the same PR/commit.

Recommended command (official Supabase CLI pattern):

```bash
supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" --schema public > src/types/database.ts
```

Minimum release checklist before deploy:

```bash
npm ci
npm run build
```

Deployment env checklist (runtime):

- `BRASILNFE_TIPO_AMBIENTE=1` (obrigatório para emissão fiscal em produção)

If `next build` fails with `from('...')` table/column typing errors, treat it as a
type drift issue first and resync `src/types/database.ts` before patching route logic.
