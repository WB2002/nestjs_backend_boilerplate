#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# Match pnpm audit --audit-level=high (CVSS >= 7.0).
AUDIT_LEVEL="${OSV_AUDIT_LEVEL:-high}"
case "${AUDIT_LEVEL}" in
  critical) MIN_CVSS="9.0" ;;
  high) MIN_CVSS="7.0" ;;
  medium) MIN_CVSS="4.0" ;;
  low) MIN_CVSS="0.1" ;;
  *)
    echo "osv-scanner: unknown OSV_AUDIT_LEVEL=${AUDIT_LEVEL}" >&2
    exit 1
    ;;
esac

OUTPUT="$(mktemp)"
trap 'rm -f "${OUTPUT}"' EXIT

scan_json() {
  osv-scanner scan source -L pnpm-lock.yaml -f json --output-file "${OUTPUT}"
}

scan_table() {
  osv-scanner scan source -L pnpm-lock.yaml -f table
}

if command -v osv-scanner >/dev/null 2>&1; then
  scan_json || true
  scan_table || true
elif command -v docker >/dev/null 2>&1; then
  JSON_OUT="${ROOT_DIR}/.osv-scan-output.json"
  rm -f "${JSON_OUT}"
  docker run --rm -v "${ROOT_DIR}:/repo" -w /repo ghcr.io/google/osv-scanner-action:v2.7.0 \
    scan source -L pnpm-lock.yaml -f json --output-file /repo/.osv-scan-output.json || true
  mv "${JSON_OUT}" "${OUTPUT}"
  docker run --rm -v "${ROOT_DIR}:/repo" -w /repo ghcr.io/google/osv-scanner-action:v2.7.0 \
    scan source -L pnpm-lock.yaml -f table || true
else
  echo "osv-scanner: install osv-scanner CLI or Docker to run locally" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "osv-scanner: jq required to apply audit-level=${AUDIT_LEVEL}" >&2
  exit 1
fi

FAIL_COUNT="$(
  jq --arg min "${MIN_CVSS}" '
    [
      .results[]?.packages[]?.groups[]?
      | (.max_severity | tonumber?)
      | select(. != null and . >= ($min | tonumber))
    ] | length
  ' "${OUTPUT}"
)"

if [ "${FAIL_COUNT}" -gt 0 ]; then
  echo "osv-scanner: ${FAIL_COUNT} finding(s) with CVSS >= ${MIN_CVSS} (${AUDIT_LEVEL})" >&2
  exit 1
fi

echo "osv-scanner: ok (no findings at or above ${AUDIT_LEVEL}; lower-severity issues may still be listed above)"
exit 0
