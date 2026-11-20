#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib/ensure-pnpm.sh"
ensure_pnpm_on_path

echo "== lint =="
pnpm quality:lint

echo "== types =="
pnpm quality:types

echo "== unit tests =="
pnpm test:unit

echo "verify: OK"
