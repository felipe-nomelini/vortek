#!/usr/bin/env bash
set -euo pipefail

PATTERN='(--build-arg[ =]+(SUPABASE_SERVICE_ROLE_KEY|API_SECRET_KEY))|(^\s*ARG\s+(SUPABASE_SERVICE_ROLE_KEY|API_SECRET_KEY))'
MATCHES="$(
  rg -n -i --hidden \
    --glob '!.git' \
    --glob '!node_modules' \
    --glob '!scripts/**' \
    --glob '!GUIDE.md' \
    --glob '!AGENTS.md' \
    --glob '!*.jsonl' \
    "$PATTERN" \
    .nixpacks nixpacks.toml Dockerfile Dockerfile.* docker-compose.yml docker-compose.yaml easypanel 2>/dev/null || true
)"

if [[ -n "$MATCHES" ]]; then
  echo "[ERRO] Segredo detectado em build context (build-arg/ARG). Remova do build e use apenas runtime env."
  echo "$MATCHES"
  exit 1
fi

echo "[OK] Nenhum segredo sensível detectado em build-arg/ARG."
