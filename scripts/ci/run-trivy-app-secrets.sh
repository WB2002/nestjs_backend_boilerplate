#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

SCAN_PATHS=(src test scripts)
TRIVY_ARGS=(
  fs
  --scanners secret
  --skip-dirs node_modules,dist,.git
  --severity HIGH,CRITICAL
  --exit-code 1
)

if command -v trivy >/dev/null 2>&1; then
  exec trivy "${TRIVY_ARGS[@]}" "${SCAN_PATHS[@]}"
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "${ROOT_DIR}:/repo" aquasec/trivy:latest \
    fs --scanners secret --skip-dirs node_modules,dist,.git \
    --severity HIGH,CRITICAL --exit-code 1 /repo/src /repo/test /repo/scripts
fi

echo "trivy: install trivy CLI or Docker to run locally" >&2
exit 1
