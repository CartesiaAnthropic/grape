#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TARGET="$REPO_ROOT/.env.local"

if [[ -f "$TARGET" ]]; then
  echo ".env.local already exists, skipping."
  exit 0
fi

MAIN_WORKTREE="$(git -C "$REPO_ROOT" worktree list --porcelain | head -1 | sed 's/^worktree //')"
SOURCE="$MAIN_WORKTREE/.env.local"

if [[ ! -f "$SOURCE" ]]; then
  echo "Warning: No .env.local found in main worktree ($MAIN_WORKTREE)."
  echo "See .env.example for required variables."
  exit 0
fi

cp "$SOURCE" "$TARGET"
echo "Copied .env.local from $MAIN_WORKTREE"
