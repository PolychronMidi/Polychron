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

# ── llama-server cold boot (arbiter :8080, coder :8081) ──────────────────────
# sessionstart.sh can start these too but is gated on HME_AUTOLAUNCH_LLAMA=1
# and runs AFTER Claude Code spawns — inference needs to be ready at first tool
# call, so we bring it up here. Same health-probe-then-nohup pattern as the
# proxy above. Skipped unless HME_AUTOLAUNCH_LLAMA=1 and the binary exists.
_llama_healthy() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q '"status":"ok"'
}
_start_llama() {
  local name="$1" port="$2" model="$3" device="$4" alias="$5" ctx="$6"
  if _llama_healthy "$port"; then
    echo "[polychron-launch] llama-server ${name} already up on :${port}" >&2
    return 0
  fi
  if [ ! -f "$model" ]; then
    echo "[polychron-launch] WARN: llama-server ${name} model missing: $model" >&2
    return 1
  fi
  local log="$PROJECT_ROOT/log/llama-server-${name}.log"
  setsid nohup "$HME_LLAMA_SERVER_BIN" \
    --model "$model" --host 127.0.0.1 --port "$port" \
    --ctx-size "$ctx" --n-gpu-layers 999 --device "$device" \
    --alias "$alias" --timeout 30 --jinja \
    >> "$log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  echo "[polychron-launch] llama-server ${name} started on :${port} ${device}" >&2
}
if [ "${HME_AUTOLAUNCH_LLAMA:-0}" = "1" ] && [ -x "${HME_LLAMA_SERVER_BIN:-}" ]; then
  _start_llama arbiter \
    "${HME_ARBITER_PORT:?HME_ARBITER_PORT not in .env}" \
    "${HME_ARBITER:?HME_ARBITER not in .env}" \
    "${HME_ARBITER_VULKAN:?HME_ARBITER_VULKAN not in .env}" \
    "${HME_ARBITER_MODEL:?HME_ARBITER_MODEL not in .env}" \
    "${HME_ARBITER_CTX:?HME_ARBITER_CTX not in .env}"
  _start_llama coder \
    "${HME_CODER_PORT:?HME_CODER_PORT not in .env}" \
    "${HME_CODER:?HME_CODER not in .env}" \
    "${HME_CODER_VULKAN:?HME_CODER_VULKAN not in .env}" \
    "${HME_CODER_ALIAS:?HME_CODER_ALIAS not in .env}" \
    "${HME_CODER_CTX:?HME_CODER_CTX not in .env}"
fi

# Launch VS Code. `exec` replaces this shell so there's no extra process.
# If VS Code is already running, this opens the project in the existing window.
exec code "$PROJECT_ROOT" "$@"
