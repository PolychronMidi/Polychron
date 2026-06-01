#!/usr/bin/env bash
# Restart ONLY the HME proxy bundle (hme_proxy.js + supervised worker.py +
# llamacpp_daemon). Leaves llama-server (:8080/:8081) untouched. Default

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

# Cycle the universal-pulse supervisor so it picks up current code. Unlike the
# proxy slots (which auto-heal via the slot-watchdog), the pulse supervisor is a
_cycle_pulse_supervisor() {
  local sv="$PROJECT_ROOT/tools/HME/hooks/direct/universal-pulse-supervisor.sh"
  [ -f "$sv" ] || return 0
  echo "[proxy-restart] cycling universal-pulse supervisor (load current code)" >&2
  # silent-ok: noncritical probe; caller consumes missing/failed result explicitly.
  bash "$sv" stop 2>/dev/null || true
  sleep 1
  nohup bash "$sv" start >> "$PROJECT_ROOT/log/hme-universal-pulse.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
}

# 1-minute restart throttle: rapid-fire restarts (one per file-edit cycle)
# churn the proxy, kill in-flight requests, and waste 30-60s of warmup each
_RESTART_THROTTLE_SEC="${HME_PROXY_RESTART_THROTTLE_SEC:-60}"
_RESTART_SENTINEL="$PROJECT_ROOT/tools/HME/runtime/proxy-last-restart.ts"
_FORCE_RESTART=0
_LEGACY_MODE=0
for _arg in "$@"; do
  case "$_arg" in
    --force|-f) _FORCE_RESTART=1 ;;
    --legacy) _LEGACY_MODE=1 ;;
  esac
done

# Default path: delegate to per-slot active-active restart so users get zero-downtime.
# Each slot has its own 60s throttle; the outer 5-min throttle on this script is the
_SLOT_SCRIPT="$PROJECT_ROOT/tools/HME/launcher/polychron-slot-restart.sh"
if [ "$_LEGACY_MODE" = "0" ] && [ -x "$_SLOT_SCRIPT" ]; then
  _slot_args=""
  [ "$_FORCE_RESTART" = "1" ] && _slot_args="--force"
  echo "[proxy-restart] zero-downtime mode: restarting slot a, then slot b" >&2
  "$_SLOT_SCRIPT" --slot a $_slot_args || { echo "[proxy-restart] slot a restart failed; aborting before slot b" >&2; exit 1; }
  sleep 2
  "$_SLOT_SCRIPT" --slot b $_slot_args || { echo "[proxy-restart] slot b restart failed; slot a is fresh, shuffler will route there" >&2; exit 1; }
  # Converge the SHARED worker too. The slot restarts only cycle the proxy
  # backends; the worker is a separate long-lived process and would otherwise
  _SV="$PROJECT_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
  if [ -f "$_SV" ]; then
    echo "[proxy-restart] converging shared worker (worker-restart)" >&2
    bash "$_SV" worker-restart >> "$PROJECT_ROOT/log/hme-proxy-lifecycle.log" 2>&1 || \
      echo "[proxy-restart] worker-restart returned non-zero; supervisor will retry on drift" >&2
  fi
  _cycle_pulse_supervisor
  echo "[proxy-restart] zero-downtime restart complete (slots + worker + pulse)" >&2
  exit 0
fi

if [ "$_FORCE_RESTART" = "0" ] && [ -s "$_RESTART_SENTINEL" ]; then
  _last_ts="$(cat "$_RESTART_SENTINEL" 2>/dev/null || echo 0)"
  _now_ts="$(date +%s)"
  _age=$(( _now_ts - _last_ts ))
  if [ "$_age" -ge 0 ] && [ "$_age" -lt "$_RESTART_THROTTLE_SEC" ]; then
    _wait=$(( _RESTART_THROTTLE_SEC - _age ))
    echo "[proxy-restart] THROTTLED: last restart ${_age}s ago (< ${_RESTART_THROTTLE_SEC}s); ${_wait}s remaining. Use --force to override." >&2
    exit 0
  fi
fi

source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
WORKER_PORT="$(_hme_service_port worker 2>/dev/null || printf '%s' "${HME_WORKER_PORT:-9098}")"  # silent-ok: optional fallback path.
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
PROXY_READY_URL="${PROXY_URL}/ready"
PROXY_VERSION_URL="${PROXY_URL}/version"
PROXY_HEALTH_URL="${PROXY_URL}/health"
PROXY_READY_TIMEOUT="${HME_PROXY_READY_TIMEOUT:-8}"
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-45}"

PID_FILE="$PROJECT_ROOT/log/hme-pids"
ERROR_LOG="$PROJECT_ROOT/log/hme-errors.log"
_SUPERVISOR_SCRIPT="$PROJECT_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
_ALREADY_RUNNING=false

_http_code() {
  # silent-ok: health probe maps failure to explicit unavailable result.
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

_proxy_listener_ready() {
  _port_healthy "$PROXY_READY_URL" || _port_healthy "$PROXY_VERSION_URL"
}

_port_listener_pids() {
  command -v ss >/dev/null 2>&1 || return 0
  # silent-ok: probe/decoration only; absent result is handled by caller.
  ss -ltnp "sport = :${PROXY_PORT}" 2>/dev/null \
    | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
    | sort -u
}

_bundle_pattern_pids() {
  local pat="$1"
  # silent-ok: probe/decoration only; absent result is handled by caller.
  ps -eo pid=,args= 2>/dev/null | awk -v pat="$pat" -v self="$$" -v ppid="$PPID" '
    $1 == self || $1 == ppid { next }
    $0 ~ /polychron-proxy-restart\.sh/ { next }
    $0 ~ /tools\/HME\/launcher\/polychron-proxy-restart\.sh/ { next }
    $0 ~ /awk -v pat=/ { next }
    index($0, pat) { print $1 }
  ' | sort -u
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

# Stop the external supervisor so it doesn't respawn the proxy while we kill it.
if [ -f "$_SUPERVISOR_SCRIPT" ]; then
  echo "[proxy-restart] stopping proxy supervisor before bundle kill..." >&2
  # silent-ok: noncritical probe; caller consumes missing/failed result explicitly.
  bash "$_SUPERVISOR_SCRIPT" stop 2>/dev/null || true
  sleep 1
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
  while IFS= read -r _pat_pid; do
    [ -n "$_pat_pid" ] || continue
    # silent-ok: process-exit race; later health/pid checks own the verdict.
    kill -TERM "$_pat_pid" 2>/dev/null \
      && echo "[proxy-restart] SIGTERM -> pattern: $pat (${_pat_pid})" >&2 || true
  done < <(_bundle_pattern_pids "$pat")
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
    [ -n "$(_bundle_pattern_pids "$pat")" ] && _alive=1
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
_survivors="$(_port_listener_pids | tr '\n' ' ')"
if [ -n "$_survivors" ]; then
  echo "[proxy-restart] proxy port :${PROXY_PORT} still owned after bundle kill; nuking listener pid(s): $_survivors" >&2
  for _listener_pid in $_survivors; do
    [ -n "$_listener_pid" ] || continue
    # silent-ok: process-exit race; later health/pid checks own the verdict.
    kill -KILL "$_listener_pid" 2>/dev/null || true
  done
fi

_remaining_listener_pids="$(_port_listener_pids | tr '\n' ' ')"
if [ -n "$_remaining_listener_pids" ]; then
  echo "[proxy-restart] WARNING: proxy listener still on :${PROXY_PORT} (pid(s): $_remaining_listener_pids) -- retrying kill loop..." >&2
  _cleanup_retries=0
  while [ "$_cleanup_retries" -lt 5 ] && [ -n "$(_port_listener_pids)" ]; do
    for _listener_pid in $(_port_listener_pids); do
      [ -n "$_listener_pid" ] || continue
      # silent-ok: process-exit race; later health/pid checks own the verdict.
      kill -KILL "$_listener_pid" 2>/dev/null || true
    done
    _cleanup_retries=$((_cleanup_retries + 1))
    sleep 1
  done
  if [ -n "$(_port_listener_pids)" ]; then
    echo "[proxy-restart] WARNING: proxy listener survived cleanup on :${PROXY_PORT} -- checking if healthy..." >&2
    if _proxy_listener_ready; then
      _ADOPTED_PROXY_PID="$(_port_listener_pids | head -1)"
      echo "[proxy-restart] adopted existing healthy proxy (pid=${_ADOPTED_PROXY_PID}); listener remains ready" >&2
      _ALREADY_RUNNING=true
    else
      echo "[proxy-restart] ERROR: surviving proxy is unhealthy; giving up" >&2
      exit 1
    fi
  fi
fi

# 4. Reset the emergency-valve trip flag. Same semantics as
_VALVE_FLAG="$PROJECT_ROOT/tmp/hme-proxy-valve-tripped.flag"  #
if [ -f "$_VALVE_FLAG" ]; then
  rm -f "$_VALVE_FLAG" \
    && echo "[proxy-restart] removed $_VALVE_FLAG (valve state reset)" >&2
fi
_VALVE_STATE="$PROJECT_ROOT/tmp/hme-proxy-valve-state.json"  #
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

# 6. Spawn proxy fresh or adopt a ready survivor.
_PROXY_LABEL="$(_hme_service_pid_label proxy 2>/dev/null || printf '%s' proxy)"  # silent-ok: optional fallback path.
if [ "$_ALREADY_RUNNING" = "true" ]; then
  _ADOPTED_PROXY_PID="${_ADOPTED_PROXY_PID:-$(_port_listener_pids | head -1)}"
  [ -n "$_ADOPTED_PROXY_PID" ] && echo "${_PROXY_LABEL}=${_ADOPTED_PROXY_PID}" >> "$PID_FILE"
  echo "[proxy-restart] adopted existing ${_PROXY_LABEL} (pid ${_ADOPTED_PROXY_PID}); listener remains ready" >&2
else
  echo "[proxy-restart] starting HME proxy on :${PROXY_PORT}..." >&2
  cd "$PROJECT_ROOT"
  HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
      >> "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
  _PROXY_PID=$!
  disown 2>/dev/null || true
  echo "[proxy-restart] started ${_PROXY_LABEL} (pid ${_PROXY_PID})" >&2
  echo "${_PROXY_LABEL}=${_PROXY_PID}" >> "$PID_FILE"
fi

_waited=0
while [ "$_waited" -lt "$PROXY_READY_TIMEOUT" ]; do
  _proxy_listener_ready && break
  sleep 1
  _waited=$((_waited + 1))
done
if ! _proxy_listener_ready; then
  echo "[proxy-restart] ERROR: proxy listener did not become ready within ${PROXY_READY_TIMEOUT}s" >&2
  echo "[proxy-restart]   tail $PROJECT_ROOT/log/hme-proxy.out for diagnostics" >&2
  exit 1
fi
echo "[proxy-restart] proxy listener ready after ${_waited}s" >&2

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

# Restart the supervisor since the proxy is now up.
if [ -f "$_SUPERVISOR_SCRIPT" ]; then
  echo "[proxy-restart] restarting proxy supervisor..." >&2
  nohup bash "$_SUPERVISOR_SCRIPT" start >> "$PROJECT_ROOT/log/hme-proxy-lifecycle.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
fi

# 10. Worker comes up async (proxy supervises it). Report status.
# silent-ok: optional fallback path.
_worker_status=$(curl -sf --max-time 3 "${WORKER_URL}/health" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null \
  || echo "starting...")
echo "[proxy-restart]   worker -> ${_worker_status}" >&2
python3 "$PROJECT_ROOT/tools/HME/hooks/helpers/lifesaver_crying_wolf.py" \
  --mode proxy-restart-success --reason proxy-restart-success --quiet >/dev/null 2>&1 || true

mkdir -p "$(dirname "$_RESTART_SENTINEL")" 2>/dev/null
date +%s > "$_RESTART_SENTINEL"

_cycle_pulse_supervisor
echo "[proxy-restart] proxy-only restart complete -- llama-server untouched" >&2
