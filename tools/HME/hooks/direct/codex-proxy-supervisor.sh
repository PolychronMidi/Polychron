#!/usr/bin/env bash
# Keep the HME Codex Responses proxy alive. The proxy is optional for Claude,
# but Codex parity depends on it once ~/.codex/config.toml routes through HME.

set +e

_SV_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/tools/HME" ]; then
  _SV_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/tools/HME" ]; then
  _SV_ROOT="$CLAUDE_PROJECT_DIR"
else
  _try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
  while [ -n "$_try" ] && [ "$_try" != "/" ]; do
    if [ -d "$_try/.git" ] && [ -d "$_try/tools/HME" ]; then
      _SV_ROOT="$_try"
      break
    fi
    _try="$(dirname "$_try")"
  done
fi

if [ -z "$_SV_ROOT" ]; then
  echo "[codex-proxy-supervisor] cannot resolve project root" >&2
  exit 0
fi

PROJECT_ROOT="$_SV_ROOT"
source "$_SV_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.

if [ -f "$_SV_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$_SV_ROOT/.env" 2>/dev/null || true  # silent-ok: optional fallback path.
  set +a
fi

_CP_PORT="$(_hme_service_port codex_proxy 2>/dev/null || printf '%s' "${HME_CODEX_PROXY_PORT:-9102}")"
_CP_URL="$(_hme_service_url codex_proxy 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_CP_PORT")"
_CP_PID_FILE="$_SV_ROOT/runtime/hme/codex-proxy.pid"
_CP_SCRIPT="$_SV_ROOT/tools/HME/proxy/codex_proxy.js"
_CP_OMNI="$_SV_ROOT/tools/HME/proxy/codex_omniroute.js"
_CP_CONFIG="$_SV_ROOT/tools/HME/config/codex-proxy.json"
_CP_LOG="$_SV_ROOT/log/hme-codex-proxy.out"
_CP_LIFECYCLE_LOG="$_SV_ROOT/log/hme-codex-proxy.log"
_CP_POLL_INTERVAL=15
_CP_MISS_THRESHOLD=3

_cp_log() {
  mkdir -p "$(dirname "$_CP_LIFECYCLE_LOG")" 2>/dev/null
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[$ts] [codex-proxy-sv] $*" >> "$_CP_LIFECYCLE_LOG" 2>/dev/null
}

_cp_alive() {
  local p="$1"
  [ -n "$p" ] && [ -d "/proc/$p" ] || return 1
  tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "codex_proxy.js"
}

_cp_healthy() {
  curl -sf --max-time 2 "$_CP_URL" >/dev/null 2>&1
}

_cp_stale() {
  local p="$1"
  [ -n "$p" ] && [ -d "/proc/$p" ] || return 1
  [ "$_CP_SCRIPT" -nt "/proc/$p" ] && return 0
  [ -f "$_CP_OMNI" ] && [ "$_CP_OMNI" -nt "/proc/$p" ] && return 0
  [ -f "$_CP_CONFIG" ] && [ "$_CP_CONFIG" -nt "/proc/$p" ] && return 0
  return 1
}

_cp_spawn() {
  if [ ! -f "$_CP_SCRIPT" ]; then
    _cp_log "spawn aborted: missing $_CP_SCRIPT"
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    _cp_log "spawn aborted: node not on PATH"
    return 1
  fi
  mkdir -p "$_SV_ROOT/log" "$_SV_ROOT/runtime/hme" 2>/dev/null
  HME_CODEX_PROXY_PORT="$_CP_PORT" PROJECT_ROOT="$_SV_ROOT" \
    setsid nohup node "$_CP_SCRIPT" >> "$_CP_LOG" 2>&1 < /dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null
  echo "$pid" > "$_CP_PID_FILE"
  _cp_log "spawned codex_proxy.js pid=$pid port=$_CP_PORT"
}

_cp_start() {
  local p
  p=$(cat "$_CP_PID_FILE" 2>/dev/null)
  if _cp_alive "$p" && _cp_stale "$p"; then
    _cp_log "recorded process stale; restarting pid=$p"
    _cp_stop
    p=""
  fi
  if _cp_healthy; then
    _cp_log "already healthy at $_CP_URL"
    return 0
  fi
  if _cp_alive "$p"; then
    _cp_log "recorded process alive but health not ready pid=$p"
    return 0
  fi
  _cp_spawn
}

_cp_stop() {
  local p
  p=$(cat "$_CP_PID_FILE" 2>/dev/null)
  if _cp_alive "$p"; then
    kill -TERM "$p" 2>/dev/null
    sleep 1
    _cp_alive "$p" && kill -KILL "$p" 2>/dev/null
  fi
  rm -f "$_CP_PID_FILE" 2>/dev/null
  _cp_log "stopped"
}

_cp_status() {
  local p
  p=$(cat "$_CP_PID_FILE" 2>/dev/null)
  echo "pid=$p alive=$(_cp_alive "$p" && echo yes || echo no)"
  echo "health=$(_cp_healthy && echo yes || echo no) url=$_CP_URL"
}

_cp_loop() {
  _cp_start
  local misses=0
  while true; do
    sleep "$_CP_POLL_INTERVAL"
    if _cp_healthy; then
      misses=0
      continue
    fi
    misses=$((misses + 1))
    if [ "$misses" -ge "$_CP_MISS_THRESHOLD" ]; then
      _cp_log "health missed $misses times; respawning"
      _cp_stop
      _cp_spawn
      misses=0
    fi
  done
}

case "${1:-start}" in
  start) _cp_start ;;
  stop) _cp_stop ;;
  status) _cp_status ;;
  _loop) _cp_loop ;;
  watch)
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup bash "$0" _loop >/dev/null 2>&1 < /dev/null &
    else
      nohup bash "$0" _loop >/dev/null 2>&1 < /dev/null &
    fi
    disown $! 2>/dev/null
    ;;
  *) echo "usage: $0 {start|stop|status|watch}" >&2; exit 2 ;;
esac
