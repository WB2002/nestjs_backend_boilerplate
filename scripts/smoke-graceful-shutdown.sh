#!/usr/bin/env bash
# Live smoke: SIGTERM → /health/ready gains shuttingDown (503) → clean exit.
set -euo pipefail

PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"
DRAIN_MS="${SHUTDOWN_DRAIN_MS:-2000}"
FORCE_MS="${SHUTDOWN_FORCE_MS:-1000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
sleep 0.3

export SHUTDOWN_DRAIN_MS="$DRAIN_MS"
export SHUTDOWN_FORCE_MS="$FORCE_MS"
export PORT

echo "Starting node dist/main.js on PORT=$PORT drain=${DRAIN_MS}ms"
node dist/main.js > /tmp/graceful-shutdown-smoke.log 2>&1 &
APP_PID=$!
echo "APP_PID=$APP_PID"

cleanup() {
  if kill -0 "$APP_PID" 2>/dev/null; then
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait until HTTP responds
UP=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" "$BASE/health/ready" | grep -qE '^[0-9]+$'; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/ready")
    echo "ready after ${i} attempts: HTTP $CODE"
    UP=1
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "FAIL: process died during startup"
    cat /tmp/graceful-shutdown-smoke.log
    exit 1
  fi
  sleep 0.25
done

if [ "$UP" -ne 1 ]; then
  echo "FAIL: server never became reachable"
  cat /tmp/graceful-shutdown-smoke.log
  exit 1
fi

BEFORE=$(curl -s "$BASE/health/ready" || true)
echo "BEFORE=$BEFORE"
if echo "$BEFORE" | grep -q '"shuttingDown"'; then
  echo "FAIL: shuttingDown present before SIGTERM"
  exit 1
fi

echo "Sending SIGTERM to $APP_PID"
kill -TERM "$APP_PID"

FOUND=0
AFTER_STATUS=""
AFTER_BODY=""
# Poll during drain window
DEADLINE_MS=$((DRAIN_MS + 500))
START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
while true; do
  NOW_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
  ELAPSED=$((NOW_MS - START_MS))
  if [ "$ELAPSED" -gt "$DEADLINE_MS" ]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "Process exited during poll (elapsed ${ELAPSED}ms)"
    break
  fi
  RESP=$(curl -s -w "\n__STATUS__:%{http_code}" "$BASE/health/ready" 2>/dev/null || true)
  AFTER_BODY=$(echo "$RESP" | sed '/__STATUS__:/d')
  AFTER_STATUS=$(echo "$RESP" | sed -n 's/.*__STATUS__://p')
  if echo "$AFTER_BODY" | grep -q '"shuttingDown"'; then
    FOUND=1
    echo "FOUND shuttingDown at ${ELAPSED}ms status=$AFTER_STATUS"
    echo "AFTER=$AFTER_BODY"
    break
  fi
  sleep 0.05
done

if [ "$FOUND" -ne 1 ]; then
  echo "FAIL: never saw shuttingDown after SIGTERM"
  echo "last_status=$AFTER_STATUS last_body=$AFTER_BODY"
  echo "--- server log ---"
  cat /tmp/graceful-shutdown-smoke.log
  exit 1
fi

if [ "$AFTER_STATUS" != "503" ]; then
  echo "FAIL: expected 503 after SIGTERM, got $AFTER_STATUS"
  exit 1
fi

# Wait for clean exit
EXITED=0
for i in $(seq 1 60); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    EXITED=1
    break
  fi
  sleep 0.1
done

if [ "$EXITED" -ne 1 ]; then
  echo "FAIL: process did not exit"
  exit 1
fi

# Capture exit code
set +e
wait "$APP_PID"
EXIT_CODE=$?
set -e
trap - EXIT

echo "exit_code=$EXIT_CODE"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "FAIL: expected exit 0, got $EXIT_CODE"
  echo "--- server log ---"
  cat /tmp/graceful-shutdown-smoke.log
  exit 1
fi

if ! grep -q "marking not ready" /tmp/graceful-shutdown-smoke.log; then
  echo "WARN: GracefulShutdown drain log line not found (logger format may differ)"
fi

echo "SMOKE_OK"
