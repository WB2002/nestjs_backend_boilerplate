#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if command -v osv-scanner >/dev/null 2>&1; then
  exec osv-scanner --lockfile=pnpm-lock.yaml
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "${ROOT_DIR}:/repo" -w /repo ghcr.io/google/osv-scanner:latest \
    --lockfile=pnpm-lock.yaml
fi

echo "osv-scanner: install osv-scanner CLI or Docker to run locally" >&2
exit 1
