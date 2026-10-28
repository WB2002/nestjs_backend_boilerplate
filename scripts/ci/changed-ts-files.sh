#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

BASE_REF="${QUALITY_BASE_REF:-origin/main}"
if git rev-parse --verify "${BASE_REF}" >/dev/null 2>&1; then
  MERGE_BASE="$(git merge-base HEAD "${BASE_REF}" 2>/dev/null || echo "${BASE_REF}")"
else
  MERGE_BASE="HEAD~1"
fi

git diff --name-only --diff-filter=ACMRT "${MERGE_BASE}...HEAD" -- 'src/**/*.ts' \
  | while IFS= read -r file; do
      case "${file}" in
        *.spec.ts|*.integration.spec.ts|*.module.ts|src/main.ts|src/instrumentation.ts|src/graphql.ts)
          continue
          ;;
        *)
          printf '%s\n' "${file}"
          ;;
      esac
    done
