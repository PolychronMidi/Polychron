#!/usr/bin/env bash
# proxy-supervisor.sh: long-running watchdog (vs proxy-watchdog.sh which fires
# once at SessionStart). Polls /health q10s; 3 consecutive misses -> respawn.
# PID at runtime/hme/proxy-supervisor.pid; new invocations no-op if alive.
# Skips spawn during proxy-maintenance.sh flag windows.
# Stop: `proxy-supervisor.sh stop` or `kill $(cat runtime/hme/proxy-supervisor.pid)`.

set +e

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_SV_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _SV_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
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
source "$_SV_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.

# Absolute path to THIS script -- used by the `start` subcommand's
_SV_SELF="${BASH_SOURCE[0]:-$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh}"
if [ ! -f "$_SV_SELF" ]; then
  _SV_SELF="$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
fi

# Load project .env so spawned proxy (and its worker/daemon children)
if [ -f "$_SV_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$_SV_ROOT/.env" 2>/dev/null || true  # silent-ok: optional fallback path.
  set +a
fi

_SV_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"  # silent-ok: optional fallback path.
_SV_URL="$(_hme_service_url proxy 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_SV_PORT")"  # silent-ok: optional fallback path.
_SV_PID_FILE="$_SV_ROOT/runtime/hme/proxy-supervisor.pid"
_SV_MAINT_FLAG="$_SV_ROOT/tmp/hme-proxy-maintenance.flag"
_SV_LIFECYCLE_LOG="$_SV_ROOT/log/hme-proxy-lifecycle.log"
_SV_ERROR_LOG="$_SV_ROOT/log/hme-errors.log"
_SV_PROXY_SCRIPT="$_SV_ROOT/tools/HME/proxy/hme_proxy.js"
_SV_POLL_INTERVAL=10
_SV_MISS_THRESHOLD=3

# Crash-loop detection. If the proxy bundle fails to become healthy after a
# spawn attempt, count a failure. Repeated failures back off and alert.
_SV_BUNDLE_HEALTH_TIMEOUT=30
_SV_CRASH_LOOP_THRESHOLD=3
_SV_BACKOFF_INITIAL=30    # seconds after first crash-loop detection
_SV_BACKOFF_MAX=600       # cap at 10 minutes

_sv_log() {
  mkdir -p "$(dirname "$_SV_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [proxy-supervisor] $*" >> "$_SV_LIFECYCLE_LOG" 2>/dev/null  # silent-ok: optional fallback path.
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

_sv_bundle_health_issue() {
  if ! curl -sf --max-time 3 "$_SV_URL" >/dev/null 2>&1; then
    echo "proxy unreachable at $_SV_URL"
    return 0
  fi
  local child_id child_url
  while read -r child_id child_url; do
    [ -n "$child_id" ] || continue
    if ! curl -sf --max-time 3 "$child_url" >/dev/null 2>&1; then
      echo "${child_id} unreachable at ${child_url}"
      return 0
    fi
  done < <(_hme_required_supervised_urls proxy 2>/dev/null || true)  # silent-ok: optional fallback path.
}

_sv_bundle_healthy() {
  [ -z "$(_sv_bundle_health_issue)" ]
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

_sv_spawn_proxy() {
  if [ ! -f "$_SV_PROXY_SCRIPT" ]; then
    _sv_log "spawn aborted: $_SV_PROXY_SCRIPT missing"
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    _sv_log "spawn aborted: node not on PATH"
    return 1
  fi
  HME_PROXY_PORT="$_SV_PORT" PROJECT_ROOT="$_SV_ROOT" \
    setsid nohup node "$_SV_PROXY_SCRIPT" \
    >> "$_SV_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
  local pid=$!
  disown 2>/dev/null
  _sv_log "proxy spawn attempted (pid=$pid)"
  # Return success for caller; health probe after spawn determines
  # whether the spawned process actually came up.
  return 0
}

_sv_spawn_and_verify() {
  # Ensure OmniRoute when required, spawn proxy, wait for bundle health.

  # -- OmniRoute pre-flight (MODE=4/5 main-agent translator) --
  local _or_port="$(_hme_service_port omniroute 2>/dev/null || printf '%s' "${HME_OMNIROUTE_PORT:-20128}")"  # silent-ok: optional fallback path.
  local _or_url="$(_hme_service_url omniroute 2>/dev/null || printf 'http://127.0.0.1:%s/v1/models' "$_or_port")"  # silent-ok: optional fallback path.
  local _or_dir="$_SV_ROOT/tools/omniroute"
  if [ "${OVERDRIVE_MODE:-0}" = "4" ] || [ "${OVERDRIVE_MODE:-0}" = "5" ] || [ "${OVERDRIVE_MODE:-0}" = "6" ]; then
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

  if curl -sf --max-time 1 "$_SV_URL" >/dev/null 2>&1; then
    if _sv_bundle_healthy; then
      return 0
    fi
    local restart_script="$_SV_ROOT/tools/HME/launcher/polychron-proxy-restart.sh"
    if [ -x "$restart_script" ]; then
      _sv_log "proxy up but bundle unhealthy; running polychron-proxy-restart.sh"
      PROJECT_ROOT="$_SV_ROOT" "$restart_script" >> "$_SV_LIFECYCLE_LOG" 2>&1
      _sv_wait_bundle_healthy
      return $?
    fi
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

_sv_loop() {
  # Singleton check via flock advisory lock + pid-file confirmation.
  _SV_LOCK_FILE="$_SV_PID_FILE.lock"
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
  _sv_log "supervisor loop started (pid=$$, flock held)"
  echo $$ > "$_SV_PID_FILE"
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

  local misses=0
  local consecutive_spawn_fails=0
  local backoff_secs=0
  while true; do
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

    if _sv_bundle_healthy; then
      if [ "$misses" -gt 0 ]; then
        _sv_log "proxy healthy again after $misses miss(es)"
      fi
      misses=0
      consecutive_spawn_fails=0
    else
      misses=$((misses + 1))
      if _sv_is_maintenance_active; then
        # During maintenance, ignore misses -- the caller will bring the
        misses=0
      elif [ "$misses" -ge "$_SV_MISS_THRESHOLD" ]; then
        _sv_log "proxy bundle unhealthy for $misses polls: $(_sv_bundle_health_issue)"
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
        echo "proxy-supervisor: already running (pid=$existing)" >&2
        exit 0
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
    ;;
  _loop)
    # Internal: the detached loop body. Never call this directly from the
    # command line -- start it via `start`.
    _sv_loop
    ;;
  *)
    echo "Usage: proxy-supervisor.sh {start|stop|status}" >&2
    exit 2
    ;;
esac
