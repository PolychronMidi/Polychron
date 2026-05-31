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

_current_runtime_fingerprint() {
  PROJECT_ROOT="$PROJECT_ROOT" node - <<'NODE'
const { computeRuntimeFingerprint } = require('./tools/HME/proxy/proxy_runtime_fingerprint');
process.stdout.write(computeRuntimeFingerprint(process.env.PROJECT_ROOT));
NODE
}

_RUNTIME_FP="$(_current_runtime_fingerprint 2>/dev/null || printf unknown)"
_mark_slot_starting() {
  PROJECT_ROOT="$PROJECT_ROOT" SLOT="$SLOT" RUNTIME_FP="$_RUNTIME_FP" node - <<'NODE' 2>/dev/null || true
const { markSlotStarting } = require('./tools/HME/proxy/proxy_slot_lifecycle');
markSlotStarting(process.env.PROJECT_ROOT + '/tools/HME/runtime', process.env.SLOT, process.env.RUNTIME_FP, { source: 'slot-restart' });
NODE
}

_mark_slot_viable() {
  PROJECT_ROOT="$PROJECT_ROOT" SLOT="$SLOT" RUNTIME_FP="$_RUNTIME_FP" node - <<'NODE' 2>/dev/null || true
const { markSlotViable } = require('./tools/HME/proxy/proxy_slot_lifecycle');
markSlotViable(process.env.PROJECT_ROOT + '/tools/HME/runtime', process.env.SLOT, process.env.RUNTIME_FP, { source: 'slot-restart' });
NODE
}

_mark_slot_broken() {
  _reason="$1"
  PROJECT_ROOT="$PROJECT_ROOT" SLOT="$SLOT" RUNTIME_FP="$_RUNTIME_FP" REASON="$_reason" node - <<'NODE' 2>/dev/null || true
const { markSlotBroken } = require('./tools/HME/proxy/proxy_slot_lifecycle');
markSlotBroken(process.env.PROJECT_ROOT + '/tools/HME/runtime', process.env.SLOT, process.env.RUNTIME_FP, process.env.REASON, { source: 'slot-restart' });
NODE
}

_can_admit_runtime() {
  PROJECT_ROOT="$PROJECT_ROOT" RUNTIME_FP="$_RUNTIME_FP" node - <<'NODE'
const { canAdmitFingerprint } = require('./tools/HME/proxy/proxy_slot_lifecycle');
const verdict = canAdmitFingerprint(process.env.PROJECT_ROOT + '/tools/HME/runtime', process.env.RUNTIME_FP, { maxSlots: 1 });
if (!verdict.ok) {
  console.error(verdict.reason);
  process.exit(1);
}
NODE
}

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

# Functional smoke: a `ready` health file only proves the build BOOTED and bound
# the port -- it does NOT prove the request path runs. A code fault that survives
# `node --check` and module load (e.g. an undefined symbol referenced inside the
_smoke_candidate() {
  _smoke_port="$1"
  python3 - "$_smoke_port" <<'PY'
import json, sys, urllib.request, urllib.error
port = sys.argv[1]
big = 'word ' * 700000  # ~3.5MB -> ~1.35M tokens, over claude-opus-4-8's 872k budget
body = json.dumps({'model': 'claude-opus-4-8', 'max_tokens': 16,
                   'messages': [{'role': 'user', 'content': big}]}).encode()
req = urllib.request.Request('http://127.0.0.1:%s/v1/messages' % port, data=body,
    headers={'content-type': 'application/json',
             'authorization': 'Bearer hme-preflight',
             'anthropic-version': '2023-06-01',
             'x-hme-preflight-smoke': '1'}, method='POST')
try:
    r = urllib.request.urlopen(req, timeout=15)
    print('smoke status %s' % r.status); sys.exit(0)
except urllib.error.HTTPError as e:
    print('smoke status %s' % e.code); sys.exit(0)  # ANY HTTP response == handler ran end-to-end
except Exception as e:
    print('smoke NO-RESPONSE: %s' % e, file=sys.stderr); sys.exit(1)
PY
}

_OTHER_SLOT="a"
[ "$SLOT" = "a" ] && _OTHER_SLOT="b"
_OTHER_HEALTH="$RUNTIME_DIR/proxy-$_OTHER_SLOT.health"

# True (exit 0) iff the slot whose health file is $1 is live + routable right
# now: heartbeat fresh, ready, not draining, and its pid is alive.
_slot_routable() {
  python3 - "$1" "$_HEARTBEAT_STALE_MS" <<'PY'
import json, os, sys, time
health_file, stale_ms = sys.argv[1], int(sys.argv[2])
try:
    h = json.load(open(health_file))
    pid = int(h.get('pid') or 0)
    ok = bool(h.get('ready')) and not bool(h.get('draining')) and (time.time() * 1000 - float(h.get('ts') or 0)) <= stale_ms
    if ok and pid > 0:
        os.kill(pid, 0)
        sys.exit(0)
except Exception:
    pass
sys.exit(1)
PY
}

_mark_health_draining() {
  _draining_value="$1"
  python3 - "$HEALTH_FILE" "$_draining_value" <<'PY'
import json, os, sys, time
health_file, draining_raw = sys.argv[1], sys.argv[2]
draining = draining_raw == '1'
try:
    with open(health_file) as f:
        h = json.load(f)
except Exception:
    sys.exit(1)
h['draining'] = draining
h['ts'] = time.time() * 1000
tmp = f"{health_file}.{os.getpid()}.drain.tmp"
with open(tmp, 'w') as f:
    json.dump(h, f)
os.replace(tmp, health_file)
PY
}

_wait_shuffler_withdrawn() {
  python3 - "${HME_PROXY_PORT:?HME_PROXY_PORT not set in .env}" "$SLOT" <<'PY'
import json, sys, time, urllib.request
port, slot = sys.argv[1], sys.argv[2]
url = f'http://127.0.0.1:{port}/shuffler/health'
for _ in range(40):
    try:
        with urllib.request.urlopen(url, timeout=0.5) as r:
            data = json.loads(r.read().decode() or '{}')
        if not data.get('backends', {}).get(slot, {}).get('routable'):
            sys.exit(0)
    except Exception:
        pass
    time.sleep(0.25)
sys.exit(1)
PY
}

_require_peer_before_loading_new_code() {
  # Constant availability invariant: if this slot is currently serving, do not
  # even preflight/load replacement code until the peer is proven active.
  if _slot_routable "$HEALTH_FILE" && ! _slot_routable "$_OTHER_HEALTH"; then
    echo "[slot-restart:$SLOT] ABORT: other slot $_OTHER_SLOT is not proven routable; NOT loading replacement code or draining incumbent" >&2
    _record_failure "other_slot_not_routable_before_load slot=$_OTHER_SLOT"
    exit 1
  fi
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
      OVERDRIVE_MODE=0 \
      node "$PROXY_SCRIPT" >> "$_probe_log" 2>&1 < /dev/null &
  _probe_pid=$!
  _wait_ready_file "$_probe_health" "$_probe_pid" 20
  _rc=$?
  if [ "$_rc" = "0" ]; then
    # Ready is necessary but NOT sufficient -- drive one real request through the
    # full handler before trusting the build, so a runtime-broken-but-bootable
    if _smoke_candidate "$_probe_port"; then
      echo "[slot-restart:$SLOT] preflight ready + smoke OK; preserving last viable fallback while replacing incumbent" >&2
      kill -TERM "$_probe_pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$_probe_pid" 2>/dev/null || true
      rm -f "$_probe_health" "$_probe_drain" 2>/dev/null || true
      return 0
    fi
    _rc="smoke_no_response"
    echo "[slot-restart:$SLOT] preflight smoke FAILED (booted but request path crashed); NOT draining incumbent" >&2
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

if ! _can_admit_runtime 2>"$RESTART_FAILURE_FILE.admit"; then
  _reason="admission_denied runtime_fingerprint=$_RUNTIME_FP $(cat "$RESTART_FAILURE_FILE.admit" 2>/dev/null || true)"
  echo "[slot-restart:$SLOT] ABORT: $_reason; incumbent slot left running" >&2
  _record_failure "$_reason"
  rm -f "$RESTART_FAILURE_FILE.admit" 2>/dev/null || true
  exit 1
fi
rm -f "$RESTART_FAILURE_FILE.admit" 2>/dev/null || true

_preflight_candidate || { _mark_slot_broken "preflight_failed"; exit 1; }

_OTHER_SLOT="a"
[ "$SLOT" = "a" ] && _OTHER_SLOT="b"
_OTHER_HEALTH="$RUNTIME_DIR/proxy-$_OTHER_SLOT.health"

# True (exit 0) iff the slot whose health file is $1 is live + routable right
# now: heartbeat fresh, ready, not draining, and its pid is alive.
_slot_routable() {
  python3 - "$1" "$_HEARTBEAT_STALE_MS" <<'PY'
import json, os, sys, time
health_file, stale_ms = sys.argv[1], int(sys.argv[2])
try:
    h = json.load(open(health_file))
    pid = int(h.get('pid') or 0)
    ok = bool(h.get('ready')) and not bool(h.get('draining')) and (time.time() * 1000 - float(h.get('ts') or 0)) <= stale_ms
    if ok and pid > 0:
        os.kill(pid, 0)
        sys.exit(0)
except Exception:
    pass
sys.exit(1)
PY
}

# Require the peer routable ONLY when this slot has a live incumbent to protect;
# if this slot is already down, cold-start it (else a both-down state deadlocks).
if _slot_routable "$HEALTH_FILE"; then
  if ! _slot_routable "$_OTHER_HEALTH"; then
    echo "[slot-restart:$SLOT] ABORT: other slot $_OTHER_SLOT is not proven routable; NOT draining incumbent" >&2
    _record_failure "other_slot_not_routable slot=$_OTHER_SLOT"
    exit 1
  fi
else
  echo "[slot-restart:$SLOT] no routable incumbent on this slot; bypassing peer-routable guard to cold-start (both-down recovery)" >&2
fi

# Step 1: write drain flag only after the replacement build proves it can boot
# AND the other slot is proven routable.
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
_mark_slot_starting
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
    _mark_slot_broken "$_reason"
    exit 1
  fi
  if [ $(( $(date +%s) - _t0 )) -ge 30 ]; then
    _reason="backend not ready within 30s; tail $LOG_FILE"
    echo "[slot-restart:$SLOT] ERROR: $_reason" >&2
    _record_failure "$_reason"
    _mark_slot_broken "$_reason"
    exit 1
  fi
  sleep 1
done

# Step 5: bump throttle sentinel on success.
_mark_slot_viable
date +%s > "$RESTART_SENTINEL"
git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD > "$LAST_VIABLE_FILE" 2>/dev/null || true
rm -f "$RESTART_FAILURE_FILE" 2>/dev/null || true
echo "[slot-restart:$SLOT] complete" >&2
