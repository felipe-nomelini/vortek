#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SUPABASE_CLI="${PROJECT_ROOT}/node_modules/.bin/supabase"
NETWORK_NAME="bentevi-dev-loopback"
PROJECT_ID="bentevi-dev-local"
RUNTIME_ENVIRONMENT="${VORTEK_RUNTIME_ENVIRONMENT:-local_dev}"
ACTION="${1:-help}"

usage() {
  cat <<'EOF'
Uso: bash scripts/dev-supabase.sh <start|stop|status|reset>

O reset é destrutivo e exige confirmação explícita:
  bash scripts/dev-supabase.sh reset --confirm-local-reset
EOF
}

fail() {
  printf 'Erro: %s\n' "$1" >&2
  exit 1
}

case "${ACTION}" in
  start|stop|status)
    ;;
  reset)
    [[ "${2:-}" == "--confirm-local-reset" ]] || \
      fail "reset local exige --confirm-local-reset"
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "ação inválida: ${ACTION}"
    ;;
esac

[[ "${RUNTIME_ENVIRONMENT}" == "local_dev" ]] || \
  fail "este comando aceita somente VORTEK_RUNTIME_ENVIRONMENT=local_dev"
[[ -x "${SUPABASE_CLI}" ]] || \
  fail "Supabase CLI ausente; execute npm ci na raiz do projeto"
command -v docker >/dev/null 2>&1 || \
  fail "runtime Docker compatível não encontrado"
docker info >/dev/null 2>&1 || \
  fail "runtime Docker indisponível para o usuário atual"

ensure_loopback_network() {
  if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    docker network create \
      --driver bridge \
      --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
      --label shop.bentevi.purpose=local-dev \
      "${NETWORK_NAME}" >/dev/null
  fi

  local bind_address
  bind_address="$(docker network inspect \
    --format '{{ index .Options "com.docker.network.bridge.host_binding_ipv4" }}' \
    "${NETWORK_NAME}")"
  [[ "${bind_address}" == "127.0.0.1" ]] || \
    fail "a rede ${NETWORK_NAME} não está restrita a 127.0.0.1"
}

verify_loopback_bindings() {
  local container_id
  local bindings=""
  local current_bindings
  local unsafe_bindings
  local -a container_ids=()

  mapfile -t container_ids < <(
    docker ps -q --filter "label=com.supabase.cli.project=${PROJECT_ID}"
  )
  ((${#container_ids[@]} > 0)) || \
    fail "nenhum container ativo encontrado para ${PROJECT_ID}"

  for container_id in "${container_ids[@]}"; do
    current_bindings="$(docker inspect --format \
      '{{range $port, $items := .NetworkSettings.Ports}}{{range $items}}{{printf "%s\t%s\t%s\n" $.Name $port .HostIp}}{{end}}{{end}}' \
      "${container_id}")"
    if [[ -n "${current_bindings}" ]]; then
      bindings+="${current_bindings}"$'\n'
    fi
  done

  unsafe_bindings="$(printf '%s' "${bindings}" | awk -F '\t' \
    'NF == 3 && $3 != "127.0.0.1" && $3 != "::1" { print }')"
  if [[ -n "${unsafe_bindings}" ]]; then
    printf 'Bindings inseguros detectados:\n%s\n' "${unsafe_bindings}" >&2
    return 1
  fi
}

print_safe_status() {
  "${SUPABASE_CLI}" status --workdir "${PROJECT_ROOT}" --output env |
    awk -F= '$1 ~ /^(API_URL|GRAPHQL_URL|INBUCKET_URL|MAILPIT_URL|MCP_URL|REST_URL|STUDIO_URL)$/ { print }'
}

redact_sensitive_output() {
  sed -E \
    's#("(ANON_KEY|DB_URL|JWT_SECRET|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY)"[[:space:]]*:[[:space:]]*)"[^"]*"#\1"<redacted>"#g'
}

case "${ACTION}" in
  start)
    ensure_loopback_network
    "${SUPABASE_CLI}" start \
      --workdir "${PROJECT_ROOT}" \
      --network-id "${NETWORK_NAME}" 2>&1 | redact_sensitive_output
    if ! verify_loopback_bindings; then
      "${SUPABASE_CLI}" stop --workdir "${PROJECT_ROOT}" >/dev/null 2>&1 || true
      fail "Supabase local desligado porque há portas fora do loopback"
    fi
    ;;
  stop)
    "${SUPABASE_CLI}" stop --workdir "${PROJECT_ROOT}"
    ;;
  status)
    verify_loopback_bindings
    print_safe_status
    ;;
  reset)
    ensure_loopback_network
    "${SUPABASE_CLI}" db reset --workdir "${PROJECT_ROOT}"
    ;;
esac
