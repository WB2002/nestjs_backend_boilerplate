#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if command -v trivy >/dev/null 2>&1; then
  exec trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 "${ROOT_DIR}"
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm \
    -v "${ROOT_DIR}:/repo" \
    aquasec/trivy:latest \
    fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 /repo
fi

echo "trivy: install trivy CLI or Docker to run locally" >&2
exit 1
