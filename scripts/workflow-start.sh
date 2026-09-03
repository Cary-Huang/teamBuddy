#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pnpm workflow:start <feature|fix|chore|docs> <kebab-case-name>

Examples:
  pnpm workflow:start feature capacity-dashboard
  pnpm workflow:start fix duplicate-outbox-event
EOF
}

change_type="${1:-}"
slug="${2:-}"

case "$change_type" in
  feature | feat)
    prefix="feature"
    ;;
  fix | bugfix)
    prefix="fix"
    ;;
  chore | docs)
    prefix="$change_type"
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ ! "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Branch name must be lower-case kebab-case: $slug" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before starting a branch." >&2
  exit 1
fi

git remote get-url origin >/dev/null
git switch main
git pull --ff-only origin main

branch="$prefix/$slug"
if git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Local branch already exists: $branch" >&2
  exit 1
fi
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  echo "Remote branch already exists: $branch" >&2
  exit 1
fi

git switch -c "$branch"
echo "Created $branch from the latest origin/main."
