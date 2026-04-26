#!/usr/bin/env bash
# proxy-supervisor.sh — long-running watchdog that keeps the HME proxy
# alive without needing SessionStart to fire.
#
# Design:
#   - A single instance runs in the background. PID stored in
#     tmp/hme-proxy-supervisor.pid. If that PID is alive, new invocations
#     silently no-op (idempotent).
#   - The loop polls /health every 10 seconds. If the probe fails for 3
#     consecutive polls, the supervisor spawns the proxy and resumes
#     polling. Consecutive-miss threshold avoids racing with planned
#     restarts — during a maintenance window, the probe may fail once or
#     twice while a caller cycles the proxy.
#   - Runs indefinitely (until killed). Use `proxy-supervisor.sh stop`
#     or `kill $(cat tmp/hme-proxy-supervisor.pid)` to stop it.
#
# Why this exists in addition to proxy-watchdog.sh:
#   The watchdog fires ONCE per session at SessionStart. If the proxy
#   crashes mid-session, the watchdog doesn't help until the next
#   session. The supervisor covers the gap — continuous monitoring plus
#   automatic respawn.
#
# Interaction with proxy-maintenance.sh:
#   When a maintenance flag is active, the supervisor skips the spawn
#   attempt — the caller is intentionally cycling the proxy and will
#   bring it back up. The supervisor resumes normal behavior after the
#   flag expires.

set +e

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
# No host-specific hardcoded fallback — if all three fail the
# environment is broken; supervisor exits cleanly rather than guess.
_SV_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _SV_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _SV_ROOT="$CLAUDE_PROJECT_DIR"
else
  _sv_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
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

# Absolute path to THIS script — used by the `start` subcommand's
# `source '$_SV_SELF' _loop` fork-to-daemon line. Was previously
# undefined, which meant the spawn executed `source '' _loop` and
# silently failed with "bash: line 1: : No such file or directory",
# leaving no supervisor and no proxy. Resolved via BASH_SOURCE[0] now
# that we're past the cache-trap-unsafe zone above (the prior lines
# established _SV_ROOT; BASH_SOURCE still resolves correctly whether
# invoked from repo or cache because both paths reach the same file
# via the hook wiring). Fallback to the in-repo canonical path if
# BASH_SOURCE somehow ends up empty.
_SV_SELF="${BASH_SOURCE[0]:-$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh}"
if [ ! -f "$_SV_SELF" ]; then
  _SV_SELF="$_SV_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
fi

# Load project .env so spawned proxy (and its worker/daemon children)
# inherit HME feature flags. Without this, supervisors started from a
# shell that didn't source .env silently lose HME_DOMINANCE,
# HME_OVERDRIVE_*, etc., and the dominance layer becomes dead code.
# Export every assignment so node child inherits. Quiet on absence.
if [ -f "$_SV_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$_SV_ROOT/.env" 2>/dev/null || true
  set +a
fi

_SV_PORT="${HME_PROXY_PORT:-9099}"
_SV_URL="http://127.0.0.1:${_SV_PORT}/health"
_SV_PID_FILE="$_SV_ROOT/tmp/hme-proxy-supervisor.pid"
_SV_MAINT_FLAG="$_SV_ROOT/tmp/hme-proxy-maintenance.flag"
_SV_LIFECYCLE_LOG="$_SV_ROOT/log/hme-proxy-lifecycle.log"
_SV_ERROR_LOG="$_SV_ROOT/log/hme-errors.log"
_SV_PROXY_SCRIPT="$_SV_ROOT/tools/HME/proxy/hme_proxy.js"
_SV_POLL_INTERVAL=10
_SV_MISS_THRESHOLD=3

# Crash-loop detection. If the proxy fails to become healthy within
# _SV_SPAWN_HEALTH_TIMEOUT seconds after a spawn attempt, we count that
# as a consecutive failure. After _SV_CRASH_LOOP_THRESHOLD failures in a
# row, back off exponentially AND fire a LIFESAVER alert to the error
# log so the agent sees the loop rather than the supervisor silently
# burning CPU on a broken proxy. Success resets the counter.
_SV_SPAWN_HEALTH_TIMEOUT=8
_SV_CRASH_LOOP_THRESHOLD=3
_SV_BACKOFF_INITIAL=30    # seconds after first crash-loop detection
_SV_BACKOFF_MAX=600       # cap at 10 minutes

_sv_log() {
  mkdir -p "$(dirname "$_SV_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [proxy-supervisor] $*" >> "$_SV_LIFECYCLE_LOG" 2>/dev/null
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
  start_epoch=$(date -d "$start" +%s 2>/dev/null || echo 0)
  now=$(date +%s)
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
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
  # Wrapper: spawn the proxy, wait up to _SV_SPAWN_HEALTH_TIMEOUT
  # seconds for /health to respond, return 0 on success, 1 on failure.
  _sv_spawn_proxy
  local waited=0
  while [ "$waited" -lt "$_SV_SPAWN_HEALTH_TIMEOUT" ]; do
    if curl -sf --max-time 1 "$_SV_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

_sv_tail_proxy_log() {
  # Return the last N non-blank lines from hme-proxy.out, filtered to the
  # most recent spawn's failure trace. The proxy crash cause — e.g. the
  # ReferenceError that killed it for an entire session earlier — is
  # almost always in those last lines. Surfacing them in the supervisor
  # log and the LIFESAVER banner cuts diagnosis from "tail a file and
  # guess" to "read the banner".
  local proxy_log="$_SV_ROOT/log/hme-proxy.out"
  local n="${1:-20}"
  if [ ! -f "$proxy_log" ]; then
    echo "(no proxy log at $proxy_log)"
    return 0
  fi
  tail -n "$n" "$proxy_log" 2>/dev/null | sed 's/^/  /' || echo "(proxy log unreadable)"
}

_sv_fire_crashloop_lifesaver() {
  local fails="$1"
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  local msg="[$ts] [proxy-supervisor] CRASH LOOP DETECTED — proxy failed to start $fails times in a row. Respawn backing off. Root cause is likely in hme_proxy.js or its environment (.env, context.js, node modules). Fix the proxy startup before expecting recovery."
  # Channel 1: error log for LIFESAVER pickup.
  mkdir -p "$(dirname "$_SV_ERROR_LOG")" 2>/dev/null
  echo "$msg" >> "$_SV_ERROR_LOG" 2>/dev/null
  # Channel 2: lifecycle log for operator audit trail, plus a tail of the
  # proxy log so the crash trace lives alongside the "I gave up" marker.
  _sv_log "CRASH LOOP: $fails consecutive spawn failures — backing off"
  _sv_log "last 20 lines of hme-proxy.out at the time of failure:"
  {
    local line
    _sv_tail_proxy_log 20 | while IFS= read -r line; do
      echo "[$ts] [proxy-supervisor]   $line" >> "$_SV_LIFECYCLE_LOG" 2>/dev/null
    done
  }
  # Channel 3: stderr for local terminal visibility.
  echo "$msg" >&2
  echo "--- last 20 lines of hme-proxy.out ---" >&2
  _sv_tail_proxy_log 20 >&2
  echo "--- end proxy log tail ---" >&2
}

_sv_loop() {
  # Singleton check: if another supervisor's pid is already in the file
  # AND that pid is alive, refuse to start. Two concurrent loops were
  # the silent root cause of intermittent hook failures: each independently
  # decided "proxy down -> respawn" and killed each other's spawns. The
  # `start` action checks the pidfile, but `_loop` (called by setsid)
  # didn't -- so a hook chain that fired `start` twice (during proxy
  # crashes) could spawn two _loops that both grabbed the file in turn.
  if [ -f "$_SV_PID_FILE" ]; then
    _sv_existing=$(cat "$_SV_PID_FILE" 2>/dev/null)
    if [ -n "$_sv_existing" ] && [ "$_sv_existing" != "$$" ] && kill -0 "$_sv_existing" 2>/dev/null; then
      _sv_log "another supervisor already running (pid=$_sv_existing); refusing to start duplicate (this pid=$$)"
      exit 0
    fi
  fi
  _sv_log "supervisor loop started (pid=$$)"
  echo $$ > "$_SV_PID_FILE"
  # Only remove the pid file if it still contains OUR pid. Stop+start
  # races produce a window where the incoming supervisor has already
  # written its pid but the outgoing one hasn't finished its trap. If
  # the outgoing trap blindly removed the file, the new supervisor
  # would appear "not running" until its next poll rewrote it.
  trap '
    _sv_log "supervisor exiting (pid=$$)"
    if [ "$(cat "$_SV_PID_FILE" 2>/dev/null)" = "$$" ]; then
      rm -f "$_SV_PID_FILE" 2>/dev/null
    fi
    exit 0
  ' INT TERM

  local misses=0
  local consecutive_spawn_fails=0
  local backoff_secs=0
  while true; do
    # Exponential backoff after crash loop: skip health polling during
    # the backoff window so the system doesn't thrash spawning a broken
    # proxy every 10 seconds. The LIFESAVER fired when we entered the
    # backoff; it stays in the error log for the next UserPromptSubmit.
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

    if curl -sf --max-time 3 "$_SV_URL" >/dev/null 2>&1; then
      if [ "$misses" -gt 0 ]; then
        _sv_log "proxy healthy again after $misses miss(es)"
      fi
      misses=0
      consecutive_spawn_fails=0
    else
      misses=$((misses + 1))
      if _sv_is_maintenance_active; then
        # During maintenance, ignore misses — the caller will bring the
        # proxy back up. Reset counter so we don't spawn during a later
        # planned window.
        misses=0
      elif [ "$misses" -ge "$_SV_MISS_THRESHOLD" ]; then
        _sv_log "proxy down for $misses polls — respawning"
        if _sv_spawn_and_verify; then
          _sv_log "spawn verified healthy"
          consecutive_spawn_fails=0
        else
          consecutive_spawn_fails=$((consecutive_spawn_fails + 1))
          _sv_log "spawn failed to become healthy within ${_SV_SPAWN_HEALTH_TIMEOUT}s (consecutive_fails=$consecutive_spawn_fails)"
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
      # Stale pid file — remove before respawning.
      rm -f "$_SV_PID_FILE"
    fi
    # Detach. Because this script is invoked from a hook chain, we must
    # return control to the caller immediately — the loop runs in a
    # forked process.
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
        kill "$pid" 2>/dev/null
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
    # command line — start it via `start`.
    _sv_loop
    ;;
  *)
    echo "Usage: proxy-supervisor.sh {start|stop|status}" >&2
    exit 2
    ;;
esac
