#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== lint =="
pnpm quality:lint

echo "== types =="
pnpm quality:types

echo "== unit tests =="
pnpm test:unit

echo "verify: OK"
