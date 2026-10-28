#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
find "${ROOT_DIR}/src" -name '*.graphql' -print | sort | while IFS= read -r f; do
  echo "# --- ${f#${ROOT_DIR}/} ---"
  cat "${f}"
  echo
done
