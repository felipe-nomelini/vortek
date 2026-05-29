#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI não encontrado no PATH."
  exit 1
fi

cd "$ROOT_DIR"

exec codex \
  --sandbox danger-full-access \
  --ask-for-approval never \
  --search \
  --cd "$ROOT_DIR" \
  "$@"

