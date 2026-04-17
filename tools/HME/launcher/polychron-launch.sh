#!/usr/bin/env bash
# Polychron launcher — starts the HME proxy, waits for health, then launches
# VS Code with ANTHROPIC_BASE_URL pointing at the proxy. Solves the chicken-
# and-egg problem where sessionstart.sh launches the proxy but Claude Code
# reads ANTHROPIC_BASE_URL at process start, before any hook has run.
#
# Idempotent: if the proxy is already up, reuses it. If it fails to start
# within the timeout, launches VS Code WITHOUT the base URL (degraded mode —
# Anthropic calls go direct, middleware inactive, but session is usable).
#
# Single source of truth: PROJECT_ROOT, HME_PROXY_PORT, ANTHROPIC_BASE_URL,
# and every HME_* variable come from the project .env. The launcher derives
# the .env path from its own file location so the project can move without
# edits here.

set -u

# Find the project root from the launcher's own location. The launcher lives
# at tools/HME/launcher/polychron-launch.sh, so project root is three levels
# above its directory. This keeps the script portable.
_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT_FALLBACK="$(cd "$_LAUNCHER_DIR/../../.." && pwd)"
_ENV_FILE="${_PROJECT_ROOT_FALLBACK}/.env"

# Source .env with auto-export so every variable inside becomes available to
# this shell AND to the VS Code process exec'd at the end. Matches the pattern
# _safety.sh uses for hooks.
if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "[polychron-launch] WARNING: .env not found at $_ENV_FILE — falling back to defaults" >&2
fi

# Resolve config with .env-first, fallback-second precedence.
PROJECT_ROOT="${PROJECT_ROOT:-$_PROJECT_ROOT_FALLBACK}"
PROXY_PORT="${HME_PROXY_PORT:-9099}"
# .env may set ANTHROPIC_BASE_URL (commented by default for safety); honor it
# if present, else derive from the proxy port.
_DEFAULT_PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_URL="${ANTHROPIC_BASE_URL:-$_DEFAULT_PROXY_URL}"

PROXY_STARTUP_TIMEOUT=25

_proxy_healthy() {
  curl -sf --max-time 1 "${PROXY_URL}/health" > /dev/null 2>&1
}

if ! _proxy_healthy; then
  echo "[polychron-launch] starting HME proxy at $PROXY_URL..." >&2
  cd "$PROJECT_ROOT"
  mkdir -p log
  # setsid detaches into a new session so the proxy survives this launcher
  # exiting (and any shell/IDE that spawned it).
  HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
      > "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
  disown 2>/dev/null || true

  for i in $(seq 1 "$PROXY_STARTUP_TIMEOUT"); do
    if _proxy_healthy; then
      echo "[polychron-launch] proxy ready after ${i}s" >&2
      break
    fi
    sleep 1
  done
fi

if _proxy_healthy; then
  export ANTHROPIC_BASE_URL="$PROXY_URL"
  echo "[polychron-launch] ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL" >&2
else
  unset ANTHROPIC_BASE_URL
  echo "[polychron-launch] WARNING: proxy did not start within ${PROXY_STARTUP_TIMEOUT}s — launching VS Code WITHOUT ANTHROPIC_BASE_URL (degraded mode)" >&2
fi

# Launch VS Code. `exec` replaces this shell so there's no extra process.
# If VS Code is already running, this opens the project in the existing window.
exec code "$PROJECT_ROOT" "$@"
