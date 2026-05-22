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
PROJECT_ROOT="${PROJECT_ROOT}"
PROJECT_ENV="${PROJECT_ROOT}/.env"
if [ -f "$PROJECT_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROJECT_ENV"
  set +a
fi
_OMNI_RUNTIME_DIR="${PROJECT_ROOT}/tools/HME/runtime"
mkdir -p "$_OMNI_RUNTIME_DIR" 2>/dev/null || true
_OMNI_SETUP_COOKIE="$_OMNI_RUNTIME_DIR/omni-setup-cookies.txt"
_OMNI_REPAIR_COOKIE="$_OMNI_RUNTIME_DIR/omni-repair.txt"

_prune_untrusted_claude_connections() {
  [ "${HME_OMNIROUTE_TRUST_STORED_CREDS:-0}" = "1" ] && return 0
  local _db="$HOME/.omniroute/storage.sqlite"
  [ -f "$_db" ] || return 0
  python3 - <<'PY' "$_db"
import shutil, sqlite3, sys
from pathlib import Path
p = Path(sys.argv[1])
con = sqlite3.connect(p)
rows = con.execute("select id from provider_connections where provider in ('claude','anthropic')").fetchall()
if not rows:
    con.close()
    raise SystemExit(0)
backup = p.with_name(f"{p.name}.pre-claude-prune.bak")
if not backup.exists():
    shutil.copy2(p, backup)
ids = [r[0] for r in rows]
con.executemany("delete from provider_connections where id=?", [(i,) for i in ids])
con.commit()
con.close()
print("[omniroute] pruned untrusted Claude/Anthropic provider connection(s): " + ",".join(ids))
PY
}
_prune_untrusted_claude_connections

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
_provider_connection_exists() {
  local _provider="$1"
  curl -sf -b $_OMNI_SETUP_COOKIE \
    "http://127.0.0.1:${PORT}/api/providers" 2>/dev/null | \
    OMNI_PROVIDER="$_provider" python3 -c 'import json, os, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
wanted = os.environ["OMNI_PROVIDER"]
found = any(isinstance(c, dict) and c.get("provider") == wanted for c in data.get("connections", []))
sys.exit(0 if found else 1)'
}

_provider_node_id_by_prefix() {
  local _prefix="$1" _api_type="${2:-chat}"
  curl -sf -b $_OMNI_SETUP_COOKIE \
    "http://127.0.0.1:${PORT}/api/provider-nodes" 2>/dev/null | \
    OMNI_PREFIX="$_prefix" OMNI_API_TYPE="$_api_type" python3 -c 'import json, os, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for node in data.get("nodes", []):
    if not isinstance(node, dict):
        continue
    if node.get("prefix") == os.environ["OMNI_PREFIX"] and node.get("apiType") == os.environ["OMNI_API_TYPE"]:
        print(node.get("id") or "")
        sys.exit(0)
sys.exit(1)'
}

_ensure_openai_compatible_node() {
  local _prefix="$1" _name="$2" _base_url="$3" _node_id _payload _result
  if _node_id="$(_provider_node_id_by_prefix "$_prefix" chat)" && [ -n "$_node_id" ]; then
    echo "$_node_id"
    return 0
  fi

  _payload=$(OMNI_PREFIX="$_prefix" OMNI_NAME="$_name" OMNI_BASE_URL="$_base_url" python3 - <<'PYJSON'
import json, os
print(json.dumps({
    "type": "openai-compatible",
    "name": os.environ["OMNI_NAME"],
    "prefix": os.environ["OMNI_PREFIX"],
    "apiType": "chat",
    "baseUrl": os.environ["OMNI_BASE_URL"],
}))
PYJSON
)
  _result=$(curl -sf -b $_OMNI_SETUP_COOKIE -X POST \
    "http://127.0.0.1:${PORT}/api/provider-nodes" \
    -H "Content-Type: application/json" \
    -d "$_payload" 2>&1) || true
  _node_id=$(printf '%s' "$_result" | python3 -c 'import json, sys
try:
    print((json.load(sys.stdin).get("node") or {}).get("id") or "")
except Exception:
    print("")')
  if [ -n "$_node_id" ]; then
    echo "[omniroute] ${_prefix} provider node created" >&2
    echo "$_node_id"
    return 0
  fi
  echo "[omniroute] ${_prefix} provider node setup failed: $_result" >&2
  return 1
}

_configure_provider() {
  local _provider="$1" _key="$2" _name="$3" _label="${4:-$1}"
  if [ -z "$_key" ]; then
    echo "[omniroute] ${_label} key not set -- skipping credential setup"
    return 0
  fi

  if _provider_connection_exists "$_provider"; then
    echo "[omniroute] ${_label} already configured"
    return 0
  fi

  echo "[omniroute] adding ${_label} connection..."
  local _payload _result
  _payload=$(OMNI_PROVIDER="$_provider" OMNI_KEY="$_key" OMNI_NAME="$_name" python3 - <<'PYJSON'
import json, os
print(json.dumps({"provider": os.environ["OMNI_PROVIDER"], "apiKey": os.environ["OMNI_KEY"], "name": os.environ["OMNI_NAME"]}))
PYJSON
)
  _result=$(curl -sf -b $_OMNI_SETUP_COOKIE -X POST \
    "http://127.0.0.1:${PORT}/api/providers" \
    -H "Content-Type: application/json" \
    -d "$_payload" 2>&1) || true

  if echo "$_result" | grep -q '"connection"'; then
    echo "[omniroute] ${_label} configured successfully"
  else
    echo "[omniroute] ${_label} setup failed: $_result"
  fi
}

_configure_openai_compatible_provider() {
  local _prefix="$1" _key="$2" _name="$3" _node_name="$4" _base_url="$5" _node_id
  if [ -z "$_key" ]; then
    echo "[omniroute] ${_prefix} key not set -- skipping credential setup"
    return 0
  fi
  _node_id="$(_ensure_openai_compatible_node "$_prefix" "$_node_name" "$_base_url")" || return 0
  _configure_provider "$_node_id" "$_key" "$_name" "$_prefix"
}

if [ "$DO_CONFIGURE" -eq 1 ]; then
  LOGIN=$(curl -sf -c $_OMNI_SETUP_COOKIE -X POST \
    "http://127.0.0.1:${PORT}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"password":"polychron"}' 2>&1) || true

  if ! echo "$LOGIN" | grep -q '"success":true'; then
    echo "[omniroute] login failed: $LOGIN"
    exit 1
  fi

  _configure_provider "opencode-go" "${OPENCODE_API_KEY}" "Polychron HME"
  # Claude routes via OAuth (provider=claude); only seed the apikey-style
  # anthropic provider connection if ANTHROPIC_API_KEY is explicitly set.
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    _configure_provider "anthropic" "${ANTHROPIC_API_KEY}" "Polychron Anthropic"
  fi
  _configure_provider "kilo-gateway" "${KILO_API_KEY}" "Polychron Kilo Gateway"
  _configure_openai_compatible_provider "aihubmix" "${AIHUBMIX_API_KEY}" "Polychron AIHubMix" "AIHubMix Chat" "https://aihubmix.com/v1"
  rm -f $_OMNI_SETUP_COOKIE
fi

# Auto-repair: reset expired opencode-go credentials (OmniRoute's health-check
# sometimes tests with wrong model and marks valid keys as expired).
_repair_opencode_credentials() {
  local _port="$1"
  curl -sf -c $_OMNI_REPAIR_COOKIE -X POST "http://127.0.0.1:${_port}/api/auth/login" \
    -H "Content-Type: application/json" -d '{"password":"polychron"}' >/dev/null || return 0
  curl -sf -b $_OMNI_REPAIR_COOKIE "http://127.0.0.1:${_port}/api/providers" 2>/dev/null | \
    python3 -c "
import sys,json
for c in json.load(sys.stdin).get('connections',[]):
    if c['provider']=='opencode-go' and c.get('testStatus')=='expired':
        print(c['id'])
" | while read _cid; do
    curl -sf -b $_OMNI_REPAIR_COOKIE -X PUT "http://127.0.0.1:${_port}/api/providers/${_cid}" \
      -H "Content-Type: application/json" \
      -d '{"testStatus":"success","isActive":true,"lastError":null,"errorCode":null}' >/dev/null && \
      echo "[omniroute] repaired expired opencode-go credential ${_cid}"
  done
  rm -f $_OMNI_REPAIR_COOKIE
}
_repair_opencode_credentials "$PORT"
