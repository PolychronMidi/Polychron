#!/usr/bin/env bash
# Polychron launcher — starts the HME proxy, waits for health, then launches
# VS Code with ANTHROPIC_BASE_URL pointing at the proxy. Solves the chicken-
# and-egg problem where sessionstart.sh launches the proxy but Claude Code
# reads ANTHROPIC_BASE_URL at process start, before any hook has run.
#
# Idempotent: if the proxy is already up, reuses it. If it fails to start
# within the timeout, launches VS Code WITHOUT the base URL (degraded mode —
# Anthropic calls go direct, middleware inactive, but session is usable).

set -u

PROJECT_ROOT="${PROJECT_ROOT:-/home/jah/Polychron}"
PROXY_PORT="${HME_PROXY_PORT:-9099}"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_STARTUP_TIMEOUT=25

_proxy_healthy() {
  curl -sf --max-time 1 "${PROXY_URL}/health" > /dev/null 2>&1
}

if ! _proxy_healthy; then
  echo "[polychron-launch] starting HME proxy..." >&2
  cd "$PROJECT_ROOT"
  mkdir -p log
  # setsid detaches into a new session so the proxy survives this launcher
  # exiting (and any shell/IDE that spawned it).
  HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node tools/HME/proxy/hme_proxy.js \
      > log/hme-proxy.out 2>&1 < /dev/null &
  disown 2>/dev/null || true

  # Wait for /health with a cap.
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
  echo "[polychron-launch] WARNING: proxy did not start within ${PROXY_STARTUP_TIMEOUT}s — launching VS Code WITHOUT ANTHROPIC_BASE_URL (degraded mode)" >&2
fi

# Launch VS Code. `exec` replaces this shell so there's no extra process.
# If VS Code is already running, this opens the project in the existing window.
exec code "$PROJECT_ROOT" "$@"
