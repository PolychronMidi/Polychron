#!/usr/bin/env bash
# Start OmniRoute for HME OVERDRIVE_MODE=1 integration.
# Usage: ./start.sh [--port PORT] [--configure]
#   --port PORT    Override default port (20128)
#   --configure     Also configure the opencode-go credential
#   --foreground    Run in foreground (default: background + disown)
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="20128"
DO_CONFIGURE=0
FOREGROUND=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --configure) DO_CONFIGURE=1; shift ;;
    --foreground) FOREGROUND=1; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

cd "$SCRIPT_DIR"

# Source project .env for credentials
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PROJECT_ENV="${PROJECT_ROOT}/.env"
if [ -f "$PROJECT_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROJECT_ENV"
  set +a
fi

# Prefer nvm v24 node for watchdog/supervisor shells.
_NODE_BIN="$(command -v node 2>/dev/null || echo node)"
if [ -d "$HOME/.nvm/versions/node" ]; then
  _NVM_NODE=$(ls -d "$HOME/.nvm/versions/node/v24"*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$_NVM_NODE" ] && [ -x "$_NVM_NODE" ] && _NODE_BIN="$_NVM_NODE"
fi
export PATH="$(dirname "$_NODE_BIN"):$PATH"

_omni_pids() {
  pgrep -f "omniroute --no-open --port ${PORT}|node_modules/.bin/omniroute --no-open --port ${PORT}" 2>/dev/null | \
    while read -r _pid; do
      [ -n "$_pid" ] && [ "$_pid" != "$$" ] && echo "$_pid"
    done
}

if ! curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1; then
  _stale_pids="$(_omni_pids | tr '\n' ' ')"
  if [ -n "$_stale_pids" ]; then
    echo "[omniroute] stale process(es) without healthy /v1/models: ${_stale_pids}"
    for _pid in $_stale_pids; do kill -TERM "$_pid" 2>/dev/null || true; done
    sleep 2
    for _pid in $_stale_pids; do kill -0 "$_pid" 2>/dev/null && kill -KILL "$_pid" 2>/dev/null || true; done
  fi
fi

# Check if already running
if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1; then
  echo "[omniroute] already running on :${PORT}"
else
  echo "[omniroute] starting on :${PORT}..."
  if [ "$FOREGROUND" -eq 1 ]; then
    HME_OMNIROUTE_PORT="$PORT" \
      node_modules/.bin/omniroute --no-open --port "$PORT"
    exit $?
  fi

  mkdir -p "${PROJECT_ROOT}/log"
  _MARKER="=== omniroute start $(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$$ port=${PORT} ==="
  if command -v setsid >/dev/null 2>&1; then
    HME_OMNIROUTE_PORT="$PORT" \
      setsid bash -c 'echo "$1"; exec node_modules/.bin/omniroute --no-open --port "$2"' _ "$_MARKER" "$PORT" \
        > "${PROJECT_ROOT}/log/omniroute.out" 2>&1 < /dev/null &
  else
    HME_OMNIROUTE_PORT="$PORT" \
      nohup bash -c 'echo "$1"; exec node_modules/.bin/omniroute --no-open --port "$2"' _ "$_MARKER" "$PORT" \
        > "${PROJECT_ROOT}/log/omniroute.out" 2>&1 < /dev/null &
  fi
  ORPID=$!
  echo "[omniroute] pid=${ORPID}"
  disown 2>/dev/null || true

  # Wait for health
  _waited=0
  while [ "$_waited" -lt 20 ]; do
    curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1 && break
    sleep 1
    _waited=$((_waited + 1))
  done

  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1; then
    echo "[omniroute] ready after ${_waited}s"
  else
    echo "[omniroute] WARNING: startup timed out after ${_waited}s"
  fi
fi

_REASONING_CONFIG="$PROJECT_ROOT/tools/HME/scripts/configure-omniroute-max-reasoning.py"
if [ -x "$_REASONING_CONFIG" ]; then
  "$_REASONING_CONFIG" --port "$PORT" >/dev/null 2>&1 \
    && echo "[omniroute] max reasoning configured" \
    || echo "[omniroute] WARNING: max reasoning config failed"
fi

# Configure provider credentials
if [ "$DO_CONFIGURE" -eq 1 ]; then
  OPENCODE_KEY="${OPENCODE_API_KEY:-}"
  if [ -z "$OPENCODE_KEY" ]; then
    echo "[omniroute] OPENCODE_API_KEY not set -- skipping credential setup"
    exit 0
  fi

  # Login
  LOGIN=$(curl -sf -c /tmp/omni-setup-cookies.txt -X POST \
    "http://127.0.0.1:${PORT}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"password":"polychron"}' 2>&1) || true

  if ! echo "$LOGIN" | grep -q '"success":true'; then
    echo "[omniroute] login failed: $LOGIN"
    exit 1
  fi

  # Check if already configured
  EXISTING=$(curl -sf -b /tmp/omni-setup-cookies.txt \
    "http://127.0.0.1:${PORT}/api/providers?provider=opencode-go" 2>&1) || true

  if echo "$EXISTING" | grep -q '"apiKey"'; then
    echo "[omniroute] opencode-go already configured"
  else
    echo "[omniroute] adding opencode-go connection..."
    RESULT=$(curl -sf -b /tmp/omni-setup-cookies.txt -X POST \
      "http://127.0.0.1:${PORT}/api/providers" \
      -H "Content-Type: application/json" \
      -d "{\"provider\":\"opencode-go\",\"apiKey\":\"${OPENCODE_KEY}\",\"name\":\"Polychron HME\"}" 2>&1) || true

    if echo "$RESULT" | grep -q '"connection"'; then
      echo "[omniroute] opencode-go configured successfully"
    else
      echo "[omniroute] opencode-go setup failed: $RESULT"
    fi
  fi
  rm -f /tmp/omni-setup-cookies.txt
fi

# Auto-repair: reset expired opencode-go credentials (OmniRoute's health-check
# sometimes tests with wrong model and marks valid keys as expired).
_repair_opencode_credentials() {
  local _port="$1"
  curl -sf -c /tmp/omni-repair.txt -X POST "http://127.0.0.1:${_port}/api/auth/login" \
    -H "Content-Type: application/json" -d '{"password":"polychron"}' >/dev/null || return 0
  curl -sf -b /tmp/omni-repair.txt "http://127.0.0.1:${_port}/api/providers" 2>/dev/null | \
    python3 -c "
import sys,json
for c in json.load(sys.stdin).get('connections',[]):
    if c['provider']=='opencode-go' and c.get('testStatus')=='expired':
        print(c['id'])
" | while read _cid; do
    curl -sf -b /tmp/omni-repair.txt -X PUT "http://127.0.0.1:${_port}/api/providers/${_cid}" \
      -H "Content-Type: application/json" \
      -d '{"testStatus":"success","isActive":true,"lastError":null,"errorCode":null}' >/dev/null && \
      echo "[omniroute] repaired expired opencode-go credential ${_cid}"
  done
  rm -f /tmp/omni-repair.txt
}
_repair_opencode_credentials "$PORT"
