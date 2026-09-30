#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${SMOKE_PORT:-8765}"
OUTPUT_FILE="${TMPDIR:-/tmp}/coursera-read-only-smoke.html"
SERVER_LOG="${TMPDIR:-/tmp}/coursera-read-only-smoke-server.log"

CHROME_BIN="${CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
  CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi

if [[ -z "$CHROME_BIN" ]]; then
  echo "No Chrome/Chromium executable found." >&2
  exit 1
fi

cd "$ROOT_DIR"
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true' EXIT

READY=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${PORT}/tests/browser/read-only-smoke.html" >/dev/null; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ "$READY" != "1" ]]; then
  echo "Smoke-test HTTP server did not become ready." >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

"$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --virtual-time-budget=3000 \
  --dump-dom \
  "http://127.0.0.1:${PORT}/tests/browser/read-only-smoke.html" \
  >"$OUTPUT_FILE"

if ! grep -q 'data-smoke-status="pass"' "$OUTPUT_FILE"; then
  echo "Read-only browser smoke test failed." >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q 'data-dom-unchanged="true"' "$OUTPUT_FILE"; then
  echo "Read-only browser smoke test detected a DOM/control-state mutation." >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

echo "Read-only browser smoke test passed with unchanged DOM/control state."
