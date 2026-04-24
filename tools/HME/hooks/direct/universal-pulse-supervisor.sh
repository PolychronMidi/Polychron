#!/usr/bin/env bash
# universal-pulse-supervisor.sh — keep universal_pulse.py alive.
#
# universal_pulse proactively probes every critical HME element (proxy,
# worker, llamacpp_daemon, hook-latency freshness, process CPU saturation)
# at a fixed cadence. When a target is unresponsive past the streak
# threshold, it appends a one-line entry to log/hme-errors.log so LIFESAVER
# fires at the next turn boundary — NOT 48 minutes later when a user
# happens to notice.
#
# Why this exists alongside proxy-supervisor.sh:
#   proxy-supervisor only watches the proxy /health endpoint. If the proxy
#   itself is fine but the WORKER is GIL-locked, proxy-supervisor has no
#   opinion — the hang goes undetected. universal_pulse fills that gap
#   (and every similar one for llamacpp_daemon / hook bridges / etc.).
#
# Design mirrors proxy-supervisor.sh:
#   - Single instance. PID stored in tmp/hme-universal-pulse-supervisor.pid.
#     New invocations with an alive PID silently no-op.
#   - Spawns universal_pulse.py; polls its heartbeat every 15s.
#   - If heartbeat is >90s stale, kills the child and respawns.
#   - Respects maintenance flag — skips restarts during planned windows.

set +e

_SV_ROOT=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _SV_ROOT="$CLAUDE_PROJECT_DIR"
fi
[ -z "$_SV_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _SV_ROOT="/home/jah/Polychron"

_UP_PID_FILE="$_SV_ROOT/tmp/hme-universal-pulse-supervisor.pid"
_UP_CHILD_PID_FILE="$_SV_ROOT/tmp/hme-universal-pulse.pid"
_UP_HEARTBEAT="$_SV_ROOT/tmp/hme-universal-pulse.heartbeat"
_UP_PYTHON_SCRIPT="$_SV_ROOT/tools/HME/activity/universal_pulse.py"
_UP_LIFECYCLE_LOG="$_SV_ROOT/log/hme-universal-pulse.log"
_UP_POLL_INTERVAL=15
_UP_STALE_THRESHOLD=90   # heartbeat stale > 90s -> respawn
_UP_MAINT_FLAG="$_SV_ROOT/tmp/hme-proxy-maintenance.flag"

_up_log() {
  mkdir -p "$(dirname "$_UP_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [universal-pulse-sv] $*" >> "$_UP_LIFECYCLE_LOG" 2>/dev/null
}

_up_alive() {
  local p="$1"
  [ -n "$p" ] && [ -d "/proc/$p" ]
}

_up_kill_child() {
  local cp
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null)
  if _up_alive "$cp"; then
    kill -TERM "$cp" 2>/dev/null
    sleep 2
    _up_alive "$cp" && kill -KILL "$cp" 2>/dev/null
  fi
  rm -f "$_UP_CHILD_PID_FILE" 2>/dev/null
}

_up_spawn_child() {
  if [ ! -f "$_UP_PYTHON_SCRIPT" ]; then
    _up_log "FATAL: python script missing: $_UP_PYTHON_SCRIPT"
    return 1
  fi
  mkdir -p "$_SV_ROOT/log" "$_SV_ROOT/tmp" 2>/dev/null
  PROJECT_ROOT="$_SV_ROOT" python3 "$_UP_PYTHON_SCRIPT" \
    >> "$_UP_LIFECYCLE_LOG" 2>&1 &
  local cp=$!
  disown "$cp" 2>/dev/null
  echo "$cp" > "$_UP_CHILD_PID_FILE"
  _up_log "spawned universal_pulse.py pid=$cp"
}

_up_heartbeat_age() {
  [ -f "$_UP_HEARTBEAT" ] || { echo 999999; return; }
  local mt now
  mt=$(stat -c %Y "$_UP_HEARTBEAT" 2>/dev/null || echo 0)
  now=$(date +%s)
  echo $((now - mt))
}

_up_maint_active() {
  [ -f "$_UP_MAINT_FLAG" ] || return 1
  local start ttl
  start=$(sed -n '1p' "$_UP_MAINT_FLAG" 2>/dev/null)
  ttl=$(sed -n '2p' "$_UP_MAINT_FLAG" 2>/dev/null)
  case "$ttl" in
    ''|*[!0-9]*) return 1 ;;
  esac
  local start_epoch now
  start_epoch=$(date -d "$start" +%s 2>/dev/null || echo 0)
  now=$(date +%s)
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
}

_up_loop() {
  echo "$$" > "$_UP_PID_FILE"
  _up_log "supervisor started pid=$$"

  _up_spawn_child

  while true; do
    sleep "$_UP_POLL_INTERVAL"
    if _up_maint_active; then continue; fi

    local cp age
    cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null)
    age=$(_up_heartbeat_age)

    if ! _up_alive "$cp"; then
      _up_log "child dead — respawning"
      _up_spawn_child
      continue
    fi
    if [ "$age" -gt "$_UP_STALE_THRESHOLD" ]; then
      _up_log "heartbeat stale (${age}s > ${_UP_STALE_THRESHOLD}s) — child pid=$cp appears hung; killing + respawn"
      _up_kill_child
      _up_spawn_child
      continue
    fi
  done
}

_up_start() {
  # Idempotent: if an alive supervisor is already recorded, no-op.
  local existing
  existing=$(cat "$_UP_PID_FILE" 2>/dev/null)
  if _up_alive "$existing"; then
    _up_log "already running pid=$existing — no-op"
    return 0
  fi
  # Fork into background.
  nohup bash "$0" _loop </dev/null >/dev/null 2>&1 &
  disown $! 2>/dev/null
  # No sleep — the parent process of Claude code is waiting on us.
}

_up_stop() {
  local svp cp
  svp=$(cat "$_UP_PID_FILE" 2>/dev/null)
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null)
  _up_alive "$svp" && kill -TERM "$svp" 2>/dev/null
  _up_alive "$cp"  && kill -TERM "$cp"  2>/dev/null
  sleep 1
  _up_alive "$svp" && kill -KILL "$svp" 2>/dev/null
  _up_alive "$cp"  && kill -KILL "$cp"  2>/dev/null
  rm -f "$_UP_PID_FILE" "$_UP_CHILD_PID_FILE" 2>/dev/null
  _up_log "stopped"
}

_up_status() {
  local svp cp age
  svp=$(cat "$_UP_PID_FILE" 2>/dev/null)
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null)
  age=$(_up_heartbeat_age)
  echo "supervisor pid=$svp alive=$(_up_alive "$svp" && echo yes || echo no)"
  echo "child      pid=$cp  alive=$(_up_alive "$cp" && echo yes || echo no)"
  echo "heartbeat  age=${age}s (threshold=${_UP_STALE_THRESHOLD}s)"
}

case "${1:-start}" in
  _loop)   _up_loop ;;
  start)   _up_start ;;
  stop)    _up_stop ;;
  status)  _up_status ;;
  *)       echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
