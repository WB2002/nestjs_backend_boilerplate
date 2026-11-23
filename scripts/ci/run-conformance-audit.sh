#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

resolve_audit_bin() {
  if [[ -n "${CONFORMANCE_AUDIT_BIN:-}" && -x "${CONFORMANCE_AUDIT_BIN}" ]]; then
    echo "${CONFORMANCE_AUDIT_BIN}"
    return 0
  fi

  local candidates=(
    "${ROOT_DIR}/.conformance-runner/bin/conformance-audit"
    "${ROOT_DIR}/../backend_boilerplate_conformance_tests/bin/conformance-audit"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  if command -v conformance-audit >/dev/null 2>&1; then
    command -v conformance-audit
    return 0
  fi

  local src_dirs=(
    "${ROOT_DIR}/.conformance-runner"
    "${ROOT_DIR}/../backend_boilerplate_conformance_tests"
  )
  if command -v go >/dev/null 2>&1; then
    for src_dir in "${src_dirs[@]}"; do
      if [[ -f "${src_dir}/cmd/conformance-audit/main.go" ]]; then
        mkdir -p "${src_dir}/bin"
        (cd "${src_dir}" && go build -o bin/conformance-audit ./cmd/conformance-audit) >&2
        echo "${src_dir}/bin/conformance-audit"
        return 0
      fi
    done
  fi

  echo "Error: conformance-audit binary not found. Set CONFORMANCE_AUDIT_BIN or build ../backend_boilerplate_conformance_tests." >&2
  return 1
}

AUDIT_BIN="$(resolve_audit_bin)"

STAGES="sast,graph,pentest,load"
HAS_URL=false

args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  arg="${args[$i]}"
  case "${arg}" in
    --stages=*)
      STAGES="${arg#--stages=}"
      ;;
    --stages)
      if ((i + 1 < ${#args[@]})); then
        STAGES="${args[$((i + 1))]}"
      fi
      ;;
    --url=*|--url)
      HAS_URL=true
      ;;
  esac
done

is_static_only() {
  local IFS=','
  for stage in $1; do
    case "${stage}" in
      sast|graph) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

if is_static_only "${STAGES}" && [[ "${HAS_URL}" == "false" ]]; then
  exec "${AUDIT_BIN}" \
    --target "${ROOT_DIR}" \
    --manifest "${ROOT_DIR}/boilerplate.manifest.json" \
    "$@"
fi

if [[ "${SKIP_APP_BOOT:-false}" == "true" ]]; then
  exec "${AUDIT_BIN}" \
    --target "${ROOT_DIR}" \
    --manifest "${ROOT_DIR}/boilerplate.manifest.json" \
    "$@"
fi

if [[ -f "${ROOT_DIR}/.env.conformance.example" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env.conformance.example"
  set +a
fi

export PORT="${PORT:-3000}"
export MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/nestjs-conformance}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export COOKIE_SECRET="${COOKIE_SECRET:-conformance-cookie-secret-32-chars-min}"
export ACCESS_TOKEN_TTL=900
export SESSION_TTL=604800
export CONFORMANCE_HARNESS_TOKEN="${CONFORMANCE_HARNESS_TOKEN:-conformance-harness-secret-token}"
export GEOIP_DATABASE_PATH="${GEOIP_DATABASE_PATH:-${ROOT_DIR}/test/fixtures/geoip/placeholder.mmdb}"
export OTEL_ENABLED=false
export BACKGROUND_JOBS_ENABLED=false
export BACKGROUND_WORKER_ENABLED=false

TMP_KEY_DIR=""
APP_PID=""

cleanup() {
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
    wait "${APP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${TMP_KEY_DIR}" && -d "${TMP_KEY_DIR}" ]]; then
    rm -rf "${TMP_KEY_DIR}"
  fi
}
trap cleanup EXIT

if [[ -z "${JWT_PRIVATE_KEY:-}" || -z "${JWT_PUBLIC_KEY:-}" ]]; then
  TMP_KEY_DIR="$(mktemp -d)"
  openssl genrsa -out "${TMP_KEY_DIR}/private.pem" 2048 >/dev/null 2>&1
  openssl rsa -in "${TMP_KEY_DIR}/private.pem" -pubout -out "${TMP_KEY_DIR}/public.pem" >/dev/null 2>&1
  export JWT_PRIVATE_KEY
  export JWT_PUBLIC_KEY
  JWT_PRIVATE_KEY="$(cat "${TMP_KEY_DIR}/private.pem")"
  JWT_PUBLIC_KEY="$(cat "${TMP_KEY_DIR}/public.pem")"
fi

if [[ ! -f "${ROOT_DIR}/dist/main.js" ]]; then
  pnpm build
fi

node "${ROOT_DIR}/dist/main.js" > /tmp/nestjs-conformance.log 2>&1 &
APP_PID=$!

HEALTH_URL="http://127.0.0.1:${PORT}/health/live"
READY=false
for _ in $(seq 1 30); do
  if ! kill -0 "${APP_PID}" 2>/dev/null; then
    echo "Error: NestJS app exited prematurely. Logs:" >&2
    cat /tmp/nestjs-conformance.log >&2 || true
    exit 1
  fi
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${HEALTH_URL}" || true)"
  if [[ "${HTTP_CODE}" == "200" ]]; then
    READY=true
    break
  fi
  sleep 1
done

if [[ "${READY}" != "true" ]]; then
  echo "Error: Timed out waiting for ${HEALTH_URL}. Logs:" >&2
  cat /tmp/nestjs-conformance.log >&2 || true
  exit 1
fi

"${AUDIT_BIN}" \
  --target "${ROOT_DIR}" \
  --manifest "${ROOT_DIR}/boilerplate.manifest.json" \
  --url "http://127.0.0.1:${PORT}" \
  "$@"
