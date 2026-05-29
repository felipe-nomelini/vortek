#!/usr/bin/env bash
set -u

DOMAINS=(
  "api.mercadolibre.com"
  "developers.mercadolivre.com.br"
  "api.dslite.com.br"
  "www.brasilnfe.com.br"
)

echo "== Runtime Diagnostics =="
echo "DATE: $(date -Iseconds)"
echo "PWD:  $(pwd)"
echo

echo "== Sandbox Flags =="
echo "CODEX_SANDBOX_NETWORK_DISABLED=${CODEX_SANDBOX_NETWORK_DISABLED:-<unset>}"
echo "CODEX_CI=${CODEX_CI:-<unset>}"
echo

echo "== Codex MCP Registry =="
if command -v codex >/dev/null 2>&1; then
  codex mcp list 2>/tmp/vortek_mcp_list_err.txt || true
  if [ -s /tmp/vortek_mcp_list_err.txt ]; then
    err="$(cat /tmp/vortek_mcp_list_err.txt | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    echo "MCP list stderr: $err"
  fi
else
  echo "codex CLI not found"
fi
echo

if ! command -v getent >/dev/null 2>&1; then
  echo "[warn] getent not found; DNS checks will be skipped."
  HAS_GETENT=0
else
  HAS_GETENT=1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[error] curl not found; HTTP checks cannot run."
  exit 1
fi

echo "== DNS Checks =="
for domain in "${DOMAINS[@]}"; do
  if [ "$HAS_GETENT" -eq 0 ]; then
    echo "DNS $domain -> skipped"
    continue
  fi
  if getent hosts "$domain" >/tmp/vortek_dns_check.txt 2>&1; then
    first_line="$(head -n 1 /tmp/vortek_dns_check.txt | tr -s ' ')"
    echo "DNS $domain -> ok ($first_line)"
  else
    err="$(cat /tmp/vortek_dns_check.txt | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    echo "DNS $domain -> fail ($err)"
  fi
done
echo

echo "== HTTP HEAD Checks =="
for domain in "${DOMAINS[@]}"; do
  out_file="/tmp/vortek_http_${domain//./_}.txt"
  if curl -I -sS "https://${domain}" -o "$out_file" 2>/tmp/vortek_http_error.txt; then
    status_line="$(head -n 1 "$out_file" | tr -d '\r')"
    echo "HTTP $domain -> ok (${status_line:-no-status-line})"
  else
    err="$(cat /tmp/vortek_http_error.txt | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    echo "HTTP $domain -> fail ($err)"
  fi
done
echo

echo "== Mercado Livre Item Check =="
ml_item_file="/tmp/vortek_ml_item.txt"
ml_err_file="/tmp/vortek_ml_item_err.txt"
if curl -sS "https://api.mercadolibre.com/items/MLB6573154078" -o "$ml_item_file" 2>"$ml_err_file"; then
  sample="$(head -c 220 "$ml_item_file" | tr '\n' ' ')"
  if echo "$sample" | rg -q "PA_UNAUTHORIZED_RESULT_FROM_POLICIES|blocked_by\":\"PolicyAgent"; then
    echo "ML item -> blocked_by_policy (${sample})"
  else
    echo "ML item -> ok (${sample})"
  fi
else
  err="$(cat "$ml_err_file" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  echo "ML item -> fail ($err)"
fi
