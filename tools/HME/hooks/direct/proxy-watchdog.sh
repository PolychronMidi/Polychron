#!/usr/bin/env bash
# proxy-watchdog.sh — SessionStart hook that detects proxy-down and
# respawns the HME proxy. Idempotent: if the proxy is already alive, no-op.
#
# Why this exists:
# ---------------
# When the HME proxy dies (crash, OOM, manual kill), nothing brings it
# back. Every subsequent session operates with LIFESAVER / KB briefing /
# jurisdiction injection silently offline. The fail-LOUD banner in
# _proxy_bridge.sh tells the user when it's down, but doesn't fix it.
#
# This watchdog runs at SessionStart, probes the proxy's /health, and
# spawns it via the same setsid nohup pattern polychron-launch.sh uses
# if unreachable. It does NOT start the llama-server or other children —
# only the proxy itself. Single responsibility.
#
# Safety:
#  - MUST NOT source _safety.sh (set -euo pipefail can kill the watchdog
#    before it reaches the spawn step)
#  - MUST exit 0 unconditionally (SessionStart blocking wedges Claude Code)
#  - MUST consume stdin so the hook caller doesn't block

set +e
cat >/dev/null 2>&1

# Resolve repo root. BASH_SOURCE-relative ascent is UNSAFE from the
# plugin-cache path (lands in ~/.claude/plugins/cache/). Prefer
# CLAUDE_PROJECT_DIR, then hardcoded fallback.
_WD_ROOT=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _WD_ROOT="$CLAUDE_PROJECT_DIR"
fi
[ -z "$_WD_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _WD_ROOT="/home/jah/Polychron"

_WD_PORT="${HME_PROXY_PORT:-9099}"
_WD_URL="http://127.0.0.1:${_WD_PORT}/health"

# Probe: if proxy already healthy, exit silent.
if curl -sf --max-time 2 "$_WD_URL" >/dev/null 2>&1; then
  exit 0
fi

# Not healthy. Attempt spawn. Prereq: node binary + proxy script.
_WD_SCRIPT="$_WD_ROOT/tools/HME/proxy/hme_proxy.js"
if [ ! -f "$_WD_SCRIPT" ]; then
  # Log but don't fail. The fail-LOUD banner from _proxy_bridge.sh will
  # still surface the proxy-down state on next UserPromptSubmit.
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  mkdir -p "$_WD_ROOT/log" 2>/dev/null
  echo "[$ts] [proxy-watchdog] SessionStart: proxy down AND hme_proxy.js missing at $_WD_SCRIPT" \
    >> "$_WD_ROOT/log/hme-errors.log" 2>/dev/null
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  mkdir -p "$_WD_ROOT/log" 2>/dev/null
  echo "[$ts] [proxy-watchdog] SessionStart: proxy down AND node binary not on PATH" \
    >> "$_WD_ROOT/log/hme-errors.log" 2>/dev/null
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
    # Clear the sticky proxy-down flag — the next UserPromptSubmit
    # should not emit the offline banner.
    rm -f "$_WD_ROOT/tmp/hme-proxy-down.flag" 2>/dev/null
    # Emit a one-shot recovery note into hme-errors.log so the log
    # captures the recovery as well as the failure.
    echo "[$ts] [proxy-watchdog] proxy respawned (pid=$_WD_PID) after ${_waited}s" \
      >> "$_WD_ROOT/log/hme-errors.log" 2>/dev/null
    exit 0
  fi
  sleep 1
  _waited=$((_waited + 1))
done

# Spawn attempted but not healthy. Log and let _proxy_bridge.sh's
# fail-LOUD banner take over.
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
echo "[$ts] [proxy-watchdog] spawn attempted (pid=$_WD_PID) but proxy still not responding after 8s" >&2
echo "[$ts] [proxy-watchdog] spawn attempted (pid=$_WD_PID) but proxy still not responding after 8s" \
  >> "$_WD_ROOT/log/hme-errors.log" 2>/dev/null
exit 0
