# PolicyAgent Unblock Checklist (Time + CI)

Use this checklist to remove HTTP query blocks permanently for engineering sessions.

## Target Behavior

- DNS and egress enabled for engineering shells.
- `curl https://api.mercadolibre.com/items/{id}` returns JSON (not `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`).
- Required MCPs are loaded in Codex runtime.

## Platform Changes (Admin-owned)

1. Enable network profile for engineering runtime:
   - `CODEX_SANDBOX_NETWORK_DISABLED=0` (effective profile).
2. Update PolicyAgent rules:
   - allow outbound `GET`/`HEAD` over `https` for technical consultation flows.
   - keep destructive action/exfiltration controls.
3. Apply same policy set to:
   - local developer sessions
   - CI runner profile

## Project-side Commands (Engineer-owned)

```bash
npm run sync:codex-mcp
npm run diagnose:runtime
npm run codex:engineering
```

Expected:

- `codex mcp list` contains `vortek-dataset`, `firecrawl`, `supabase`.
- Runtime diagnostics show DNS/HTTP reachable.
- Mercado Livre item check is `ok` (not `blocked_by_policy`).

## Evidence to Attach in Ops Ticket

- Output of `npm run diagnose:runtime`.
- `codex mcp list` output.
- Failing sample response containing `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (before change).
- Successful sample response from the same endpoint (after change).

## Incident Fallback

If PolicyAgent blocks return unexpectedly:

1. Use dataset/docs workflow:
   - `consultar_dataset` -> `firecrawl_search`/`search_docs` -> `firecrawl_scrape`.
2. Open runtime/policy incident with attached diagnostics.
3. SLA recommendation: resolve within 30 minutes during business hours.
