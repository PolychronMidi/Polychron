#!/usr/bin/env bash
# Polychron launcher — starts the full HME stack (no VS Code).
#
# Start order:
#   1. HME proxy (supervises worker.py + llamacpp_daemon/ package automatically)
#   2. llama-server instances (arbiter :8080, coder :8081) — if HME_AUTOLAUNCH_LLAMA=1
#   3. Health check — waits for proxy to be ready
#
# Idempotent: each component is skipped if already running on its port.
# PID file: log/hme-pids  — records PIDs started by this launcher for
# polychron-shutdown.sh to target precisely.

set -u
set -o pipefail
# Not using `set -e`: per-component startup is intentionally resilient
# (skip if port already healthy, fall back gracefully). But trap EXIT
# to clean up orphan nohup'd children if the launcher aborts mid-flight
# — without this, a SIGINT during proxy startup left a zombie proxy
# process that the shutdown script couldn't always find later.
_orphan_pids=""
_track_orphan() { _orphan_pids="$_orphan_pids $1"; }
_kill_orphans_on_abort() {
  if [ -n "${_LAUNCH_OK:-}" ]; then return 0; fi
  for _p in $_orphan_pids; do
    if [ -n "$_p" ] && kill -0 "$_p" 2>/dev/null; then
      kill "$_p" 2>/dev/null || true
    fi
  done
}
trap _kill_orphans_on_abort EXIT

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
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_STARTUP_TIMEOUT="${HME_PROXY_STARTUP_TIMEOUT:-25}"

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

# 1. HME proxy

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

# 2. llama-server instances

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

# 3. Initial health check

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

# 4. ANTHROPIC_BASE_URL bridge
#
# .env's ANTHROPIC_BASE_URL is sourced by HME's own scripts but NOT by the
# VSCode Claude Code extension (or any GUI process not launched from a
# .env-aware shell). Without this bridge, the extension's child claude
# binary goes directly to api.anthropic.com, bypassing the proxy and all
# of HME's middleware (status injection, jurisdiction, lifesaver, etc.).
#
# Two-pronged fix:
#   a) Merge ANTHROPIC_BASE_URL into .vscode/settings.json's
#      terminal.integrated.env.{linux,osx,windows} — covers integrated
#      terminal launches of claude (e.g. `claude -p` from VSCode terminal).
#   b) Detect already-running claude binaries that lack the var in their
#      env and warn with a one-line fix command. Covers the case where
#      VSCode itself was launched without sourcing .env, so the extension
#      inherits a clean env and child binaries do too.

if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  _vscode_dir="$PROJECT_ROOT/.vscode"
  mkdir -p "$_vscode_dir"
  python3 - "$_vscode_dir/settings.json" "$ANTHROPIC_BASE_URL" <<'PYEOF' || true
import json, os, sys
path, base_url = sys.argv[1], sys.argv[2]
exists = os.path.exists(path)
if exists:
    with open(path) as f:
        raw = f.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        # VSCode settings.json supports JSONC (comments + trailing commas).
        # Strict json.loads fails on those. Refusing to overwrite is the
        # safe default — a destructive rewrite would wipe the user's
        # config. Print a clear instruction instead.
        print(f"[launch] WARN: .vscode/settings.json is not strict JSON "
              f"(parse error: {exc}). Refusing to auto-edit — please add "
              f"manually:", file=sys.stderr)
        print(f"[launch]   \"terminal.integrated.env.linux\": "
              f"{{\"ANTHROPIC_BASE_URL\": \"{base_url}\"}}", file=sys.stderr)
        sys.exit(0)
else:
    data = {}
changed = False
for key in ("terminal.integrated.env.linux",
            "terminal.integrated.env.osx",
            "terminal.integrated.env.windows"):
    env_block = data.setdefault(key, {})
    if env_block.get("ANTHROPIC_BASE_URL") != base_url:
        env_block["ANTHROPIC_BASE_URL"] = base_url
        changed = True
if changed:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"[launch] .vscode/settings.json updated — "
          f"terminal env injects ANTHROPIC_BASE_URL={base_url}",
          file=sys.stderr)
else:
    print(f"[launch] .vscode/settings.json already injects "
          f"ANTHROPIC_BASE_URL", file=sys.stderr)
PYEOF

  # Detection: any running claude binary missing the env var?
  _bypass_pids=""
  for _pid in $(pgrep -f "anthropic.claude-code.*native-binary/claude" 2>/dev/null); do
    if ! tr '\0' '\n' < "/proc/$_pid/environ" 2>/dev/null | \
         grep -q "^ANTHROPIC_BASE_URL="; then
      _bypass_pids="$_bypass_pids $_pid"
    fi
  done
  if [ -n "$_bypass_pids" ]; then
    echo "[launch] WARN: claude binary(s) running WITHOUT" \
         "ANTHROPIC_BASE_URL — bypassing proxy:" >&2
    echo "[launch]   PIDs:$_bypass_pids" >&2
    echo "[launch]   These won't route through HME middleware." >&2
    echo "[launch]   Fix: close VSCode, then relaunch from a shell" \
         "with .env sourced:" >&2
    echo "[launch]     set -a; source .env; set +a; code ." >&2
  fi
fi

echo "[launch] stack up — PIDs logged to ${PID_FILE}" >&2
# Mark success so the EXIT trap leaves the stack alone.
_LAUNCH_OK=1
