#!/usr/bin/env bash
# proxy-supervisor.sh: long-running watchdog (vs proxy-watchdog.sh which fires
# once at SessionStart). Polls /health q10s; 3 consecutive misses -> respawn.
# PID at tools/HME/runtime/proxy-supervisor.pid; new invocations no-op if alive.
# Skips spawn during proxy-maintenance.sh flag windows.
# Stop: `proxy-supervisor.sh stop`; restart/reload restarts the live proxy child.
# Worker: `worker-restart` recovers shared worker.py without proxy-slot churn.

set +e
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/helpers/_hooks_bootstrap.sh"

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_SV_ROOT=""
if [ "${PROJECT_ROOT+x}" = x ] && [ -n "$PROJECT_ROOT" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _SV_ROOT="$PROJECT_ROOT"
elif [ "${CLAUDE_PROJECT_DIR+x}" = x ] && [ -n "$CLAUDE_PROJECT_DIR" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _SV_ROOT="$CLAUDE_PROJECT_DIR"
else
  _sv_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # silent-ok: optional fallback path.
  while [ -n "$_sv_try" ] && [ "$_sv_try" != "/" ]; do
    if [ -d "$_sv_try/.git" ] && [ -d "$_sv_try/src" ]; then
      _SV_ROOT="$_sv_try"
      break
    fi
    _sv_try="$(dirname "$_sv_try")"
  done
fi
if [ -z "$_SV_ROOT" ]; then
  echo "[proxy-supervisor] cannot resolve project root (no PROJECT_ROOT, no CLAUDE_PROJECT_DIR, no .git found in walk-up); exiting" >&2
  exit 0
fi
PROJECT_ROOT="$_SV_ROOT"
[ -f "$_SV_ROOT/tools/HME/hooks/helpers/service_registry.sh" ] && source "$_SV_ROOT/tools/HME/hooks/helpers/service_registry.sh"

# Absolute path to THIS script -- used by the `start` subcommand's
_SV_SELF="${BASH_SOURCE[0]:-$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh}"
if [ ! -f "$_SV_SELF" ]; then
  _SV_SELF="$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
fi

# Load project .env so spawned proxy (and its worker/daemon children)
if [ -f "$_SV_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$_SV_ROOT/.env"
  set +a
fi

_SV_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
_SV_URL="$(_hme_service_url proxy 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_SV_PORT")"  # silent-ok: optional fallback path.
_SV_PID_FILE="$_SV_ROOT/tools/HME/runtime/proxy-supervisor.pid"
_SV_STATE_FILE="$_SV_ROOT/tools/HME/runtime/proxy-supervisor-state.json"
_SV_MAINT_FLAG="$_SV_ROOT/tools/HME/runtime/hme-proxy-maintenance.flag"
_SV_LIFECYCLE_LOG="$_SV_ROOT/log/hme-proxy-lifecycle.log"
_SV_ERROR_LOG="$_SV_ROOT/log/hme-errors.log"
_SV_PROXY_SCRIPT="$_SV_ROOT/tools/HME/proxy/hme_proxy.js"
_SV_RELOAD_MARKER="$_SV_ROOT/tools/HME/runtime/post-commit-proxy-reload-needed"
_SV_RUNTIME_FILE="$_SV_ROOT/tools/HME/runtime/proxy-runtime.json"
_SV_SLOT_HEALTH_A="$_SV_ROOT/tools/HME/runtime/proxy-a.health"
_SV_SLOT_HEALTH_B="$_SV_ROOT/tools/HME/runtime/proxy-b.health"
_SV_POLL_INTERVAL=10
_SV_MISS_THRESHOLD=3
_SV_RELOAD_DEBOUNCE_SECS="${HME_PROXY_RELOAD_DEBOUNCE_SEC:-10}"

# Crash-loop detection. If the proxy bundle fails to become healthy after a
# spawn attempt, count a failure. Repeated failures back off and alert.
_SV_BUNDLE_HEALTH_TIMEOUT=30
_SV_CRASH_LOOP_THRESHOLD=3
_SV_BACKOFF_INITIAL=30    # seconds after first crash-loop detection
_SV_BACKOFF_MAX=600       # cap at 10 minutes
# Spawn-rate ceiling: regardless of crash-loop logic, never spawn faster
# than this. Prevents fork-bomb regressions if a future hook/lifecycle
_SV_SPAWN_MIN_INTERVAL_S=30
_SV_LAST_SPAWN_FILE="$_SV_ROOT/tools/HME/runtime/proxy-supervisor-last-spawn.ts"

# Active-active slots share worker.py; recover it directly here.
_SV_WORKER_PORT="$(_hme_service_port worker 2>/dev/null || printf '%s' "${HME_WORKER_PORT:-9098}")"  # silent-ok: optional fallback path.
_SV_WORKER_URL="$(_hme_service_url worker 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_SV_WORKER_PORT")"  # silent-ok: optional fallback path.
_SV_WORKER_SCRIPT="$_SV_ROOT/tools/HME/service/worker.py"
_SV_WORKER_LOG="$_SV_ROOT/log/hme-worker.out"
_SV_PID_LOG="$_SV_ROOT/log/hme-pids"

_sv_log() {
  mkdir -p "$(dirname "$_SV_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [proxy-supervisor] $*" >> "$_SV_LIFECYCLE_LOG" 2>/dev/null  # silent-ok: optional fallback path.
}

_sv_file_fingerprint() {
  python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1" 2>/dev/null
}

_sv_state_fingerprint() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("fingerprint") or "")' "$1" 2>/dev/null
}

_sv_write_state() {
  local pid="$1" fingerprint="$2" ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  mkdir -p "$(dirname "$_SV_STATE_FILE")" 2>/dev/null || true
  python3 - "$pid" "$fingerprint" "$ts" "$_SV_SELF" "$_SV_STATE_FILE" <<'PY' 2>/dev/null || true
import json, sys
pid, fingerprint, ts, self_path, out_path = sys.argv[1:]
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({'pid': pid, 'fingerprint': fingerprint, 'started_at': ts, 'self': self_path}, f, sort_keys=True)
    f.write('\n')
PY
}

_sv_reexec_if_self_changed() {
  local current
  current="$(_sv_file_fingerprint "$_SV_SELF")"
  [ -n "$current" ] || return 0
  [ -n "${_SV_SELF_FINGERPRINT:-}" ] || _SV_SELF_FINGERPRINT="$current"
  if [ "$current" != "$_SV_SELF_FINGERPRINT" ]; then
    _sv_log "supervisor source changed; re-execing fresh supervisor loop"
    exec bash -c "source '$_SV_SELF' _loop"
  fi
}

_sv_is_maintenance_active() {
  [ -f "$_SV_MAINT_FLAG" ] || return 1
  local start ttl
  start=$(sed -n '1p' "$_SV_MAINT_FLAG" 2>/dev/null)
  ttl=$(sed -n '2p' "$_SV_MAINT_FLAG" 2>/dev/null)
  case "$ttl" in
    ''|*[!0-9]*) return 1 ;;
  esac
  local start_epoch now
  start_epoch=$(date -d "$start" +%s 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  now=$(date +%s)
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
}

_sv_proxy_health_issue() {
  local http_code
  http_code=$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$_SV_URL" 2>/dev/null || echo 000)  # silent-ok: health probe may race proxy boot.
  if [ "$http_code" = "000" ]; then
    echo "proxy unreachable at $_SV_URL"
    return 0
  fi
  # NOTE: runtime_stale (proxy startup git_sha != current HEAD) is now
  # informational only -- it changes on every autocommit, so treating it as
  return 1
}

_sv_child_health_issue() {
  local child_id child_url
  while read -r child_id child_url; do
    [ -n "$child_id" ] || continue
    if ! curl -sf --max-time 3 "$child_url" >/dev/null 2>&1; then
      echo "${child_id} unreachable at ${child_url}"
      return 0
    fi
  done < <(_hme_required_supervised_urls proxy 2>/dev/null || true)  # silent-ok: optional fallback path.
}

_sv_bundle_health_issue() {
  local issue
  issue=$(_sv_proxy_health_issue)
  [ -n "$issue" ] && { echo "$issue"; return 0; }
  _sv_child_health_issue
}

_sv_bundle_healthy() {
  [ -z "$(_sv_bundle_health_issue)" ]
}

_sv_proxy_healthy() {
  [ -z "$(_sv_proxy_health_issue)" ]
}

_sv_live_git_sha() {
  local sha
  sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("git_sha") or "")' "$_SV_SLOT_HEALTH_A" 2>/dev/null || true)
  [ -n "$sha" ] && { printf '%s' "$sha"; return; }
  sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("git_sha") or "")' "$_SV_SLOT_HEALTH_B" 2>/dev/null || true)
  [ -n "$sha" ] && { printf '%s' "$sha"; return; }
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("git_sha") or "")' "$_SV_RUNTIME_FILE" 2>/dev/null || true
}

# Real staleness: proxy /health runtime_stale flips only when proxy-process CODE changes.
_sv_runtime_stale() {
  local stale
  stale=$(curl -sS --max-time 3 "$_SV_URL" 2>/dev/null \
    | python3 -c 'import json,sys
try: print("1" if json.load(sys.stdin).get("runtime_stale") else "0")
except Exception: print("0")' 2>/dev/null)
  [ "$stale" = "1" ]
}

_sv_reload_marker_pending() {
  [ -f "$_SV_RELOAD_MARKER" ] || return 1
  local wanted live marker_age now marker_mtime
  wanted=$(cat "$_SV_RELOAD_MARKER" 2>/dev/null | head -1)
  live=$(_sv_live_git_sha)
  # Non-proxy commit (runtime not stale): clear marker without restarting.
  if ! _sv_runtime_stale; then
    rm -f "$_SV_RELOAD_MARKER" 2>/dev/null
    _sv_log "reload marker cleared (runtime not stale; non-proxy commit) wanted=[$wanted] live=[$live]"
    return 1
  fi
  marker_mtime=$(stat -c %Y "$_SV_RELOAD_MARKER" 2>/dev/null || echo 0)
  now=$(date +%s 2>/dev/null || echo 0)
  marker_age=$((now - marker_mtime))
  # Trace one-shot per (wanted,live,age-bucket) pair so silent skips become diagnosable.
  local trace_key="${wanted}:${live}:$((marker_age / _SV_RELOAD_DEBOUNCE_SECS))"
  if [ "$trace_key" != "${_SV_RELOAD_TRACE_LAST:-}" ]; then
    _sv_log "reload-marker probe (runtime STALE) wanted=[$wanted] live=[$live] marker_age=${marker_age}s"
    _SV_RELOAD_TRACE_LAST="$trace_key"
  fi
  [ "$marker_age" -ge "$_SV_RELOAD_DEBOUNCE_SECS" ]
}

_sv_wait_bundle_healthy() {
  local waited=0
  while [ "$waited" -lt "$_SV_BUNDLE_HEALTH_TIMEOUT" ]; do
    _sv_bundle_healthy && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

_sv_spawn_rate_limit_ok() {
  # Returns 0 when a new spawn is permitted (>= _SV_SPAWN_MIN_INTERVAL_S
  # since the last attempt), 1 when the caller must back off.
  local now last delta
  now=$(date +%s 2>/dev/null || echo 0)
  last=$(cat "$_SV_LAST_SPAWN_FILE" 2>/dev/null)
  case "$last" in
    ''|*[!0-9]*) last=0 ;;
  esac
  delta=$((now - last))
  if [ "$last" -gt 0 ] && [ "$delta" -lt "$_SV_SPAWN_MIN_INTERVAL_S" ]; then
    _sv_log "spawn-rate ceiling: only ${delta}s since last spawn (<${_SV_SPAWN_MIN_INTERVAL_S}s); refusing"
    return 1
  fi
  mkdir -p "$(dirname "$_SV_LAST_SPAWN_FILE")" 2>/dev/null
  printf '%s\n' "$now" > "$_SV_LAST_SPAWN_FILE" 2>/dev/null
  return 0
}

_sv_spawn_proxy() {
  if [ ! -f "$_SV_PROXY_SCRIPT" ]; then
    _sv_log "spawn aborted: $_SV_PROXY_SCRIPT missing"
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    _sv_log "spawn aborted: node not on PATH"
    return 1
  fi
  if ! _sv_spawn_rate_limit_ok; then
    return 1
  fi
  HME_PROXY_PORT="$_SV_PORT" PROJECT_ROOT="$_SV_ROOT" \
    setsid nohup node "$_SV_PROXY_SCRIPT" \
    >> "$_SV_ROOT/log/hme-proxy.out" 2>&1 < /dev/null 200>&- &
  local pid=$!
  disown 2>/dev/null
  _sv_log "proxy spawn attempted (pid=$pid)"
  # Return success for caller; health probe after spawn determines
  # whether the spawned process actually came up.
  return 0
}


_sv_worker_pids() {
  ps -eo pid=,args= 2>/dev/null | awk -v self="$$" -v ppid="$PPID" '
    $1 == self || $1 == ppid { next }
    $0 ~ /awk -v self=/ { next }
    $0 ~ /tools\/HME\/service\/worker\.py/ || $0 ~ /(^|[[:space:]])worker\.py([[:space:]]|$)/ { print $1 }
  ' | sort -u
}

_sv_record_bundle_pid() {
  local label="$1" pid="$2" tmp
  [ -n "$label" ] && [ -n "$pid" ] || return 0
  mkdir -p "$(dirname "$_SV_PID_LOG")" 2>/dev/null || true
  tmp="${_SV_PID_LOG}.tmp.$$"
  if [ -f "$_SV_PID_LOG" ]; then
    awk -F= -v drop="$label" '$1 != drop { print }' "$_SV_PID_LOG" > "$tmp" 2>/dev/null || true
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$label" "$pid" >> "$tmp"
  mv "$tmp" "$_SV_PID_LOG" 2>/dev/null || true
}

_sv_worker_healthy() {
  curl -sf --max-time 3 "$_SV_WORKER_URL" >/dev/null 2>&1
}

_sv_wait_worker_healthy() {
  local timeout="${1:-90}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if _sv_worker_healthy; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

_sv_stop_worker() {
  local pids pid waited alive
  mapfile -t pids < <(_sv_worker_pids)
  [ "${#pids[@]}" -gt 0 ] || return 0
  for pid in "${pids[@]}"; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done
  waited=0
  while [ "$waited" -lt 6 ]; do
    alive=0
    for pid in "${pids[@]}"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = "0" ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  for pid in "${pids[@]}"; do
    [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null || true
  done
  return 0
}

_sv_start_worker() {
  if _sv_worker_healthy; then
    _sv_log "worker already healthy at $_SV_WORKER_URL; adopting existing instance"
    return 0
  fi
  if [ ! -f "$_SV_WORKER_SCRIPT" ]; then
    _sv_log "worker spawn aborted: $_SV_WORKER_SCRIPT missing"
    return 1
  fi
  [ "$(dirname "$_SV_WORKER_LOG")" = "$_SV_ROOT/log" ] || return 1
  mkdir -p "$(dirname "$_SV_WORKER_LOG")" 2>/dev/null || true
  # Set PYTHONPATH outright to the service dir (matches sessionstart.sh and
  # userpromptsubmit.sh). No inline default for this declared env key -- the
  # env fail-fast invariant forbids inline defaults for declared env keys.
  local pythonpath="$_SV_ROOT/tools/HME/service"
  PROJECT_ROOT="$_SV_ROOT" HME_WORKER_PORT="$_SV_WORKER_PORT" PYTHONPATH="$pythonpath" \
    setsid nohup python3 "$_SV_WORKER_SCRIPT" --port "$_SV_WORKER_PORT" \
      >> "$_SV_WORKER_LOG" 2>&1 < /dev/null &
  local pid=$!
  disown 2>/dev/null || true
  _sv_record_bundle_pid worker "$pid"
  _sv_log "worker spawn attempted (pid=$pid url=$_SV_WORKER_URL)"
  _sv_wait_worker_healthy 90
}

_sv_restart_worker() {
  if _sv_worker_healthy; then
    _sv_log "worker already healthy at $_SV_WORKER_URL; adopting existing instance"
    return 0
  fi
  _sv_log "worker unhealthy at $_SV_WORKER_URL; restarting worker.py directly"
  _sv_stop_worker
  _sv_start_worker
}

_sv_recover_health_issue() {
  local issue="$1"
  case "$issue" in
    worker\ *) _sv_restart_worker ;;
    *) _sv_spawn_and_verify ;;
  esac
}

_sv_spawn_and_verify() {
  # Ensure OmniRoute when required, spawn proxy, wait for bundle health.

  # -- OmniRoute pre-flight (OVERDRIVE_MODE=1 translator) --
  local _or_port="$(_hme_service_port omniroute 2>/dev/null || printf '%s' "${HME_OMNIROUTE_PORT}")"  # silent-ok: optional fallback path.
  local _or_url="$(_hme_service_url omniroute 2>/dev/null || printf 'http://127.0.0.1:%s/v1/models' "$_or_port")"  # silent-ok: optional fallback path.
  local _or_dir="$_SV_ROOT/tools/omniroute"
  if [ "${OVERDRIVE_MODE}" = "1" ]; then
    if [ "${HME_OMNIROUTE_OFF:-0}" != "1" ]; then
      if ! curl -sf --max-time 2 "$_or_url" >/dev/null 2>&1; then
        _sv_log "OmniRoute down, starting on :${_or_port}..."
        if [ -x "$_or_dir/start.sh" ]; then
          HME_OMNIROUTE_PORT="$_or_port" \
            bash "$_or_dir/start.sh" > "$_SV_ROOT/log/omniroute.out" 2>&1 &
          local _or_pid=$!
          disown 2>/dev/null || true
          local _or_waited=0
          while [ "$_or_waited" -lt 20 ]; do
            curl -sf --max-time 2 "$_or_url" >/dev/null 2>&1 && break
            sleep 1
            _or_waited=$((_or_waited + 1))
          done
          if curl -sf --max-time 2 "$_or_url" >/dev/null 2>&1; then
            _sv_log "OmniRoute ready after ${_or_waited}s (pid=$_or_pid)"
          else
            _sv_log "OmniRoute startup timed out after ${_or_waited}s"
          fi
        else
          _sv_log "OmniRoute launcher missing at $_or_dir/start.sh"
        fi
      fi
    fi
  fi

  local proxy_code
  proxy_code=$(curl -sS --max-time 1 -o /dev/null -w '%{http_code}' "$_SV_URL" 2>/dev/null || echo 000)
  if [ "$proxy_code" != "000" ]; then
    if _sv_bundle_healthy; then
      return 0
    fi
    local child_issue
    child_issue=$(_sv_child_health_issue)
    if [ -n "$child_issue" ]; then
      case "$child_issue" in
        worker\ *) _sv_restart_worker; return $? ;;
      esac
    fi
    local restart_script="$_SV_ROOT/tools/HME/launcher/polychron-proxy-restart.sh"
    if [ -x "$restart_script" ]; then
      _sv_log "proxy responding with unhealthy state (http=${proxy_code}); running polychron-proxy-restart.sh"
      PROJECT_ROOT="$_SV_ROOT" "$restart_script" >> "$_SV_LIFECYCLE_LOG" 2>&1
      _sv_wait_bundle_healthy
      return $?
    fi
    return 1
  fi

  _sv_spawn_proxy
  _sv_wait_bundle_healthy
}

_sv_tail_proxy_log() {
  # Return the last N non-blank lines from hme-proxy.out, filtered to the
  local proxy_log="$_SV_ROOT/log/hme-proxy.out"
  local n="${1:-20}"
  if [ ! -f "$proxy_log" ]; then
    echo "(no proxy log at $proxy_log)"
    return 0
  fi
  tail -n "$n" "$proxy_log" 2>/dev/null | sed 's/^/  /' || echo "(proxy log unreadable)"  # silent-ok: optional fallback path.
}

_sv_fire_crashloop_lifesaver() {
  local fails="$1"
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  local msg="[$ts] [proxy-supervisor] CRASH LOOP DETECTED -- proxy failed to start $fails times in a row. Respawn backing off. Root cause is likely in hme_proxy.js or its environment (.env, context.js, node modules). Fix the proxy startup before expecting recovery."
  # Channel 1: error log for LIFESAVER pickup.
  mkdir -p "$(dirname "$_SV_ERROR_LOG")" 2>/dev/null
  echo "$msg" >> "$_SV_ERROR_LOG" 2>/dev/null  # silent-ok: optional fallback path.
  # Channel 2: lifecycle log for operator audit trail, plus a tail of the
  # proxy log so the crash trace lives alongside the "I gave up" marker.
  _sv_log "CRASH LOOP: $fails consecutive spawn failures -- backing off"
  _sv_log "last 20 lines of hme-proxy.out at the time of failure:"
  {
    local line
    _sv_tail_proxy_log 20 | while IFS= read -r line; do
      echo "[$ts] [proxy-supervisor]   $line" >> "$_SV_LIFECYCLE_LOG" 2>/dev/null  # silent-ok: optional fallback path.
    done
  }
  # Channel 3: stderr for local terminal visibility.
  echo "$msg" >&2
  echo "--- last 20 lines of hme-proxy.out ---" >&2
  _sv_tail_proxy_log 20 >&2
  echo "--- end proxy log tail ---" >&2
}

# Keep the shuffler helper procs (router + file-watcher + slot-watchdog) alive.
# Nothing else respawns them: polychron-launch starts them once with nohup, so
_sv_ensure_shuffler_procs() {
  _sv_is_maintenance_active && return 0
  local sdir="$_SV_ROOT/tools/HME/proxy/shuffler"
  local name script logf
  for name in file_watcher slot_watchdog; do
    script="$sdir/${name}.js"
    [ -f "$script" ] || continue
    if ! pgrep -f "shuffler/${name}\.js" >/dev/null 2>&1; then
      logf="$_SV_ROOT/log/hme-${name//_/-}.out"
      PROJECT_ROOT="$_SV_ROOT" setsid nohup node "$script" >> "$logf" 2>&1 < /dev/null &
      disown 2>/dev/null || true
      local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
      echo "[$ts] [shuffler] LIFESAVER ${name} was dead; respawned by proxy-supervisor (auto-heal had stopped)" \
        >> "$_SV_ERROR_LOG" 2>/dev/null
      _sv_log "respawned dead shuffler proc ${name}"
    fi
  done
}

_sv_loop() {
  # Singleton check via flock advisory lock + pid-file confirmation.
  # Use a supervisor-owned lock path distinct from historical child-inherited
  _SV_LOCK_FILE="$_SV_PID_FILE.supervisor.lock"
  exec 200>"$_SV_LOCK_FILE" 2>/dev/null || true  # silent-ok: optional fallback path.
  if command -v flock >/dev/null 2>&1; then
    if ! flock -n 200 2>/dev/null; then  # silent-ok: optional fallback path.
      _sv_log "another supervisor holds the lock at $_SV_LOCK_FILE; refusing to start (this pid=$$)"
      exit 0
    fi
  fi
  # Defense-in-depth: even with flock held, sanity-check the pid file
  if [ -f "$_SV_PID_FILE" ]; then
    _sv_existing=$(cat "$_SV_PID_FILE" 2>/dev/null)
    if [ -n "$_sv_existing" ] && [ "$_sv_existing" != "$$" ] && kill -0 "$_sv_existing" 2>/dev/null; then
      _sv_log "another supervisor pid in file (pid=$_sv_existing) and alive; refusing to start duplicate (this pid=$$)"
      exit 0
    fi
  fi
  _SV_SELF_FINGERPRINT="$(_sv_file_fingerprint "$_SV_SELF")"
  _sv_log "supervisor loop started (pid=$$, flock held)"
  echo $$ > "$_SV_PID_FILE"
  _sv_write_state "$$" "$_SV_SELF_FINGERPRINT"
  # Only remove the pid file if it still contains OUR pid. Stop+start
  trap '
    _sv_log "supervisor exiting (pid=$$)"
    if [ "$(cat "$_SV_PID_FILE" 2>/dev/null)" = "$$" ]; then
      rm -f "$_SV_PID_FILE" 2>/dev/null
    fi
    # Release flock + drop lockfile if we hold it. fd 200 closes
    rm -f "$_SV_LOCK_FILE" 2>/dev/null
    exit 0
  ' INT TERM

  if ! _sv_bundle_healthy && ! _sv_is_maintenance_active; then
    local initial_issue
    initial_issue=$(_sv_bundle_health_issue)
    _sv_log "initial bundle unhealthy on supervisor start: $initial_issue"
    _sv_recover_health_issue "$initial_issue" && _sv_log "initial recovery verified healthy"
  fi

  local misses=0
  local consecutive_spawn_fails=0
  local backoff_secs=0
  while true; do
    _sv_reexec_if_self_changed
    _sv_ensure_shuffler_procs
    # Exponential backoff after crash loop: skip health polling during
    if [ "$backoff_secs" -gt 0 ]; then
      sleep "$backoff_secs"
      # After the backoff, give the spawn one more shot. If it STILL
      # fails, the fails counter grows and backoff doubles (capped).
      if _sv_spawn_and_verify; then
        _sv_log "proxy recovered from crash-loop backoff after ${consecutive_spawn_fails} fails"
        consecutive_spawn_fails=0
        backoff_secs=0
        misses=0
      else
        consecutive_spawn_fails=$((consecutive_spawn_fails + 1))
        backoff_secs=$((backoff_secs * 2))
        if [ "$backoff_secs" -gt "$_SV_BACKOFF_MAX" ]; then
          backoff_secs=$_SV_BACKOFF_MAX
        fi
        _sv_fire_crashloop_lifesaver "$consecutive_spawn_fails"
        _sv_log "backoff extended to ${backoff_secs}s"
      fi
      continue
    fi

    if _sv_reload_marker_pending && ! _sv_is_maintenance_active; then
      touch "$_SV_RELOAD_MARKER" 2>/dev/null
      _sv_log "post-commit reload marker pending; running proxy restart"
      if _sv_spawn_and_verify; then
        _sv_log "post-commit reload verified"
        consecutive_spawn_fails=0
        misses=0
      else
        consecutive_spawn_fails=$((consecutive_spawn_fails + 1))
        _sv_log "post-commit reload failed (consecutive_fails=$consecutive_spawn_fails)"
      fi
    elif _sv_proxy_healthy; then
      if [ "$misses" -gt 0 ]; then
        _sv_log "proxy healthy again after $misses miss(es)"
      fi
      misses=0
      consecutive_spawn_fails=0
      local child_issue
      child_issue=$(_sv_child_health_issue)
      if [ -n "$child_issue" ]; then
        _sv_log "child issue detected; recovering: $child_issue"
        if _sv_recover_health_issue "$child_issue"; then
          _sv_log "child recovery verified"
          consecutive_spawn_fails=0
          misses=0
        else
          consecutive_spawn_fails=$((consecutive_spawn_fails + 1))
          _sv_log "child recovery failed (consecutive_fails=$consecutive_spawn_fails)"
          if [ "$consecutive_spawn_fails" -ge "$_SV_CRASH_LOOP_THRESHOLD" ]; then
            _sv_fire_crashloop_lifesaver "$consecutive_spawn_fails"
            backoff_secs=$_SV_BACKOFF_INITIAL
            _sv_log "entering crash-loop backoff: ${backoff_secs}s"
          fi
        fi
      fi
    else
      misses=$((misses + 1))
      if _sv_is_maintenance_active; then
        misses=0
      elif [ "$misses" -ge "$_SV_MISS_THRESHOLD" ]; then
        _sv_log "proxy itself unhealthy for $misses polls: $(_sv_proxy_health_issue)"
        if _sv_spawn_and_verify; then
          _sv_log "spawn verified healthy"
          consecutive_spawn_fails=0
        else
          consecutive_spawn_fails=$((consecutive_spawn_fails + 1))
          _sv_log "spawn failed to become bundle-healthy within ${_SV_BUNDLE_HEALTH_TIMEOUT}s (consecutive_fails=$consecutive_spawn_fails)"
          if [ "$consecutive_spawn_fails" -ge "$_SV_CRASH_LOOP_THRESHOLD" ]; then
            _sv_fire_crashloop_lifesaver "$consecutive_spawn_fails"
            backoff_secs=$_SV_BACKOFF_INITIAL
            _sv_log "entering crash-loop backoff: ${backoff_secs}s"
          fi
        fi
        misses=0
      fi
    fi
    sleep "$_SV_POLL_INTERVAL"
  done
}

_action="${1:-start}"

case "$_action" in
  start)
    # Idempotent start. If the supervisor is already running, no-op.
    if [ -f "$_SV_PID_FILE" ]; then
      existing=$(cat "$_SV_PID_FILE" 2>/dev/null)
      if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
        current_fingerprint="$(_sv_file_fingerprint "$_SV_SELF")"
        running_fingerprint="$(_sv_state_fingerprint "$_SV_STATE_FILE")"
        if [ -n "$current_fingerprint" ] && { [ -z "$running_fingerprint" ] || [ "$current_fingerprint" != "$running_fingerprint" ]; }; then
          _sv_log "supervisor start replacing stale supervisor pid=$existing (source fingerprint missing/changed)"
          kill "$existing" 2>/dev/null || true
          waited=0
          while [ "$waited" -lt 5 ] && kill -0 "$existing" 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
          done
          if kill -0 "$existing" 2>/dev/null; then
            _sv_log "stale supervisor pid=$existing did not exit after TERM; start left existing supervisor running"
            echo "proxy-supervisor: stale supervisor still running (pid=$existing)" >&2
            exit 0
          fi
          rm -f "$_SV_PID_FILE" 2>/dev/null
        else
          echo "proxy-supervisor: already running (pid=$existing)" >&2
          exit 0
        fi
      fi
      # Stale pid file -- remove before respawning.
      rm -f "$_SV_PID_FILE"
    fi
    # Detach. Because this script is invoked from a hook chain, we must
    setsid nohup bash -c "source '$_SV_SELF' _loop" \
      >> "$_SV_LIFECYCLE_LOG" 2>&1 < /dev/null &
    disown 2>/dev/null
    sleep 1
    if [ -f "$_SV_PID_FILE" ]; then
      echo "proxy-supervisor: started (pid=$(cat "$_SV_PID_FILE"))" >&2
    else
      echo "proxy-supervisor: spawn probably succeeded but pid file not yet written" >&2
    fi
    ;;
  stop)
    if [ -f "$_SV_PID_FILE" ]; then
      pid=$(cat "$_SV_PID_FILE")
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null  # silent-ok: optional fallback path.
        _sv_log "supervisor stopped via proxy-supervisor.sh stop (pid=$pid)"
        rm -f "$_SV_PID_FILE"
        echo "proxy-supervisor: stopped (pid=$pid)" >&2
      else
        rm -f "$_SV_PID_FILE"
        echo "proxy-supervisor: stale pid file removed" >&2
      fi
    else
      echo "proxy-supervisor: not running" >&2
    fi
    pkill -TERM -f "node $_SV_PROXY_SCRIPT" 2>/dev/null || pkill -TERM -f "$_SV_PROXY_SCRIPT" 2>/dev/null || true
    _sv_log "proxy child stop requested via proxy-supervisor.sh stop"
    ;;
  restart|reload)
    "$_SV_ROOT/tools/HME/launcher/polychron-proxy-restart.sh"
    "$_SV_SELF" start >/dev/null 2>&1 || true
    ;;
  worker-restart)
    _sv_log "manual worker-restart requested"
    _sv_restart_worker
    ;;
  worker-health)
    if curl -sf --max-time 3 "$_SV_WORKER_URL"; then
      exit 0
    fi
    exit 1
    ;;
  status)
    if [ -f "$_SV_PID_FILE" ]; then
      pid=$(cat "$_SV_PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        echo "running (pid=$pid)"
      else
        echo "stale pid file (pid=$pid not alive)"
      fi
    else
      echo "not running"
    fi
    if curl -sf --max-time 3 "$_SV_WORKER_URL" >/dev/null 2>&1; then
      echo "worker healthy ($_SV_WORKER_URL)"
    else
      echo "worker unhealthy ($_SV_WORKER_URL)"
    fi
    ;;
  _loop)
    # Internal: the detached loop body. Never call this directly from the
    # command line -- start it via `start`.
    _sv_loop
    ;;
  *)
    echo "Usage: proxy-supervisor.sh {start|stop|restart|reload|status}" >&2
    exit 2
    ;;
esac
