#!/usr/bin/env bash
# universal-pulse-supervisor.sh: keeps universal_pulse.py (proactive probe of
# proxy/worker/daemon/hook-latency/CPU) alive. Fills the gap proxy-supervisor
# can't see (worker GIL hangs, daemon stalls). Single instance via
# tools/HME/runtime/universal-pulse-supervisor.pid; heartbeat poll q15s; respawn if >90s
# stale; respects maintenance flag.

set +e
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/helpers/_hooks_bootstrap.sh"

_SV_ROOT=""
if [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _SV_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _SV_ROOT="$CLAUDE_PROJECT_DIR"
fi
if [ -z "$_SV_ROOT" ]; then
  _try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # silent-ok: optional fallback path.
  while [ -n "$_try" ] && [ "$_try" != "/" ]; do
    [ -f "$_try/.env" ] && [ -d "$_try/.git" ] && { _SV_ROOT="$_try"; break; }
    _try="$(dirname "$_try")"
  done
fi

_UP_PID_FILE="$_SV_ROOT/tools/HME/runtime/universal-pulse-supervisor.pid"
_UP_CHILD_PID_FILE="$_SV_ROOT/tools/HME/runtime/hme-universal-pulse.pid"
_UP_HEARTBEAT="$_SV_ROOT/tmp/hme-universal-pulse.heartbeat"
_UP_PYTHON_SCRIPT="$_SV_ROOT/tools/HME/activity/universal_pulse.py"
_UP_LIFECYCLE_LOG="$_SV_ROOT/log/hme-universal-pulse.log"
_UP_POLL_INTERVAL=15
_UP_STALE_THRESHOLD=90   # heartbeat stale > 90s -> respawn
_UP_MAINT_FLAG="$_SV_ROOT/tmp/hme-proxy-maintenance.flag"

_up_log() {
  mkdir -p "$(dirname "$_UP_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [universal-pulse-sv] $*" >> "$_UP_LIFECYCLE_LOG" 2>/dev/null  # silent-ok: optional fallback path.
}

_up_alive() {
  local p="$1"
  local pattern="${2:-}"
  [ -n "$p" ] && [ -d "/proc/$p" ] || return 1
  [ -z "$pattern" ] && return 0
  tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qE "$pattern"  # silent-ok: optional fallback path.
}

_up_kill_child() {
  local cp
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null || true)
  if _up_alive "$cp" "universal_pulse.py"; then
    kill -TERM "$cp" 2>/dev/null  # silent-ok: optional fallback path.
    sleep 2
    _up_alive "$cp" && kill -KILL "$cp" 2>/dev/null  # silent-ok: optional fallback path.
  fi
  rm -f "$_UP_CHILD_PID_FILE" 2>/dev/null
}

# Newest mtime across the pulse script + the modules it imports at runtime, so a
# code change to any of them triggers a reload (the daemon otherwise runs the
# version it was forked with until it dies -- stale-code drift).
_up_code_mtime() {
  local newest=0 m
  for f in "$_UP_PYTHON_SCRIPT" \
           "$_SV_ROOT/tools/HME/activity/universal_pulse_tick.py" \
           "$_SV_ROOT/tools/HME/scripts/refresh_pid_file.py" \
           "$_SV_ROOT/tools/HME/scripts/service_registry.py"; do
    [ -f "$f" ] || continue
    m=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$m" -gt "$newest" ] && newest="$m"
  done
  echo "$newest"
}

_up_spawn_child() {
  if [ ! -f "$_UP_PYTHON_SCRIPT" ]; then
    _up_log "FATAL: python script missing: $_UP_PYTHON_SCRIPT"
    return 1
  fi
  # Adopt an already-alive child instead of spawning a duplicate. This matters
  # on supervisor re-exec: the loop restarts from the top with the prior child
  local _existing
  _existing=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null || true)
  if _up_alive "$_existing" "universal_pulse.py"; then
    _UP_CHILD_CODE_MTIME=$(_up_code_mtime)
    _up_log "adopted existing universal_pulse.py pid=$_existing (no respawn)"
    return 0
  fi
  mkdir -p "$_SV_ROOT/log" "$_SV_ROOT/tmp" 2>/dev/null
  PROJECT_ROOT="$_SV_ROOT" python3 "$_UP_PYTHON_SCRIPT" \
    >> "$_UP_LIFECYCLE_LOG" 2>&1 &
  local cp=$!
  disown "$cp" 2>/dev/null
  echo "$cp" > "$_UP_CHILD_PID_FILE"
  # Record the code version this child was forked with, for stale-code detection.
  _UP_CHILD_CODE_MTIME=$(_up_code_mtime)
  _up_log "spawned universal_pulse.py pid=$cp code_mtime=$_UP_CHILD_CODE_MTIME"
}

_write_heartbeat() {
  local state="${1:-supervisor}" ok="${2:-0}" bad="${3:-0}"
  mkdir -p "$(dirname "$_UP_HEARTBEAT")" 2>/dev/null
  python3 - "$state" "$ok" "$bad" "$_UP_HEARTBEAT" <<'PY' 2>/dev/null || true
import json, os, pathlib, sys, time
state, ok, bad, out = sys.argv[1:]
p = pathlib.Path(out)
tmp = p.with_suffix(p.suffix + '.sv.tmp')
tmp.write_text(json.dumps({'ts': int(time.time()), 'state': state, 'ok': int(ok), 'bad': int(bad)}))
os.replace(tmp, p)
PY
}

_up_heartbeat_age() {
  [ -f "$_UP_HEARTBEAT" ] || { echo 0; return; }
  local mt now
  mt=$(stat -c %Y "$_UP_HEARTBEAT" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
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
  start_epoch=$(date -d "$start" +%s 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  now=$(date +%s)
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
}

_up_self_mtime() {
  stat -c %Y "${BASH_SOURCE[0]}" 2>/dev/null || echo 0
}

_up_loop() {
  echo "$$" > "$_UP_PID_FILE"
  _up_log "supervisor started pid=$$"
  # Record this supervisor's own source mtime. A long-lived bash process does
  # not re-read its script after launch, so on an edit we must re-exec to run
  local _self_mtime; _self_mtime=$(_up_self_mtime)

  _write_heartbeat supervisor-starting 0 0
  _up_spawn_child

  while true; do
    sleep "$_UP_POLL_INTERVAL"
    if _up_maint_active; then continue; fi

    # Self-converge to current code: re-exec when our own .sh changed on disk.
    # exec replaces this process in place, preserving the PID file + child.
    if [ "$(_up_self_mtime)" -gt "$_self_mtime" ]; then
      _up_log "supervisor source changed -- re-exec'ing into new code (pid=$$)"
      exec bash "${BASH_SOURCE[0]}" _loop
    fi

    local cp age
    cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null || true)
    age=$(_up_heartbeat_age)

    if ! _up_alive "$cp" "universal_pulse.py"; then
      _write_heartbeat child-respawn 0 1
      _up_log "child dead -- respawning"
      _up_spawn_child
      continue
    fi
    if [ "$age" -gt "$_UP_STALE_THRESHOLD" ]; then
      _write_heartbeat heartbeat-respawn 0 1
      _up_log "heartbeat stale (${age}s > ${_UP_STALE_THRESHOLD}s) -- child pid=$cp appears hung; killing + respawn"
      _up_kill_child
      _up_spawn_child
      continue
    fi
    # Stale-code reload: if the pulse script or its imports changed on disk since
    # this child was forked, cycle it so the new code goes live (mirrors the
    local code_mtime
    code_mtime=$(_up_code_mtime)
    if [ -n "${_UP_CHILD_CODE_MTIME:-}" ] && [ "$code_mtime" -gt "$_UP_CHILD_CODE_MTIME" ]; then
      _up_log "code changed (mtime $_UP_CHILD_CODE_MTIME -> $code_mtime) -- reloading child pid=$cp"
      _up_kill_child
      _up_spawn_child
      continue
    fi
  done
}

_up_start() {
  # Idempotent: if an alive supervisor is already recorded, no-op.
  local existing
  existing=$(cat "$_UP_PID_FILE" 2>/dev/null || true)
  if _up_alive "$existing" "universal-pulse-supervisor.sh|bash .*_loop"; then
    _up_log "already running pid=$existing -- no-op"
    return 0
  fi
  # Fork into background.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash "$0" _loop </dev/null >/dev/null 2>&1 &
  else
    nohup bash "$0" _loop </dev/null >/dev/null 2>&1 &
  fi
  disown $! 2>/dev/null
  # No sleep -- the parent process of Claude code is waiting on us.
}

_up_stop() {
  local svp cp
  svp=$(cat "$_UP_PID_FILE" 2>/dev/null || true)
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null || true)
  _up_alive "$svp" "universal-pulse-supervisor.sh|bash .*_loop" && kill -TERM "$svp" 2>/dev/null  # silent-ok: optional fallback path.
  _up_alive "$cp" "universal_pulse.py" && kill -TERM "$cp"  2>/dev/null  # silent-ok: optional fallback path.
  sleep 1
  _up_alive "$svp" "universal-pulse-supervisor.sh|bash .*_loop" && kill -KILL "$svp" 2>/dev/null  # silent-ok: optional fallback path.
  _up_alive "$cp" "universal_pulse.py" && kill -KILL "$cp"  2>/dev/null  # silent-ok: optional fallback path.
  rm -f "$_UP_PID_FILE" "$_UP_CHILD_PID_FILE" 2>/dev/null
  _up_log "stopped"
}

_up_status() {
  local svp cp age
  svp=$(cat "$_UP_PID_FILE" 2>/dev/null || true)
  cp=$(cat "$_UP_CHILD_PID_FILE" 2>/dev/null || true)
  age=$(_up_heartbeat_age)
  echo "supervisor pid=$svp alive=$(_up_alive "$svp" "universal-pulse-supervisor.sh|bash .*_loop" && echo yes || echo no)"
  echo "child      pid=$cp  alive=$(_up_alive "$cp" "universal_pulse.py" && echo yes || echo no)"
  echo "heartbeat  age=${age}s (threshold=${_UP_STALE_THRESHOLD}s)"
}

case "${1:-start}" in
  _loop)   _up_loop ;;
  start)   _up_start ;;
  stop)    _up_stop ;;
  status)  _up_status ;;
  *)       echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
