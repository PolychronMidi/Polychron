#!/usr/bin/env bash
# Per-slot proxy restart for the active-active backend (proxy_a / proxy_b).
# Shuffler on HME_PROXY_PORT keeps serving traffic; the inactive slot is

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
  echo "[slot-restart] ERROR: .env not found at $_ENV_FILE" >&2
  exit 1
fi

SLOT=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --slot=a|--slot=A) SLOT=a ;;
    --slot=b|--slot=B) SLOT=b ;;
    --slot) ;;  # value handled in next iteration via shift-style parsing below
    a|A) [ -z "$SLOT" ] && SLOT=a ;;
    b|B) [ -z "$SLOT" ] && SLOT=b ;;
    --force|-f) FORCE=1 ;;
  esac
done

if [ -z "$SLOT" ]; then
  echo "[slot-restart] usage: $0 --slot a|b [--force]" >&2
  exit 2
fi

PROJECT_ROOT="${PROJECT_ROOT:?PROJECT_ROOT not set in .env}"
RUNTIME_DIR="$PROJECT_ROOT/tools/HME/runtime"
HEALTH_FILE="$RUNTIME_DIR/proxy-$SLOT.health"
DRAIN_FLAG="$RUNTIME_DIR/proxy-$SLOT.drain.flag"
RESTART_SENTINEL="$RUNTIME_DIR/proxy-restart-$SLOT.ts"
LOG_FILE="$PROJECT_ROOT/log/hme-proxy-$SLOT.out"
PROXY_SCRIPT="$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js"
LAST_VIABLE_FILE="$RUNTIME_DIR/proxy-last-viable.sha"
RESTART_FAILURE_FILE="$RUNTIME_DIR/proxy-restart-$SLOT.fail"

_THROTTLE_SEC="${HME_PROXY_BACKEND_RESTART_THROTTLE_SEC:?HME_PROXY_BACKEND_RESTART_THROTTLE_SEC not set in .env}"
_DRAIN_TIMEOUT_SEC="${HME_PROXY_DRAIN_TIMEOUT_SEC:?HME_PROXY_DRAIN_TIMEOUT_SEC not set in .env}"
_HEARTBEAT_STALE_MS="${HME_PROXY_HEARTBEAT_STALE_MS:?HME_PROXY_HEARTBEAT_STALE_MS not set in .env}"
_BACKEND_PORT_VAR="HME_PROXY_BACKEND_$(echo "$SLOT" | tr a-z A-Z)_PORT"
_BACKEND_PORT="${!_BACKEND_PORT_VAR:?$_BACKEND_PORT_VAR not set in .env}"

if [ "$FORCE" = "0" ] && [ -s "$RESTART_SENTINEL" ]; then
  _last_ts="$(cat "$RESTART_SENTINEL" 2>/dev/null || echo 0)"
  _now_ts="$(date +%s)"
  _age=$(( _now_ts - _last_ts ))
  if [ "$_age" -ge 0 ] && [ "$_age" -lt "$_THROTTLE_SEC" ]; then
    _wait=$(( _THROTTLE_SEC - _age ))
    echo "[slot-restart:$SLOT] THROTTLED: last restart ${_age}s ago (< ${_THROTTLE_SEC}s); ${_wait}s remaining. Use --force to override." >&2
    exit 0
  fi
fi

mkdir -p "$RUNTIME_DIR" "$PROJECT_ROOT/log"

_record_failure() {
  _reason="$1"
  _head="$(git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
  printf '[%s] slot=%s head=%s reason=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SLOT" "$_head" "$_reason" > "$RESTART_FAILURE_FILE"
}

_pick_probe_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
}

_wait_ready_file() {
  _file="$1"
  _pid="$2"
  _timeout="$3"
  _t0="$(date +%s)"
  while :; do
    if [ -s "$_file" ]; then
      _ready="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('1' if d.get('ready') else '')" "$_file" 2>/dev/null || echo "")"
      if [ "$_ready" = "1" ]; then
        return 0
      fi
    fi
    if ! kill -0 "$_pid" 2>/dev/null; then
      return 2
    fi
    if [ $(( $(date +%s) - _t0 )) -ge "$_timeout" ]; then
      return 3
    fi
    sleep 1
  done
}

_preflight_candidate() {
  if [ "${HME_PROXY_PRESTART_PROBE:-1}" = "0" ]; then
    echo "[slot-restart:$SLOT] prestart probe disabled" >&2
    return 0
  fi
  _probe_port="$(_pick_probe_port)"
  _probe_health="$RUNTIME_DIR/proxy-$SLOT.preflight.$$.health"
  _probe_drain="$RUNTIME_DIR/proxy-$SLOT.preflight.$$.drain.flag"
  _probe_log="$PROJECT_ROOT/log/hme-proxy-$SLOT.preflight.out"
  rm -f "$_probe_health" "$_probe_drain" 2>/dev/null || true
  echo "[slot-restart:$SLOT] preflight current build on :$_probe_port before draining incumbent" >&2
  env HME_PROXY_SLOT="$SLOT" \
      HME_PROXY_BACKEND_PORT_OVERRIDE="$_probe_port" \
      HME_PROXY_HEALTH_FILE_OVERRIDE="$_probe_health" \
      HME_PROXY_DRAIN_FLAG_OVERRIDE="$_probe_drain" \
      HME_PROXY_SUPERVISE=0 \
      HME_PROXY_QUIET_IMPORT=1 \
      node "$PROXY_SCRIPT" >> "$_probe_log" 2>&1 < /dev/null &
  _probe_pid=$!
  _wait_ready_file "$_probe_health" "$_probe_pid" 20
  _rc=$?
  if [ "$_rc" = "0" ]; then
    echo "[slot-restart:$SLOT] preflight ready; preserving last viable fallback while replacing incumbent" >&2
    kill -TERM "$_probe_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$_probe_pid" 2>/dev/null || true
    rm -f "$_probe_health" "$_probe_drain" 2>/dev/null || true
    return 0
  fi
  _reason="preflight_failed rc=$_rc port=$_probe_port log=$_probe_log"
  echo "[slot-restart:$SLOT] ABORT: $_reason; incumbent slot left running" >&2
  _record_failure "$_reason"
  kill -TERM "$_probe_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$_probe_pid" 2>/dev/null || true
  rm -f "$_probe_health" "$_probe_drain" 2>/dev/null || true
  return 1
}

_preflight_candidate || exit 1

# Step 1: write drain flag only after the replacement build proves it can boot.
echo "[slot-restart:$SLOT] writing drain flag $DRAIN_FLAG" >&2
touch "$DRAIN_FLAG"

# Step 2: poll heartbeat for in_flight==0 OR pid gone OR drain timeout.
_t0="$(date +%s)"
_pid=""
while :; do
  if [ -s "$HEALTH_FILE" ]; then
    _pid="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('pid') or '')" "$HEALTH_FILE" 2>/dev/null || echo "")"
    _in_flight="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('in_flight') or 0)" "$HEALTH_FILE" 2>/dev/null || echo 0)"
  else
    _in_flight=0
  fi
  if [ -z "$_pid" ] || ! kill -0 "$_pid" 2>/dev/null; then
    echo "[slot-restart:$SLOT] backend exited cleanly" >&2
    break
  fi
  if [ "${_in_flight:-0}" = "0" ] && [ "${_term_sent:-0}" = "0" ]; then
    echo "[slot-restart:$SLOT] in_flight=0 but pid $_pid still alive; sending SIGTERM (single shot)" >&2
    kill -TERM "$_pid" 2>/dev/null || true
    _term_sent=1
  fi
  _now="$(date +%s)"
  if [ $(( _now - _t0 )) -ge "$_DRAIN_TIMEOUT_SEC" ]; then
    echo "[slot-restart:$SLOT] drain timeout after ${_DRAIN_TIMEOUT_SEC}s; SIGKILL pid $_pid" >&2
    [ -n "$_pid" ] && kill -KILL "$_pid" 2>/dev/null || true
    break
  fi
  sleep 1
done

# Cleanup stale files so a fresh backend doesn't inherit them.
rm -f "$DRAIN_FLAG" "$HEALTH_FILE" 2>/dev/null

# Step 3: spawn fresh slot instance.
echo "[slot-restart:$SLOT] spawning new backend on :$_BACKEND_PORT" >&2
nohup env HME_PROXY_SLOT="$SLOT" HME_PROXY_SUPERVISE=0 node "$PROXY_SCRIPT" >> "$LOG_FILE" 2>&1 < /dev/null &
_new_pid=$!
disown 2>/dev/null || true
echo "[slot-restart:$SLOT] new pid=$_new_pid" >&2

# Step 4: wait for heartbeat with ready=true.
_t0="$(date +%s)"
while :; do
  if [ -s "$HEALTH_FILE" ]; then
    _ready="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('1' if d.get('ready') else '')" "$HEALTH_FILE" 2>/dev/null || echo "")"
    if [ "$_ready" = "1" ]; then
      echo "[slot-restart:$SLOT] backend ready after $(( $(date +%s) - _t0 ))s" >&2
      break
    fi
  fi
  if ! kill -0 "$_new_pid" 2>/dev/null; then
    _reason="spawned pid $_new_pid died before ready; tail $LOG_FILE"
    echo "[slot-restart:$SLOT] ERROR: $_reason" >&2
    _record_failure "$_reason"
    exit 1
  fi
  if [ $(( $(date +%s) - _t0 )) -ge 30 ]; then
    _reason="backend not ready within 30s; tail $LOG_FILE"
    echo "[slot-restart:$SLOT] ERROR: $_reason" >&2
    _record_failure "$_reason"
    exit 1
  fi
  sleep 1
done

# Step 5: bump throttle sentinel on success.
date +%s > "$RESTART_SENTINEL"
git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD > "$LAST_VIABLE_FILE" 2>/dev/null || true
rm -f "$RESTART_FAILURE_FILE" 2>/dev/null || true
echo "[slot-restart:$SLOT] complete" >&2
