#!/usr/bin/env bash
# Restart ONLY the HME proxy bundle (hme_proxy.js + supervised worker.py +
# llamacpp_daemon). Leaves llama-server (:8080/:8081), VSCode, and
# .vscode/settings.json untouched. Use polychron-restart.sh for full reset.

set -u
set -o pipefail

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT_FALLBACK="$(cd "$_LAUNCHER_DIR/../../.." && pwd)"
_ENV_FILE="${_PROJECT_ROOT_FALLBACK}/.env"

if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "[proxy-restart] ERROR: .env not found at $_ENV_FILE" >&2
  exit 1
fi

PROJECT_ROOT="${PROJECT_ROOT:-$_PROJECT_ROOT_FALLBACK}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"
WORKER_PORT="$(_hme_service_port worker 2>/dev/null || printf '%s' "${HME_WORKER_PORT:-9098}")"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-25}"

PID_FILE="$PROJECT_ROOT/log/hme-pids"

_port_healthy() {
  curl -sf --max-time 1 "$1" > /dev/null 2>&1
}

# 1. Stop the proxy bundle. Pattern-target only the bundle: NOT
#    "llama-server" (the model servers) and NOT "code"/electron.
#
# llamacpp_daemon != llama-server -- the daemon is the proxy-side
# supervisor; the llama-server processes on :8080/:8081 are the model
# servers and stay up.

_PROXY_BUNDLE_PATTERNS=(
  "hme_proxy.js"
  "worker.py"
  "llamacpp_daemon"
)

# Prefer PID-targeted SIGTERM via the launcher's PID file when present --
# pkill by pattern can match across user sessions on shared hosts.
declare -a _proxy_pids=()
if [ -f "$PID_FILE" ]; then
  while IFS='=' read -r label pid; do
    case "$label" in
      proxy|worker|llamacpp_daemon)
        [ -n "$pid" ] && _proxy_pids+=("$label:$pid")
        ;;
    esac
  done < "$PID_FILE"
fi

for entry in "${_proxy_pids[@]:-}"; do
  label="${entry%%:*}"
  pid="${entry##*:}"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null \
      && echo "[proxy-restart] SIGTERM -> ${label} (${pid})" >&2
  fi
done

for pat in "${_PROXY_BUNDLE_PATTERNS[@]}"; do
  pkill -TERM -f "$pat" 2>/dev/null \
    && echo "[proxy-restart] SIGTERM -> pattern: $pat" >&2 || true
done

# 2. Wait for the proxy bundle PROCESSES to exit -- not just ports.
#
# Why processes, not ports: the proxy's _gracefulShutdown calls
# server.close() FIRST (port goes unhealthy in <100ms), then drains
# in-flight requests for up to DRAIN_TIMEOUT_MS=3000ms, then SIGTERMs
# children, then setTimeout(process.exit, 500). Polling on port liveness
# breaks the wait loop instantly and SIGKILLs mid-graceful-drain --
# defeating the whole point of having signal handlers.
#
# Grace window: 6s covers the 3000+500ms graceful path with headroom
# for slow drains.

_GRACE_S=6
_waited=0
while [ "$_waited" -lt "$_GRACE_S" ]; do
  _alive=0
  for entry in "${_proxy_pids[@]:-}"; do
    pid="${entry##*:}"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && _alive=1
  done
  for pat in "${_PROXY_BUNDLE_PATTERNS[@]}"; do
    pgrep -f "$pat" >/dev/null 2>&1 && _alive=1
  done
  [ "$_alive" = "0" ] && break
  sleep 1
  _waited=$((_waited + 1))
done

# 3. SIGKILL anything that survived the grace window.
_killed_any=0
for entry in "${_proxy_pids[@]:-}"; do
  pid="${entry##*:}"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null \
      && echo "[proxy-restart] SIGKILL -> stuck pid ${pid}" >&2 \
      && _killed_any=1
  fi
done
for pat in "${_PROXY_BUNDLE_PATTERNS[@]}"; do
  if pgrep -f "$pat" >/dev/null 2>&1; then
    pkill -KILL -f "$pat" 2>/dev/null \
      && echo "[proxy-restart] SIGKILL -> pattern: $pat" >&2 \
      && _killed_any=1
  fi
done
if [ "$_killed_any" = "0" ]; then
  echo "[proxy-restart] proxy bundle exited cleanly via SIGTERM after ${_waited}s" >&2
fi

if _port_healthy "${PROXY_URL}/health"; then
  echo "[proxy-restart] ERROR: proxy port :${PROXY_PORT} still healthy after kill -- aborting" >&2
  exit 1
fi

# 4. Reset the emergency-valve trip flag. Same semantics as
# polychron-shutdown.sh: deliberate restart resets, watchdog respawns
# inherit. This is the difference between "I changed the code, retry
# fresh" and "the supervisor noticed a crash, keep the trip state".
_VALVE_FLAG="$PROJECT_ROOT/tmp/hme-proxy-valve-tripped.flag"
if [ -f "$_VALVE_FLAG" ]; then
  rm -f "$_VALVE_FLAG" \
    && echo "[proxy-restart] removed $_VALVE_FLAG (valve state reset)" >&2
fi
_VALVE_STATE="$PROJECT_ROOT/tmp/hme-proxy-valve-state.json"
if [ -f "$_VALVE_STATE" ]; then
  rm -f "$_VALVE_STATE" \
    && echo "[proxy-restart] removed $_VALVE_STATE (auto-recovery state reset)" >&2
fi

# 5. Surgically rewrite the proxy bundle's lines in the PID file --
# preserve llama-arbiter / llama-coder entries so the full-stack
# shutdown script still finds them later.
if [ -f "$PID_FILE" ]; then
  _tmp_pid_file="${PID_FILE}.tmp.$$"
  awk -F= '$1 != "proxy" && $1 != "worker" && $1 != "llamacpp_daemon" { print }' \
    "$PID_FILE" > "$_tmp_pid_file"
  mv "$_tmp_pid_file" "$PID_FILE"
fi

# 6. Spawn proxy with same invocation as polychron-launch.sh's step 1.
# setsid + nohup + disown so the proxy survives the caller's shell exit
# (matches launcher behavior). Stdout/stderr append to the same log so
# the launch history stays in one file.
echo "[proxy-restart] starting HME proxy on :${PROXY_PORT}..." >&2
cd "$PROJECT_ROOT"
HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
  setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
    >> "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
_PROXY_PID=$!
disown 2>/dev/null || true

# 7. Append the new proxy PID to the PID file so the next full-stack
# shutdown finds it.
echo "proxy=${_PROXY_PID}" >> "$PID_FILE"
echo "[proxy-restart] started proxy (pid ${_PROXY_PID})" >&2

# 8. Health-gate. Same timeout the launcher uses.
_waited=0
while [ "$_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
  _port_healthy "${PROXY_URL}/health" && break
  sleep 1
  _waited=$((_waited + 1))
done

if _port_healthy "${PROXY_URL}/health"; then
  echo "[proxy-restart] proxy ready after ${_waited}s" >&2
else
  echo "[proxy-restart] ERROR: proxy did not become healthy within ${PROXY_STARTUP_TIMEOUT}s" >&2
  echo "[proxy-restart]   tail $PROJECT_ROOT/log/hme-proxy.out for diagnostics" >&2
  exit 1
fi

# 9. Worker comes up async (proxy supervises it). Report status as
# informational, not gating -- a slow worker shouldn't fail the restart.
_worker_status=$(curl -sf --max-time 3 "${WORKER_URL}/health" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null \
  || echo "starting...")
echo "[proxy-restart]   worker -> ${_worker_status}" >&2

echo "[proxy-restart] proxy-only restart complete -- llama-server and VSCode untouched" >&2
