#!/usr/bin/env bash
# proxy-watchdog.sh: SessionStart hook -- probe proxy /health, respawn via
# setsid+nohup if unreachable. Idempotent. Single responsibility (proxy only,
# not children). Constraints: no _safety.sh (set -euo would kill spawn step),
# always exit 0 (SessionStart block wedges Claude Code), consume stdin.

set +e
cat >/dev/null 2>&1

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_WD_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _WD_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _WD_ROOT="$CLAUDE_PROJECT_DIR"
else
  _wd_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
  while [ -n "$_wd_try" ] && [ "$_wd_try" != "/" ]; do
    if [ -d "$_wd_try/.git" ] && [ -d "$_wd_try/src" ]; then
      _WD_ROOT="$_wd_try"
      break
    fi
    _wd_try="$(dirname "$_wd_try")"
  done
fi
if [ -z "$_WD_ROOT" ]; then
  echo "[proxy-watchdog] cannot resolve project root; exiting" >&2
  exit 0
fi
PROJECT_ROOT="$_WD_ROOT"
source "$_WD_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true

_WD_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"
_WD_URL="$(_hme_service_url proxy 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_WD_PORT")"

# -- OmniRoute health-check + respawn (MODE=4/5 main-agent translator) --
# Session resume doesn't go through polychron-launch.sh, so the watchdog
# must ensure OmniRoute is running before attempting proxy spawn.
_OR_PORT="$(_hme_service_port omniroute)"
_OR_URL="$(_hme_service_url omniroute 2>/dev/null || printf 'http://127.0.0.1:%s/v1/models' "$_OR_PORT")"
_OR_DIR="$_WD_ROOT/tools/omniroute"
if [ "${OVERDRIVE_MODE:-0}" = "4" ] || [ "${OVERDRIVE_MODE:-0}" = "5" ] || [ "${OVERDRIVE_MODE:-0}" = "6" ]; then
  if [ "${HME_OMNIROUTE_OFF:-0}" != "1" ]; then
  if ! curl -sf --max-time 2 "$_OR_URL" >/dev/null 2>&1; then
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    echo "[$ts] [proxy-watchdog] OmniRoute down, starting on :${_OR_PORT}..." >&2
    if [ -x "$_OR_DIR/start.sh" ]; then
      HME_OMNIROUTE_PORT="$_OR_PORT" \
        bash "$_OR_DIR/start.sh" > "$_WD_ROOT/log/omniroute.out" 2>&1 &
      _ORPID=$!
      disown 2>/dev/null || true
      _or_waited=0
      while [ "$_or_waited" -lt 15 ]; do
        curl -sf --max-time 2 "$_OR_URL" >/dev/null 2>&1 && break
        sleep 1
        _or_waited=$((_or_waited + 1))
      done
      if curl -sf --max-time 2 "$_OR_URL" >/dev/null 2>&1; then
        echo "[$ts] [proxy-watchdog] OmniRoute ready after ${_or_waited}s (pid=$_ORPID)" >&2
      else
        echo "[$ts] [proxy-watchdog] OmniRoute startup timed out after ${_or_waited}s -- proxy may use passthrough" >&2
        echo "[$ts] [proxy-watchdog] OmniRoute startup timed out after ${_or_waited}s" \
          >> "$_WD_ROOT/log/hme-errors.log"
      fi
    else
      echo "[$ts] [proxy-watchdog] OmniRoute launcher missing at $_OR_DIR/start.sh -- MODE=4 will fail" >&2
      echo "[$ts] [proxy-watchdog] OmniRoute launcher missing at $_OR_DIR/start.sh" \
        >> "$_WD_ROOT/log/hme-errors.log"
    fi
  fi
  fi
fi

# Probe: if proxy already healthy, exit silent.
if curl -sf --max-time 2 "$_WD_URL" >/dev/null 2>&1; then
  exit 0
fi

# Not healthy. Attempt spawn. Prereq: node binary + proxy script.
_WD_SCRIPT="$_WD_ROOT/tools/HME/proxy/hme_proxy.js"
if [ ! -f "$_WD_SCRIPT" ]; then
  # Log but don't fail. The fail-LOUD banner from claude_adapter.js will
  # still surface the proxy-down state on next UserPromptSubmit.
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  mkdir -p "$_WD_ROOT/log" 2>/dev/null
  # FAIL-LOUD on alert-sink writes (see claude_adapter.js rationale).
  echo "[$ts] [proxy-watchdog] SessionStart: proxy down AND hme_proxy.js missing at $_WD_SCRIPT" \
    >> "$_WD_ROOT/log/hme-errors.log"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  mkdir -p "$_WD_ROOT/log" 2>/dev/null
  echo "[$ts] [proxy-watchdog] SessionStart: proxy down AND node binary not on PATH" \
    >> "$_WD_ROOT/log/hme-errors.log"
  exit 0
fi

# Spawn the proxy. Match the pattern polychron-launch.sh uses:
# setsid + nohup + disown so the proxy survives this hook exiting.
# Env: PROJECT_ROOT and HME_PROXY_PORT explicit; stdout/stderr to
# log/hme-proxy.out; stdin closed.
mkdir -p "$_WD_ROOT/log" "$_WD_ROOT/tmp" 2>/dev/null
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
echo "[$ts] [proxy-watchdog] SessionStart: proxy down, attempting respawn..." >&2

HME_PROXY_PORT="$_WD_PORT" PROJECT_ROOT="$_WD_ROOT" \
  setsid nohup node "$_WD_SCRIPT" \
  >> "$_WD_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
_WD_PID=$!
disown 2>/dev/null || true

# Poll for health. Bounded by SessionStart hook timeout (15s in
# settings.json). Give the proxy up to 8s to bind the port, leaving
# margin for the rest of SessionStart.
_waited=0
while [ "$_waited" -lt 8 ]; do
  if curl -sf --max-time 1 "$_WD_URL" >/dev/null 2>&1; then
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    echo "[$ts] [proxy-watchdog] proxy respawned (pid=$_WD_PID) after ${_waited}s" >&2
    # Clear the sticky proxy-down flag -- the next UserPromptSubmit
    # should not emit the offline banner.
    rm -f "$_WD_ROOT/tmp/hme-proxy-down.flag" 2>/dev/null
    # Emit a one-shot recovery note into hme-errors.log so the log
    # captures the recovery as well as the failure.
    echo "[$ts] [proxy-watchdog] proxy respawned (pid=$_WD_PID) after ${_waited}s" \
      >> "$_WD_ROOT/log/hme-errors.log"
    exit 0
  fi
  sleep 1
  _waited=$((_waited + 1))
done

# Spawn attempted but not healthy. Log and let claude_adapter.js's
# fail-LOUD banner take over.
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
echo "[$ts] [proxy-watchdog] spawn attempted (pid=$_WD_PID) but proxy still not responding after 8s" >&2
echo "[$ts] [proxy-watchdog] spawn attempted (pid=$_WD_PID) but proxy still not responding after 8s" \
  >> "$_WD_ROOT/log/hme-errors.log"
exit 0
