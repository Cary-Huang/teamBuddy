#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pnpm production:preflight -- /absolute/path/to/.env.production

Validates a TeamBuddy production runner without starting or changing services.
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ "$#" -gt 1 ]]; then
  usage >&2
  exit 2
fi

env_file="${1:-}"

case "$env_file" in
  -h | --help)
    usage
    exit 0
    ;;
  "")
    usage >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Production runner must use Linux." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64 | amd64)
    ;;
  *)
    echo "Production runner must use x64 architecture." >&2
    exit 1
    ;;
esac

if [[ "$env_file" != /* ]]; then
  echo "Production environment file path must be absolute." >&2
  exit 2
fi
if [[ ! -f "$env_file" || ! -r "$env_file" ]]; then
  echo "Production environment file must be a readable regular file." >&2
  exit 1
fi

file_mode="$(stat -c '%a' "$env_file")"
case "$file_mode" in
  400 | 440 | 600 | 640)
    ;;
  *)
    echo "Production environment file permissions must be 400, 440, 600, or 640; found $file_mode." >&2
    exit 1
    ;;
esac

for command_name in docker curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

docker info >/dev/null
docker compose version >/dev/null

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_dir/.." && pwd)"

IMAGE_OWNER=preflight \
IMAGE_TAG=preflight \
  docker compose \
    --project-name teambuddy-preflight \
    --env-file "$env_file" \
    --file "$repository_root/compose.production.yml" \
    config >/dev/null

echo "Production runner preflight passed. No services were changed."
