#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
SKIP_GIT_CHECK=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-git-check) SKIP_GIT_CHECK=true ;;
    -h|--help)
      cat <<'USAGE'
Usage: npm run deploy:easypanel -- [--dry-run] [--skip-git-check]

Triggers the official Easypanel Deploy Webhook so the deployment appears in
the Easypanel UI/history. Do not use docker build/service update for normal app
deploys, because that bypasses Easypanel.

Required env:
  EASYPANEL_DEPLOY_WEBHOOK_URL

Optional env:
  EASYPANEL_DEPLOY_HTTP_METHOD=POST|GET
  EASYPANEL_DEPLOY_EXPECTED_BRANCH=main
  EASYPANEL_DEPLOY_ENV_FILE=.env.deploy.local
  EASYPANEL_DEPLOY_CONNECT_TIMEOUT=10
  EASYPANEL_DEPLOY_MAX_TIME=60
USAGE
      exit 0
      ;;
    *)
      echo "[deploy:easypanel] unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

ENV_FILE="${EASYPANEL_DEPLOY_ENV_FILE:-.env.deploy.local}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

WEBHOOK_URL="${EASYPANEL_DEPLOY_WEBHOOK_URL:-}"
METHOD="${EASYPANEL_DEPLOY_HTTP_METHOD:-POST}"
EXPECTED_BRANCH="${EASYPANEL_DEPLOY_EXPECTED_BRANCH:-main}"
CONNECT_TIMEOUT="${EASYPANEL_DEPLOY_CONNECT_TIMEOUT:-10}"
MAX_TIME="${EASYPANEL_DEPLOY_MAX_TIME:-60}"

if [ -z "$WEBHOOK_URL" ]; then
  echo "[deploy:easypanel] missing EASYPANEL_DEPLOY_WEBHOOK_URL" >&2
  echo "[deploy:easypanel] create .env.deploy.local from .env.example and paste the Easypanel Deploy Webhook URL." >&2
  exit 1
fi

if [ "$METHOD" != "POST" ] && [ "$METHOD" != "GET" ]; then
  echo "[deploy:easypanel] EASYPANEL_DEPLOY_HTTP_METHOD must be POST or GET" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
commit="$(git rev-parse --short HEAD)"

if [ "$SKIP_GIT_CHECK" = false ]; then
  if [ "$branch" != "$EXPECTED_BRANCH" ]; then
    echo "[deploy:easypanel] current branch is '$branch', expected '$EXPECTED_BRANCH'" >&2
    exit 1
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[deploy:easypanel] tracked changes are not committed" >&2
    exit 1
  fi
fi

echo "[deploy:easypanel] triggering Easypanel deploy for $branch@$commit"
echo "[deploy:easypanel] method=$METHOD"

if [ "$DRY_RUN" = true ]; then
  echo "[deploy:easypanel] dry-run: webhook not called"
  exit 0
fi

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT
curl_args=(
  -sS
  --connect-timeout "$CONNECT_TIMEOUT"
  --max-time "$MAX_TIME"
  -o "$tmp_body"
  -w '%{http_code}'
)

if [ "$METHOD" = "POST" ]; then
  status="$(curl "${curl_args[@]}" -X POST "$WEBHOOK_URL")"
else
  status="$(curl "${curl_args[@]}" "$WEBHOOK_URL")"
fi

if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
  echo "[deploy:easypanel] webhook failed with HTTP $status" >&2
  sed -n '1,40p' "$tmp_body" >&2
  exit 1
fi

echo "[deploy:easypanel] webhook accepted: HTTP $status"
echo "[deploy:easypanel] now check Easypanel Deployments/Actions for visible build logs."
