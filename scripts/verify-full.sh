#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== verify =="
scripts/verify.sh

echo "== integration =="
if [ "${SKIP_INTEGRATION:-}" = "1" ]; then
  echo "SKIP_INTEGRATION=1 — skipping pnpm test:integration"
else
  echo "Run locally with Docker: pnpm test:integration"
  echo "CI ai-sdlc workflow sets SKIP_INTEGRATION=1 on pull requests."
fi

echo "== ratchet =="
scripts/ratchet.sh

echo "verify-full: OK"
