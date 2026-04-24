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

_SV_SELF="${BASH_SOURCE[0]}"
_SV_ROOT="$(cd "$(dirname "$_SV_SELF")/../../../.." 2>/dev/null && pwd)"
[ -z "$_SV_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _SV_ROOT="/home/jah/Polychron"

_SV_PORT="${HME_PROXY_PORT:-9099}"
_SV_URL="http://127.0.0.1:${_SV_PORT}/health"
_SV_PID_FILE="$_SV_ROOT/tmp/hme-proxy-supervisor.pid"
_SV_MAINT_FLAG="$_SV_ROOT/tmp/hme-proxy-maintenance.flag"
_SV_LIFECYCLE_LOG="$_SV_ROOT/log/hme-proxy-lifecycle.log"
_SV_PROXY_SCRIPT="$_SV_ROOT/tools/HME/proxy/hme_proxy.js"
_SV_POLL_INTERVAL=10
_SV_MISS_THRESHOLD=3

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
}

_sv_loop() {
  _sv_log "supervisor loop started (pid=$$)"
  echo $$ > "$_SV_PID_FILE"
  trap '_sv_log "supervisor exiting (pid=$$)"; rm -f "$_SV_PID_FILE" 2>/dev/null; exit 0' INT TERM

  local misses=0
  while true; do
    if curl -sf --max-time 3 "$_SV_URL" >/dev/null 2>&1; then
      if [ "$misses" -gt 0 ]; then
        _sv_log "proxy healthy again after $misses miss(es)"
      fi
      misses=0
    else
      misses=$((misses + 1))
      if _sv_is_maintenance_active; then
        # During maintenance, ignore misses — the caller will bring the
        # proxy back up. Reset counter so we don't spawn during a later
        # planned window.
        misses=0
      elif [ "$misses" -ge "$_SV_MISS_THRESHOLD" ]; then
        _sv_log "proxy down for $misses polls — respawning"
        _sv_spawn_proxy
        # Give the spawn time to bind the port before the next poll.
        sleep 4
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
