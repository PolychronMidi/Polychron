#!/usr/bin/env bash
# Polychron launcher — starts the full HME stack (no VS Code), then opens
# the chat UI in Chromium.
#
# Start order:
#   1. HME proxy (supervises worker.py + llamacpp_daemon.py automatically)
#   2. llama-server instances (arbiter :8080, coder :8081) — if HME_AUTOLAUNCH_LLAMA=1
#   3. HME chat server (out/server.js on HME_CHAT_PORT, default 3131)
#   4. Health check — waits for proxy + chat to be ready
#   5. Chromium → chat URL
#
# Idempotent: each component is skipped if already running on its port.
# PID file: log/hme-pids  — records PIDs started by this launcher for
# polychron-shutdown.sh to target precisely.

set -u

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT_FALLBACK="$(cd "$_LAUNCHER_DIR/../../.." && pwd)"
_ENV_FILE="${_PROJECT_ROOT_FALLBACK}/.env"

if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "[launch] WARNING: .env not found at $_ENV_FILE — using defaults" >&2
fi

PROJECT_ROOT="${PROJECT_ROOT:-$_PROJECT_ROOT_FALLBACK}"
PROXY_PORT="${HME_PROXY_PORT:-9099}"
CHAT_PORT="${HME_CHAT_PORT:-3131}"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
CHAT_URL="http://localhost:${CHAT_PORT}"
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-25}"
CHAT_STARTUP_TIMEOUT=15

PID_FILE="$PROJECT_ROOT/log/hme-pids"
mkdir -p "$PROJECT_ROOT/log"
# Start with a fresh PID file each launch
> "$PID_FILE"

_record_pid() {
  local label="$1" pid="$2"
  echo "${label}=${pid}" >> "$PID_FILE"
  echo "[launch] started ${label} (pid ${pid})" >&2
}

_port_healthy() {
  curl -sf --max-time 1 "$1" > /dev/null 2>&1
}

# 1. HME proxy ─

if _port_healthy "${PROXY_URL}/health"; then
  echo "[launch] proxy already up on :${PROXY_PORT}" >&2
else
  echo "[launch] starting HME proxy on :${PROXY_PORT}..." >&2
  cd "$PROJECT_ROOT"
  HME_PROXY_PORT="$PROXY_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node "$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js" \
      > "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 < /dev/null &
  _PROXY_PID=$!
  disown 2>/dev/null || true
  _record_pid proxy "$_PROXY_PID"

  _waited=0
  while [ "$_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
    _port_healthy "${PROXY_URL}/health" && break
    sleep 1
    _waited=$((_waited + 1))
  done

  if _port_healthy "${PROXY_URL}/health"; then
    echo "[launch] proxy ready after ${_waited}s" >&2
  else
    echo "[launch] ERROR: proxy did not become healthy within ${PROXY_STARTUP_TIMEOUT}s — aborting" >&2
    exit 1
  fi
fi

# 2. llama-server instances ─

_llama_healthy() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q '"status":"ok"'
}

_start_llama() {
  local name="$1" port="$2" model="$3" device="$4" alias="$5" ctx="$6"
  if _llama_healthy "$port"; then
    echo "[launch] llama-server ${name} already up on :${port}" >&2
    return 0
  fi
  if [ ! -f "$model" ]; then
    echo "[launch] WARN: llama-server ${name} model not found: $model — skipping" >&2
    return 1
  fi
  local log="$PROJECT_ROOT/log/llama-server-${name}.log"
  setsid nohup "$HME_LLAMA_SERVER_BIN" \
    --model "$model" --host 127.0.0.1 --port "$port" \
    --ctx-size "$ctx" --n-gpu-layers 999 --device "$device" \
    --alias "$alias" --timeout 30 --jinja \
    >> "$log" 2>&1 < /dev/null &
  local _pid=$!
  disown 2>/dev/null || true
  _record_pid "llama-${name}" "$_pid"
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

# 3. HME chat server

if _port_healthy "${CHAT_URL}/api/health" || _port_healthy "${CHAT_URL}"; then
  echo "[launch] chat server already up on :${CHAT_PORT}" >&2
else
  # Compile TS → JS if any source file is newer than its compiled counterpart,
  # or if out/ is missing entirely. Keeps running server untouched when no-op.
  _chat_dir="$PROJECT_ROOT/tools/HME/chat"
  _needs_build=0
  if [ ! -f "$_chat_dir/out/server.js" ]; then
    _needs_build=1
  elif [ -n "$(find "$_chat_dir/src" -name '*.ts' -newer "$_chat_dir/out/server.js" -print -quit 2>/dev/null)" ]; then
    _needs_build=1
  fi
  if [ "$_needs_build" = 1 ]; then
    echo "[launch] compiling chat TS → JS..." >&2
    if ! (cd "$_chat_dir" && npx tsc -p . > "$PROJECT_ROOT/log/hme-chat-build.log" 2>&1); then
      echo "[launch] ERROR: tsc failed — see $PROJECT_ROOT/log/hme-chat-build.log" >&2
      exit 1
    fi
  fi
  echo "[launch] starting HME chat server on :${CHAT_PORT}..." >&2
  cd "$PROJECT_ROOT/tools/HME/chat"
  HME_CHAT_PORT="$CHAT_PORT" PROJECT_ROOT="$PROJECT_ROOT" \
    setsid nohup node out/server.js \
      > "$PROJECT_ROOT/log/hme-chat.out" 2>&1 < /dev/null &
  _CHAT_PID=$!
  disown 2>/dev/null || true
  _record_pid chat "$_CHAT_PID"

  _waited=0
  while [ "$_waited" -lt "$CHAT_STARTUP_TIMEOUT" ]; do
    (_port_healthy "${CHAT_URL}/api/health" || _port_healthy "${CHAT_URL}") && break
    sleep 1
    _waited=$((_waited + 1))
  done

  if _port_healthy "${CHAT_URL}/api/health" || _port_healthy "${CHAT_URL}"; then
    echo "[launch] chat ready after ${_waited}s" >&2
  else
    echo "[launch] WARN: chat server not responding after ${CHAT_STARTUP_TIMEOUT}s — opening URL anyway" >&2
  fi
fi

# 4. Initial health check ─

echo "[launch] health check..." >&2
_proxy_status=$(curl -sf --max-time 3 "${PROXY_URL}/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable")
echo "[launch]   proxy  → ${_proxy_status}" >&2

_worker_status=$(curl -sf --max-time 3 "http://127.0.0.1:9098/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null || echo "starting...")
echo "[launch]   worker → ${_worker_status}" >&2

if [ "${HME_AUTOLAUNCH_LLAMA:-0}" = "1" ]; then
  _arb_ok=$(_llama_healthy "${HME_ARBITER_PORT:-8080}" && echo "ok" || echo "starting...")
  _cod_ok=$(_llama_healthy "${HME_CODER_PORT:-8081}" && echo "ok" || echo "starting...")
  echo "[launch]   arbiter llama → ${_arb_ok}" >&2
  echo "[launch]   coder llama   → ${_cod_ok}" >&2
fi

# 5. Open Chromium

echo "[launch] opening ${CHAT_URL}" >&2
(chromium --app="${CHAT_URL}" 2>/dev/null \
  || chromium-browser --app="${CHAT_URL}" 2>/dev/null \
  || xdg-open "${CHAT_URL}" 2>/dev/null) &
disown 2>/dev/null || true

echo "[launch] stack up — PIDs logged to ${PID_FILE}" >&2
