#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

SEMGREP_SCOPE="${SEMGREP_SCOPE:-full}"
INCLUDE_ARGS=(
  --include 'src/**/*.ts'
  --include 'test/**/*.ts'
  --include 'scripts/**/*.sh'
  --include 'scripts/**/*.bash'
)

if [ "${SEMGREP_SCOPE}" = 'changed' ]; then
  mapfile -t TARGETS < <(./scripts/ci/changed-app-files.sh || true)
  if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "semgrep skipped: no changed app files"
    exit 0
  fi
else
  mapfile -t TARGETS < <(
    find src test scripts -type f \( -name '*.ts' -o -name '*.sh' \) \
      ! -path 'test/security/semgrep-fixtures/*' -print
  )
fi

FILTERED=()
for f in "${TARGETS[@]}"; do
  case "${f}" in
    test/security/semgrep-fixtures/*) continue ;;
    *) FILTERED+=("${f}") ;;
  esac
done
TARGETS=("${FILTERED[@]}")

run_semgrep() {
  semgrep scan --error --config semgrep/config.yaml \
    --config p/javascript --config p/nodejs \
    "${INCLUDE_ARGS[@]}" "$@"
}

if command -v semgrep >/dev/null 2>&1; then
  run_semgrep "${TARGETS[@]}"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${ROOT_DIR}:/src" -w /src returntocorp/semgrep \
    semgrep scan --error --config semgrep/config.yaml \
    --config p/javascript --config p/nodejs \
    "${INCLUDE_ARGS[@]}" "${TARGETS[@]}"
  exit 0
fi

echo "semgrep: install semgrep CLI or Docker to run locally" >&2
exit 1
