#!/usr/bin/env bash
# proxy-watchdog.sh: SessionStart hook -- probe proxy /health, respawn via
# setsid+nohup if unreachable. Idempotent. Single responsibility (proxy only,
# not children). Constraints: no _safety.sh (set -euo would kill spawn step),
# always exit 0 (SessionStart block wedges Claude Code), consume stdin.

set +e
cat >/dev/null 2>&1

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_WD_ROOT=""
if [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _WD_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _WD_ROOT="$CLAUDE_PROJECT_DIR"
else
  _wd_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # silent-ok: optional fallback path.
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
[ -f "$_WD_ROOT/tools/HME/hooks/helpers/service_registry.sh" ] && source "$_WD_ROOT/tools/HME/hooks/helpers/service_registry.sh"

_WD_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
_WD_URL="$(_hme_service_url proxy 2>/dev/null || printf 'http://127.0.0.1:%s/health' "$_WD_PORT")"  # silent-ok: optional fallback path.

# -- OmniRoute health-check + respawn (OVERDRIVE_MODE=1 translator) --
_OR_PORT="$(_hme_service_port omniroute 2>/dev/null || printf '%s' "${HME_OMNIROUTE_PORT}")"  # silent-ok: optional fallback path.
_OR_URL="$(_hme_service_url omniroute 2>/dev/null || printf 'http://127.0.0.1:%s/v1/models' "$_OR_PORT")"  # silent-ok: optional fallback path.
_OR_DIR="$_WD_ROOT/tools/omniroute"
if [ "${OVERDRIVE_MODE}" = "1" ]; then
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
      echo "[$ts] [proxy-watchdog] OmniRoute launcher missing at $_OR_DIR/start.sh -- MODE=1 will fail" >&2
      echo "[$ts] [proxy-watchdog] OmniRoute launcher missing at $_OR_DIR/start.sh" \
        >> "$_WD_ROOT/log/hme-errors.log"
    fi
  fi
  fi
fi

# Probe: if the whole proxy-owned bundle is healthy, exit silent. A proxy
# that responds while a required child is down still needs a bundle restart.
if curl -sf --max-time 2 "$_WD_URL" >/dev/null 2>&1; then
  if _hme_bundle_health proxy >/dev/null 2>&1; then
    exit 0
  fi
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  _issue="$(_hme_bundle_health proxy 2>&1 || true)"
  echo "[$ts] [proxy-watchdog] proxy bundle unhealthy: ${_issue}" \
    >> "$_WD_ROOT/log/hme-errors.log"
  if [ -x "$_WD_ROOT/tools/HME/launcher/polychron-proxy-restart.sh" ]; then
    setsid nohup "$_WD_ROOT/tools/HME/launcher/polychron-proxy-restart.sh" \
      >> "$_WD_ROOT/log/hme-proxy-lifecycle.log" 2>&1 < /dev/null &
    disown 2>/dev/null || true
  fi
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
mkdir -p "$_WD_ROOT/log" "$_WD_ROOT/tools/HME/runtime" 2>/dev/null
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
echo "[$ts] [proxy-watchdog] SessionStart: proxy down, attempting respawn..." >&2

HME_PROXY_PORT="$_WD_PORT" PROJECT_ROOT="$_WD_ROOT" \
  setsid nohup node "$_WD_SCRIPT" \
  >> "$_WD_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
_WD_PID=$!
disown 2>/dev/null || true

# Poll for health. Bounded by SessionStart hook timeout (15s in
_waited=0
while [ "$_waited" -lt 8 ]; do
  if curl -sf --max-time 1 "$_WD_URL" >/dev/null 2>&1; then
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    echo "[$ts] [proxy-watchdog] proxy respawned (pid=$_WD_PID) after ${_waited}s" >&2
    # Clear the sticky proxy-down flag -- the next UserPromptSubmit
    # should not emit the offline banner.
    rm -f "$_WD_ROOT/tools/HME/runtime/hme-proxy-down.flag" 2>/dev/null
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
