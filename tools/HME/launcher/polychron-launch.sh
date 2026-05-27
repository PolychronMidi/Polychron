#!/usr/bin/env bash
# Polychron launcher -- starts the full HME stack (no VS Code).
#
# Start order:
#   1. HME proxy (supervises worker.py + llamacpp_daemon/ package automatically)
#   2. llama-server instances (arbiter :8080, coder :8081) -- if HME_AUTOLAUNCH_LLAMA=1
#   3. Health check -- waits for proxy to be ready
#
# Idempotent: each component is skipped if already running on its port.
# PID file: log/hme-pids  -- records PIDs started by this launcher for
# polychron-shutdown.sh to target precisely.

set -u
set -o pipefail
# Not using `set -e`: per-component startup is intentionally resilient
_orphan_pids=""
_track_orphan() { _orphan_pids="$_orphan_pids $1"; }
_kill_orphans_on_abort() {
  if [ -n "${_LAUNCH_OK:-}" ]; then return 0; fi
  for _p in $_orphan_pids; do
    if [ -n "$_p" ] && kill -0 "$_p" 2>/dev/null; then
      kill "$_p" 2>/dev/null || true  # silent-ok: optional fallback path.
    fi
  done
}
trap _kill_orphans_on_abort EXIT

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT_FALLBACK="$(cd "$_LAUNCHER_DIR/../../.." && pwd)"
_ENV_FILE="${_PROJECT_ROOT_FALLBACK}/.env"

if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
  # ANTHROPIC_BASE_URL is now exported in THIS launcher's process tree
else
  echo "[launch] WARNING: .env not found at $_ENV_FILE -- using defaults" >&2
fi

PROJECT_ROOT="${PROJECT_ROOT}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_PID_LABEL="$(_hme_service_pid_label proxy 2>/dev/null || printf '%s' proxy)"  # silent-ok: optional fallback path.
OMNIROUTE_PID_LABEL="$(_hme_service_pid_label omniroute 2>/dev/null || printf '%s' omniroute)"  # silent-ok: optional fallback path.
CODEX_PROXY_PID_LABEL="$(_hme_service_pid_label codex_proxy 2>/dev/null || printf '%s' codex_proxy)"  # silent-ok: optional fallback path.
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-25}"

PID_FILE="$PROJECT_ROOT/log/hme-pids"
mkdir -p "$PROJECT_ROOT/log"
# Start with a fresh PID file each launch
> "$PID_FILE"

_record_pid() {
  local label="$1" pid="$2"
  echo "${label}=${pid}" >> "$PID_FILE"
  echo "[launch] started ${label} (pid ${pid})" >&2
}

_port_healthy() {
  curl -sf --max-time 1 "$1" > /dev/null 2>&1
}

_http_status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 1 "$1" 2>/dev/null || printf '000'
}

_node_script_running() {
  local script="$1"
  python3 - "$script" <<'PY'
import os, sys
needle = os.path.realpath(sys.argv[1])
for pid in filter(str.isdigit, os.listdir('/proc')):
    try:
        raw = open(f'/proc/{pid}/cmdline', 'rb').read().split(b'\0')
    except Exception:
        continue
    if len(raw) < 2:
        continue
    args = [x.decode('utf-8', 'ignore') for x in raw if x]
    if not args or os.path.basename(args[0]) != 'node':
        continue
    for arg in args[1:]:
        if os.path.realpath(arg) == needle:
            sys.exit(0)
sys.exit(1)
PY
}

# 0. OmniRoute (OVERDRIVE_MODE=1 translator)
_OMNIROUTE_PORT="$(_hme_service_port omniroute 2>/dev/null || printf '%s' "${HME_OMNIROUTE_PORT}")"  # silent-ok: optional fallback path.
_OMNIROUTE_URL="http://127.0.0.1:${_OMNIROUTE_PORT}"
_OD_START="${OVERDRIVE_MODE}"
if [ "$_OD_START" = "1" ]; then
  if [ "${HME_OMNIROUTE_OFF:-0}" != "1" ]; then
  _OR_DIR="$PROJECT_ROOT/tools/omniroute"
  if [ -x "$_OR_DIR/start.sh" ]; then
    if _port_healthy "${_OMNIROUTE_URL}/v1/models"; then
      echo "[launch] OmniRoute already up on :${_OMNIROUTE_PORT}" >&2
    else
      echo "[launch] starting OmniRoute on :${_OMNIROUTE_PORT} (OVERDRIVE_MODE=1 translator)..." >&2
      HME_OMNIROUTE_PORT="$_OMNIROUTE_PORT" \
        bash "$_OR_DIR/start.sh" --configure > "$PROJECT_ROOT/log/omniroute.out" 2>&1 &
      _ORPID=$!
      disown 2>/dev/null || true
      _record_pid "$OMNIROUTE_PID_LABEL" "$_ORPID"
      _owaited=0
      while [ "$_owaited" -lt 30 ]; do
        _port_healthy "${_OMNIROUTE_URL}/v1/models" && break
        sleep 1
        _owaited=$((_owaited + 1))
      done
      if _port_healthy "${_OMNIROUTE_URL}/v1/models"; then
        echo "[launch] OmniRoute ready after ${_owaited}s" >&2
      else
        echo "[launch] WARNING: OmniRoute startup timed out -- proxy may fall back to HME_OMNIROUTE_OFF=1" >&2
      fi
    fi
  else
    echo "[launch] WARNING: OmniRoute launcher not found at $_OR_DIR/start.sh -- OVERDRIVE_MODE=1 will fail" >&2
  fi
  fi
fi

# 0b. Codex proxy (optional OpenAI Responses bridge)
_CODEX_PROXY_SUPERVISOR="$PROJECT_ROOT/tools/HME/hooks/direct/codex-proxy-supervisor.sh"
if [ "${HME_CODEX_PROXY_START:-1}" != "0" ] && [ -x "$_CODEX_PROXY_SUPERVISOR" ]; then
  PROJECT_ROOT="$PROJECT_ROOT" "$_CODEX_PROXY_SUPERVISOR" start >/dev/null 2>&1 || \
    echo "[launch] WARNING: codex proxy supervisor start failed" >&2
  _CODEX_PROXY_PID=$(cat "$PROJECT_ROOT/tools/HME/runtime/codex-proxy.pid" 2>/dev/null || true)
  if [ -n "$_CODEX_PROXY_PID" ]; then
    _record_pid "$CODEX_PROXY_PID_LABEL" "$_CODEX_PROXY_PID"
  fi
fi

# 1. HME proxy

_BACKEND_A_PORT="${HME_PROXY_BACKEND_A_PORT:?HME_PROXY_BACKEND_A_PORT not set in .env}"
_BACKEND_B_PORT="${HME_PROXY_BACKEND_B_PORT:?HME_PROXY_BACKEND_B_PORT not set in .env}"

_spawn_proxy_slot() {
  local _slot="$1" _port="$2"
  local _url="http://127.0.0.1:${_port}"
  if _port_healthy "${_url}/health"; then
    echo "[launch] proxy slot ${_slot} already up on :${_port}" >&2
    return 0
  fi
  local _status
  _status="$(_http_status "${_url}/health")"
  if [ "$_status" != "000" ]; then
    echo "[launch] proxy slot ${_slot} responds ${_status}; restarting instead of duplicate-spawning on :${_port}" >&2
    PROJECT_ROOT="$PROJECT_ROOT" bash "$PROJECT_ROOT/tools/HME/launcher/polychron-slot-restart.sh" --slot "$_slot" --force || return 1
    return 0
  fi
  echo "[launch] starting proxy slot ${_slot} on :${_port}..." >&2
  HME_PROXY_SLOT="$_slot" HME_PROXY_SUPERVISE=0 PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
      >> "$PROJECT_ROOT/log/hme-proxy-${_slot}.out" 2>&1 < /dev/null &
  local _pid=$!
  disown 2>/dev/null || true
  _record_pid "proxy_${_slot}" "$_pid"
  local _waited=0
  while [ "$_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
    _port_healthy "${_url}/health" && break
    sleep 1
    _waited=$((_waited + 1))
  done
  if _port_healthy "${_url}/health"; then
    echo "[launch] proxy slot ${_slot} ready after ${_waited}s" >&2
  else
    echo "[launch] ERROR: proxy slot ${_slot} did not become healthy within ${PROXY_STARTUP_TIMEOUT}s" >&2
    return 1
  fi
}

cd "$PROJECT_ROOT"

# Spawn both backend slots first; they bind 9100/9101 and write heartbeat files.
_spawn_proxy_slot a "$_BACKEND_A_PORT" || exit 1
_spawn_proxy_slot b "$_BACKEND_B_PORT" || exit 1

# Spawn the shuffler on the public HME_PROXY_PORT (clients still connect here).
if _port_healthy "${PROXY_URL}/health"; then
  echo "[launch] shuffler already up on :${PROXY_PORT}" >&2
else
  echo "[launch] starting shuffler on :${PROXY_PORT}..." >&2
  PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/shuffler/shuffler.js" \
      >> "$PROJECT_ROOT/log/hme-shuffler.out" 2>&1 < /dev/null &
  _SHUFFLER_PID=$!
  disown 2>/dev/null || true
  _record_pid "shuffler" "$_SHUFFLER_PID"
  _waited=0
  while [ "$_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
    _port_healthy "${PROXY_URL}/health" && break
    sleep 1
    _waited=$((_waited + 1))
  done
  if _port_healthy "${PROXY_URL}/health"; then
    echo "[launch] shuffler ready after ${_waited}s" >&2
  else
    echo "[launch] ERROR: shuffler did not become healthy within ${PROXY_STARTUP_TIMEOUT}s -- aborting" >&2
    exit 1
  fi
fi

# Worker.py: shared across both slots (slots run with HME_PROXY_SUPERVISE=0).
# Spawn directly here so a single worker serves both backends on :9098.
_WORKER_PORT="${HME_WORKER_PORT:-9098}"
_WORKER_URL="http://127.0.0.1:${_WORKER_PORT}"
if _port_healthy "${_WORKER_URL}/health"; then
  echo "[launch] worker already up on :${_WORKER_PORT}" >&2
else
  echo "[launch] starting worker.py on :${_WORKER_PORT}..." >&2
  PROJECT_ROOT="$PROJECT_ROOT" HME_WORKER_PORT="$_WORKER_PORT" \
    setsid nohup python3 "$PROJECT_ROOT/tools/HME/service/worker.py" --port "$_WORKER_PORT" \
      >> "$PROJECT_ROOT/log/hme-worker.out" 2>&1 < /dev/null &
  _WORKER_PID=$!
  disown 2>/dev/null || true
  _record_pid "worker" "$_WORKER_PID"
fi

# File-watcher: auto-restart slots (alternating) on tools/HME/proxy/** changes.
# Debounce 5s; per-slot throttle (60s) enforced by polychron-slot-restart.sh.
_FILE_WATCHER="$PROJECT_ROOT/tools/HME/proxy/shuffler/file_watcher.js"
if [ "${HME_PROXY_FILE_WATCHER:-1}" != "0" ] && [ -x "$_FILE_WATCHER" ]; then
  if _node_script_running "$_FILE_WATCHER"; then
    echo "[launch] file_watcher already running" >&2
  else
    echo "[launch] starting proxy file_watcher (auto-restart on code changes)..." >&2
    PROJECT_ROOT="$PROJECT_ROOT" \
      setsid nohup node "$_FILE_WATCHER" \
        >> "$PROJECT_ROOT/log/hme-file-watcher.out" 2>&1 < /dev/null &
    _FW_PID=$!
    disown 2>/dev/null || true
    _record_pid "file_watcher" "$_FW_PID"
  fi
fi

# Slot watchdog: respawns a slot whose heartbeat goes stale + pid is dead.
# Pairs with the file_watcher (planned drain) and slot_lifecycle (heartbeat writer)
_SLOT_WATCHDOG="$PROJECT_ROOT/tools/HME/proxy/shuffler/slot_watchdog.js"
if [ "${HME_PROXY_SLOT_WATCHDOG:-1}" != "0" ] && [ -x "$_SLOT_WATCHDOG" ]; then
  if _node_script_running "$_SLOT_WATCHDOG"; then
    echo "[launch] slot_watchdog already running" >&2
  else
    echo "[launch] starting slot_watchdog (auto-respawn dead backends)..." >&2
    PROJECT_ROOT="$PROJECT_ROOT" \
      setsid nohup node "$_SLOT_WATCHDOG" \
        >> "$PROJECT_ROOT/log/hme-slot-watchdog.out" 2>&1 < /dev/null &
    _WD_PID=$!
    disown 2>/dev/null || true
    _record_pid "slot_watchdog" "$_WD_PID"
  fi
fi

# 2. llama-server instances

_llama_healthy() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q '"status":"ok"'  # silent-ok: optional fallback path.
}

_start_llama() {
  local name="$1" port="$2" model="$3" device="$4" alias="$5" ctx="$6"
  if _llama_healthy "$port"; then
    echo "[launch] llama-server ${name} already up on :${port}" >&2
    return 0
  fi
  if [ ! -f "$model" ]; then
    echo "[launch] WARN: llama-server ${name} model not found: $model -- skipping" >&2
    return 1
  fi
  local log="$PROJECT_ROOT/log/llama-server-${name}.log"
  setsid nohup "$HME_LLAMA_SERVER_BIN" \
    --model "$model" --host 127.0.0.1 --port "$port" \
    --ctx-size "$ctx" --n-gpu-layers 999 --device "$device" \
    --alias "$alias" --timeout 30 --jinja \
    >> "$log" 2>&1 < /dev/null &
  local _pid=$!
  disown 2>/dev/null || true
  _record_pid "llama-${name}" "$_pid"
}

if [ "${HME_AUTOLAUNCH_LLAMA}" = "1" ] && [ -x "${HME_LLAMA_SERVER_BIN}" ]; then
  _start_llama arbiter \
    "${HME_ARBITER_PORT:?HME_ARBITER_PORT not in .env}" \
    "${HME_ARBITER:?HME_ARBITER not in .env}" \
    "${HME_ARBITER_VULKAN:?HME_ARBITER_VULKAN not in .env}" \
    "${HME_ARBITER_MODEL:?HME_ARBITER_MODEL not in .env}" \
    "${HME_ARBITER_CTX:?HME_ARBITER_CTX not in .env}"
  _start_llama coder \
    "${HME_CODER_PORT:?HME_CODER_PORT not in .env}" \
    "${HME_CODER:?HME_CODER not in .env}" \
    "${HME_CODER_VULKAN:?HME_CODER_VULKAN not in .env}" \
    "${HME_CODER_ALIAS:?HME_CODER_ALIAS not in .env}" \
    "${HME_CODER_CTX:?HME_CODER_CTX not in .env}"
fi

# 3. Initial health check

echo "[launch] health check..." >&2
_proxy_status=$(curl -sf --max-time 3 "${PROXY_URL}/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable")  # silent-ok: optional fallback path.
echo "[launch]   proxy  -> ${_proxy_status}" >&2

_worker_url="$(_hme_service_url worker 2>/dev/null || printf 'http://127.0.0.1:%s/health' "${HME_WORKER_PORT:-9098}")"  # silent-ok: optional fallback path.
_worker_status=$(curl -sf --max-time 3 "$_worker_url" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null || echo "starting...")  # silent-ok: optional fallback path.
echo "[launch]   worker -> ${_worker_status}" >&2

if [ "${HME_AUTOLAUNCH_LLAMA}" = "1" ]; then
  _arb_ok=$(_llama_healthy "${HME_ARBITER_PORT}" && echo "ok" || echo "starting...")
  _cod_ok=$(_llama_healthy "${HME_CODER_PORT}" && echo "ok" || echo "starting...")
  echo "[launch]   arbiter llama -> ${_arb_ok}" >&2
  echo "[launch]   coder llama   -> ${_cod_ok}" >&2
fi

# 4. Routing readiness check

if [ "${HME_ROUTING_READY_ON_LAUNCH:-1}" != "0" ] && [ -x "$PROJECT_ROOT/tools/HME/scripts/routing_ready.py" ]; then
  echo "[launch] routing-ready check..." >&2
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/tools/HME/scripts/routing_ready.py" 2>&1 | sed 's/^/[launch]   /' >&2
fi

# 5. Proxy-bypass guard: any claude CLI in the process tree that lacks
#    ANTHROPIC_BASE_URL bypasses HME middleware. Warn (and optionally bail)
#    so the operator knows to relaunch claude from a shell with .env sourced.
if [ -n "${ANTHROPIC_BASE_URL}" ]; then
  _bypass_pids=""
  for _pid in $(pgrep -f "anthropic.claude-code.*native-binary/claude" 2>/dev/null); do  # silent-ok: optional fallback path.
    if ! tr '\0' '\n' < "/proc/$_pid/environ" 2>/dev/null | \
         grep -q "^ANTHROPIC_BASE_URL="; then
      _bypass_pids="$_bypass_pids $_pid"
    fi
  done
  if [ -n "$_bypass_pids" ]; then
    echo "[launch] PROXY BYPASS DETECTED:" >&2
    echo "[launch]   claude binary PIDs:$_bypass_pids running WITHOUT ANTHROPIC_BASE_URL" >&2
    echo "[launch]   /v1/messages traffic goes DIRECT to api.anthropic.com -- HME middleware bypassed." >&2
    echo "[launch] Manual fix:" >&2
    echo "[launch]   1. Stop the bypassing claude CLI session(s)." >&2
    echo "[launch]   2. Relaunch from a shell with .env sourced:" >&2
    echo "[launch]        set -a; source .env; set +a; claude" >&2
    if [ "${HME_ALLOW_PROXY_BYPASS:-0}" != "1" ]; then
      exit 1
    fi
    echo "[launch] HME_ALLOW_PROXY_BYPASS=1 -- continuing despite bypass" >&2
  fi
fi

echo "[launch] stack up -- PIDs logged to ${PID_FILE}" >&2

# Mark success so the EXIT trap leaves the stack alone.
_LAUNCH_OK=1
