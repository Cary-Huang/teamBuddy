#!/usr/bin/env bash

set -euo pipefail

branch="$(git branch --show-current)"

case "$branch" in
  feature/* | fix/* | chore/* | docs/*)
    ;;
  *)
    echo "Refusing to ship branch '$branch'. Use feature/*, fix/*, chore/*, or docs/*." >&2
    exit 1
    ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit all intended changes before shipping." >&2
  exit 1
fi

git remote get-url origin >/dev/null
git fetch origin main

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "Branch is behind origin/main. Rebase it before shipping." >&2
  exit 1
fi

if [[ "$(git rev-list --count origin/main..HEAD)" -eq 0 ]]; then
  echo "Branch has no commits ahead of origin/main." >&2
  exit 1
fi

pnpm verify
git push --set-upstream origin "$branch"

echo "Pushed $branch. GitHub Actions will create or update its pull request."
