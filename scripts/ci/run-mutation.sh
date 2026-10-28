#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

MUTATE_FILES=""
while IFS= read -r file; do
  if [ -n "${file}" ]; then
    if [ -n "${MUTATE_FILES}" ]; then
      MUTATE_FILES="${MUTATE_FILES},${file}"
    else
      MUTATE_FILES="${file}"
    fi
  fi
done < <(./scripts/ci/changed-ts-files.sh)

if [ -z "${MUTATE_FILES}" ]; then
  echo "mutation skipped: no eligible changed files"
  exit 0
fi

export MUTATE_FILES
export NODE_OPTIONS="${NODE_OPTIONS:---experimental-vm-modules}"
pnpm exec stryker run
