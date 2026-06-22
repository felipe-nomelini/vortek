#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="${SYNC_EXPECTED_BRANCH:-main}"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "$EXPECTED_BRANCH" ]; then
  echo "[sync:main] current branch is '$branch', expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[sync:main] tracked changes pending; commit/stash before syncing" >&2
  git status --short >&2
  exit 1
fi

echo "[sync:main] fetching origin/$EXPECTED_BRANCH"
git fetch origin "$EXPECTED_BRANCH" --prune

echo "[sync:main] fast-forwarding local $EXPECTED_BRANCH"
git pull --ff-only origin "$EXPECTED_BRANCH"

echo "[sync:main] local workspace is synced at $(git rev-parse --short HEAD)"
