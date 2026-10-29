#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--update" ]; then
  echo "ratchet --update: record new baselines manually in quality/baseline.json after ADR 0001 is accepted"
  exit 0
fi

echo "skip: mutation_score (optional)"
echo "skip: bundle_size (optional)"

required=$(jq -r '
  .metrics
  | to_entries[]
  | select(.key != "mutation_score" and .key != "bundle_size")
  | select(.value == null)
  | .key
' quality/baseline.json)

if [ -n "$required" ]; then
  while IFS= read -r metric; do
    echo "ratchet: unset required metric ${metric} — set quality/baseline.json or accept docs/adr/0001-stack.md"
  done <<< "$required"
  exit 1
fi

echo "ratchet: baseline present; automated measurement enforcement deferred until docs/adr/0001-stack.md is accepted"
exit 0
