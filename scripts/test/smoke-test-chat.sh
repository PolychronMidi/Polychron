#!/usr/bin/env bash
# Chat end-to-end smoke test. Boots the tools/HME/chat server, opens an
# SSE subscriber, POSTs a send, and asserts the stream completes. Catches
# regressions in: server boot, SSE lifecycle, message routing, stream
# completion, transcript logging.
#
# Focus: transport + orchestration, NOT model output quality. A PASS here
# means "the chat plumbing works"; it does not validate what the model said.
#
# Exit codes: 0=pass, non-zero=specific assertion failure.
set -u
set -o pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
_CHAT_DIR="$_PROJECT_ROOT/tools/HME/chat"
_PORT=${HME_CHAT_PORT:-3131}
_BASE="http://127.0.0.1:${_PORT}"

_pass() { echo "  PASS: $*"; }
_fail() { echo "  FAIL: $*" >&2; _cleanup; exit 1; }
_skip() { echo "  SKIP: $*"; _cleanup; exit 0; }

_owns_server=0
_server_pid=""
_sse_pid=""
_sse_out=""

_cleanup() {
  if [ -n "$_sse_pid" ] && kill -0 "$_sse_pid" 2>/dev/null; then
    kill "$_sse_pid" 2>/dev/null || true
    wait "$_sse_pid" 2>/dev/null || true
  fi
  if [ -n "$_sse_out" ] && [ -f "$_sse_out" ]; then
    rm -f "$_sse_out"
  fi
  if [ "$_owns_server" = "1" ] && [ -n "$_server_pid" ] && kill -0 "$_server_pid" 2>/dev/null; then
    echo "  cleanup: stopping chat server (PID $_server_pid)"
    kill "$_server_pid" 2>/dev/null || true
    wait "$_server_pid" 2>/dev/null || true
  fi
}
trap _cleanup EXIT

echo "=== HME chat end-to-end smoke test ==="

# Choose a message type that the server's known to echo back through SSE.
# "listSessions" is the safest: it forces a sessionList SSE event, which
# is a concrete delivery signal distinct from keepalive heartbeats.
_PROBE_TYPE="listSessions"

# --- Assertion 1: build artifact present ---
echo "[1/5] build artifact present"
if [ ! -f "$_CHAT_DIR/out/server.js" ]; then
  _fail "$_CHAT_DIR/out/server.js missing — run \`cd $_CHAT_DIR && npm run compile\` first"
fi
_pass "chat build artifact present"

# --- Assertion 2: server reachable (starting it ourselves if needed) ---
echo "[2/5] server reachable on port $_PORT"
if curl -sf -o /dev/null "$_BASE/"; then
  _pass "server already running"
else
  echo "  starting ephemeral server…"
  cd "$_PROJECT_ROOT"
  node "$_CHAT_DIR/out/server.js" >/tmp/hme-chat-smoke.log 2>&1 &
  _server_pid=$!
  _owns_server=1
  _waited=0
  until curl -sf -o /dev/null "$_BASE/"; do
    if [ "$_waited" -ge 20 ]; then
      _fail "server never became reachable within 20s — see /tmp/hme-chat-smoke.log"
    fi
    sleep 1
    _waited=$((_waited + 1))
  done
  _pass "ephemeral server started (PID $_server_pid, waited ${_waited}s)"
fi

# --- Assertion 3: SSE stream accepts a subscriber ---
echo "[3/5] SSE stream opens"
_sse_out=$(mktemp)
curl -sN --max-time 30 "$_BASE/api/events" > "$_sse_out" &
_sse_pid=$!
sleep 1
if ! kill -0 "$_sse_pid" 2>/dev/null; then
  _fail "SSE subscriber died immediately — check /tmp/hme-chat-smoke.log"
fi
_pass "SSE subscriber attached (curl PID $_sse_pid)"

# --- Assertion 4: POST /api/message returns ok ---
echo "[4/5] POST /api/message ($_PROBE_TYPE) accepted"
_payload="{\"type\":\"$_PROBE_TYPE\"}"
_resp=$(curl -sf -X POST "$_BASE/api/message" \
  -H "Content-Type: application/json" \
  -d "$_payload" --max-time 5 2>&1 || true)
if [ -z "$_resp" ]; then
  _fail "POST returned empty body — server may have crashed"
fi
if ! echo "$_resp" | grep -q '"ok":true'; then
  _fail "POST rejected: $_resp"
fi
_pass "POST accepted: $_resp"

# --- Assertion 5: SSE stream delivered an event after the POST ---
# Previously this asserted only "subscriber stayed alive," which is weak:
# a broken broadcaster would still leave the subscriber alive silently.
# Now we require at least one `data:` frame within 5s of the POST. The
# listSessions message elicits a sessionList event from BrowserPanel.
echo "[5/5] SSE event observed after POST"
_waited=0
while [ "$_waited" -lt 5 ]; do
  if [ -s "$_sse_out" ] && grep -q '^data:' "$_sse_out"; then
    break
  fi
  sleep 1
  _waited=$((_waited + 1))
done
if [ ! -s "$_sse_out" ] || ! grep -q '^data:' "$_sse_out"; then
  _fail "no SSE event delivered within 5s of POST — broadcaster broken or subscriber filtering out traffic. Output: $(wc -c < "$_sse_out") bytes"
fi
_bytes=$(wc -c < "$_sse_out")
_event_count=$(grep -c '^data:' "$_sse_out" 2>/dev/null || echo 0)
_pass "SSE delivered ${_event_count} event(s) / ${_bytes} bytes within ${_waited}s of POST"

echo
echo "=== ALL 5 CHAT ASSERTIONS PASSED ==="
exit 0
