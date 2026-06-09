#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_FILE="${ROOT_DIR}/.mcp.json"
ENV_FILE="${ROOT_DIR}/.env.local"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI não encontrado no PATH."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node não encontrado no PATH."
  exit 1
fi

if [ ! -f "$MCP_FILE" ]; then
  echo "Arquivo não encontrado: $MCP_FILE"
  exit 1
fi

declare -a REQUIRED=("vortek-dataset" "firecrawl" "supabase" "mercadopago-mcp-server")

read_env_fallback() {
  local key="$1"
  if [ -n "${!key:-}" ]; then
    printf "%s" "${!key}"
    return
  fi
  if [ ! -f "$ENV_FILE" ]; then
    printf ""
    return
  fi
  local line
  line="$(rg -n "^${key}=" "$ENV_FILE" -S | head -n 1 | sed 's/^[0-9]*://')"
  if [ -z "$line" ]; then
    printf ""
    return
  fi
  printf "%s" "${line#*=}"
}

FIRECRAWL_KEY="$(read_env_fallback FIRECRAWL_API_KEY)"
OPENROUTER_KEY="$(read_env_fallback OPENROUTER_API_KEY)"

echo "Sincronizando MCPs obrigatórios no registro local do Codex..."

if [ -z "$FIRECRAWL_KEY" ]; then
  echo "[warn] FIRECRAWL_API_KEY não definido no ambiente atual."
fi
if [ -z "$OPENROUTER_KEY" ]; then
  echo "[warn] OPENROUTER_API_KEY não definido no ambiente atual."
fi

for name in "${REQUIRED[@]}"; do
  exists="$(node -e '
const fs = require("fs");
const file = process.argv[1];
const name = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
process.stdout.write(String(Boolean(data?.mcpServers?.[name])));
' "$MCP_FILE" "$name")"
  if [ "$exists" != "true" ]; then
    echo "[$name] não está em .mcp.json; pulando."
    continue
  fi

  codex mcp remove "$name" >/dev/null 2>&1 || true

  url="$(node -e '
const fs = require("fs");
const file = process.argv[1];
const name = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
process.stdout.write(String(data?.mcpServers?.[name]?.url || ""));
' "$MCP_FILE" "$name")"
  if [ -n "$url" ]; then
    codex mcp add "$name" --url "$url" >/dev/null
    echo "[$name] registrado via URL."
    continue
  fi

  command="$(node -e '
const fs = require("fs");
const file = process.argv[1];
const name = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
process.stdout.write(String(data?.mcpServers?.[name]?.command || ""));
' "$MCP_FILE" "$name")"
  if [ -z "$command" ]; then
    echo "[$name] sem URL e sem command; pulando."
    continue
  fi

  mapfile -t args < <(node -e '
const fs = require("fs");
const file = process.argv[1];
const name = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const args = data?.mcpServers?.[name]?.args || [];
for (const a of args) process.stdout.write(String(a) + "\n");
' "$MCP_FILE" "$name")
  if [ "${#args[@]}" -eq 0 ]; then
    if [ "$name" = "firecrawl" ] && [ -n "$FIRECRAWL_KEY" ]; then
      codex mcp add "$name" --env "FIRECRAWL_API_KEY=${FIRECRAWL_KEY}" -- "$command" >/dev/null
    elif [ "$name" = "vortek-dataset" ] && [ -n "$OPENROUTER_KEY" ]; then
      codex mcp add "$name" --env "OPENROUTER_API_KEY=${OPENROUTER_KEY}" -- "$command" >/dev/null
    else
      codex mcp add "$name" -- "$command" >/dev/null
    fi
  else
    if [ "$name" = "firecrawl" ] && [ -n "$FIRECRAWL_KEY" ]; then
      codex mcp add "$name" --env "FIRECRAWL_API_KEY=${FIRECRAWL_KEY}" -- "$command" "${args[@]}" >/dev/null
    elif [ "$name" = "vortek-dataset" ] && [ -n "$OPENROUTER_KEY" ]; then
      codex mcp add "$name" --env "OPENROUTER_API_KEY=${OPENROUTER_KEY}" -- "$command" "${args[@]}" >/dev/null
    else
      codex mcp add "$name" -- "$command" "${args[@]}" >/dev/null
    fi
  fi
  echo "[$name] registrado via stdio."
done

echo
echo "MCPs configurados no Codex:"
codex mcp list

echo
echo "Próximo passo: reiniciar a sessão do agente para carregar os MCPs recém-registrados."
