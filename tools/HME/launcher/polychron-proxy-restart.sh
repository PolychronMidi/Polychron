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

PROJECT_ROOT="${PROJECT_ROOT}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
WORKER_PORT="$(_hme_service_port worker 2>/dev/null || printf '%s' "${HME_WORKER_PORT:-9098}")"  # silent-ok: optional fallback path.
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
PROXY_READY_URL="${PROXY_URL}/ready"
PROXY_HEALTH_URL="${PROXY_URL}/health"
PROXY_READY_TIMEOUT="${HME_PROXY_READY_TIMEOUT:-8}"
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-45}"

PID_FILE="$PROJECT_ROOT/log/hme-pids"

_http_code() {
  curl -sS --max-time 1 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000
}

_port_healthy() {
  [ "$(_http_code "$1")" = "200" ]
}

_port_responding() {
  local code
  code="$(_http_code "$1")"
  [ "$code" != "000" ]
}

_port_listener_pids() {
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnp "sport = :${PROXY_PORT}" 2>/dev/null \
    | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
    | sort -u
}

mapfile -t _PROXY_BUNDLE_PATTERNS < <(_hme_bundle_process_patterns proxy 2>/dev/null || true)  # silent-ok: optional fallback path.
if [ "${#_PROXY_BUNDLE_PATTERNS[@]}" -eq 0 ]; then
  _PROXY_BUNDLE_PATTERNS=("hme_proxy.js" "worker.py" "llamacpp_daemon")
fi
mapfile -t _PROXY_BUNDLE_PID_LABELS < <(_hme_bundle_pid_labels proxy 2>/dev/null || true)  # silent-ok: optional fallback path.
if [ "${#_PROXY_BUNDLE_PID_LABELS[@]}" -eq 0 ]; then
  _PROXY_BUNDLE_PID_LABELS=("proxy" "worker" "llamacpp_daemon")
fi

_label_in_proxy_bundle() {
  local q="$1"
  local label
  for label in "${_PROXY_BUNDLE_PID_LABELS[@]}"; do
    [ "$q" = "$label" ] && return 0
  done
  return 1
}

# Prefer PID-targeted SIGTERM via the launcher's PID file when present --
# pkill by pattern can match across user sessions on shared hosts.
declare -a _proxy_pids=()
if [ -f "$PID_FILE" ]; then
  while IFS='=' read -r label pid; do
    _label_in_proxy_bundle "$label" && [ -n "$pid" ] && _proxy_pids+=("$label:$pid")
  done < "$PID_FILE"
fi

for entry in "${_proxy_pids[@]:-}"; do
  label="${entry%%:*}"
  pid="${entry##*:}"
  if kill -0 "$pid" 2>/dev/null; then
# silent-ok: optional fallback path.
    kill -TERM "$pid" 2>/dev/null \
      && echo "[proxy-restart] SIGTERM -> ${label} (${pid})" >&2
  fi
done

for pat in "${_PROXY_BUNDLE_PATTERNS[@]}"; do
# silent-ok: optional fallback path.
  pkill -TERM -f "$pat" 2>/dev/null \
    && echo "[proxy-restart] SIGTERM -> pattern: $pat" >&2 || true
done

# 2. Wait for the proxy bundle PROCESSES to exit -- not just ports.

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
# silent-ok: optional fallback path.
    kill -KILL "$pid" 2>/dev/null \
      && echo "[proxy-restart] SIGKILL -> stuck pid ${pid}" >&2 \
      && _killed_any=1
  fi
done
for pat in "${_PROXY_BUNDLE_PATTERNS[@]}"; do
  if pgrep -f "$pat" >/dev/null 2>&1; then
# silent-ok: optional fallback path.
    pkill -KILL -f "$pat" 2>/dev/null \
      && echo "[proxy-restart] SIGKILL -> pattern: $pat" >&2 \
      && _killed_any=1
  fi
done
if [ "$_killed_any" = "0" ]; then
  echo "[proxy-restart] proxy bundle exited cleanly via SIGTERM after ${_waited}s" >&2
fi

if _port_responding "${PROXY_URL}/health"; then
  echo "[proxy-restart] proxy port :${PROXY_PORT} still responding after bundle kill; terminating listener pid(s)" >&2
  while IFS= read -r _listener_pid; do
    [ -n "$_listener_pid" ] || continue
    kill -TERM "$_listener_pid" 2>/dev/null || true  # silent-ok: optional fallback path.
  done < <(_port_listener_pids)
  sleep 1
  while IFS= read -r _listener_pid; do
    [ -n "$_listener_pid" ] || continue
    kill -KILL "$_listener_pid" 2>/dev/null || true  # silent-ok: optional fallback path.
  done < <(_port_listener_pids)
fi
if _port_responding "${PROXY_URL}/health"; then
  echo "[proxy-restart] ERROR: proxy port :${PROXY_PORT} still responding after listener cleanup -- aborting" >&2
  exit 1
fi

# 4. Reset the emergency-valve trip flag. Same semantics as
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
if [ -f "$PID_FILE" ]; then
  _tmp_pid_file="${PID_FILE}.tmp.$$"
  _drop_re=""
  for label in "${_PROXY_BUNDLE_PID_LABELS[@]}"; do
    _drop_re="${_drop_re}${_drop_re:+|}${label}"
  done
  awk -F= -v re="^(${_drop_re})$" '$1 !~ re { print }' \
    "$PID_FILE" > "$_tmp_pid_file"
  mv "$_tmp_pid_file" "$PID_FILE"
fi

# 6. Spawn proxy with same invocation as polychron-launch.sh's step 1.
echo "[proxy-restart] starting HME proxy on :${PROXY_PORT}..." >&2
cd "$PROJECT_ROOT"
HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
  setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
    >> "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
_PROXY_PID=$!
disown 2>/dev/null || true

# 7. Append the new proxy PID to the PID file so the next full-stack
# shutdown finds it.
_PROXY_LABEL="$(_hme_service_pid_label proxy 2>/dev/null || printf '%s' proxy)"  # silent-ok: optional fallback path.
echo "${_PROXY_LABEL}=${_PROXY_PID}" >> "$PID_FILE"
echo "[proxy-restart] started ${_PROXY_LABEL} (pid ${_PROXY_PID})" >&2

# 8. Listener readiness gate: /ready proves :${PROXY_PORT} is serving the new
# process without waiting for slower required workers. Full /health is still
# observed below, but does not create an avoidable CLI outage during warmup.
_waited=0
while [ "$_waited" -lt "$PROXY_READY_TIMEOUT" ]; do
  _port_healthy "$PROXY_READY_URL" && break
  sleep 1
  _waited=$((_waited + 1))
done

if _port_healthy "$PROXY_READY_URL"; then
  echo "[proxy-restart] proxy listener ready after ${_waited}s" >&2
else
  echo "[proxy-restart] ERROR: proxy listener did not become ready within ${PROXY_READY_TIMEOUT}s" >&2
  echo "[proxy-restart]   tail $PROJECT_ROOT/log/hme-proxy.out for diagnostics" >&2
  exit 1
fi

# 9. Full bundle health gate is bounded and informational. It should usually
# turn green after worker warmup, but reload success is listener-readiness.
_health_waited=0
while [ "$_health_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
  _port_healthy "$PROXY_HEALTH_URL" && break
  sleep 1
  _health_waited=$((_health_waited + 1))
done
if _port_healthy "$PROXY_HEALTH_URL"; then
  echo "[proxy-restart] proxy bundle healthy after ${_health_waited}s" >&2
else
  echo "[proxy-restart] WARN: proxy bundle not fully healthy within ${PROXY_STARTUP_TIMEOUT}s; listener remains ready, supervisor continues warmup" >&2
fi

# 10. Worker comes up async (proxy supervises it). Report status.
# silent-ok: optional fallback path.
_worker_status=$(curl -sf --max-time 3 "${WORKER_URL}/health" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null \
  || echo "starting...")
echo "[proxy-restart]   worker -> ${_worker_status}" >&2
python3 "$PROJECT_ROOT/tools/HME/hooks/helpers/lifesaver_crying_wolf.py" \
  --mode proxy-restart-success --reason proxy-restart-success --quiet >/dev/null 2>&1 || true

echo "[proxy-restart] proxy-only restart complete -- llama-server and VSCode untouched" >&2
