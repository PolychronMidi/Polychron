#!/usr/bin/env bash
# Polychron launcher -- starts the full HME stack (no VS Code).
#
# Start order:
#   1. HME proxy (supervises worker.py + llamacpp_daemon/ package automatically)
#   2. llama-server instances (arbiter :8080, coder :8081) -- if HME_AUTOLAUNCH_LLAMA=1
#   3. Health check -- waits for proxy to be ready
#
# Idempotent: each component is skipped if already running on its port.
# PID file: log/hme-pids  -- records PIDs started by this launcher for
# polychron-shutdown.sh to target precisely.

set -u
set -o pipefail
# Not using `set -e`: per-component startup is intentionally resilient
_orphan_pids=""
_track_orphan() { _orphan_pids="$_orphan_pids $1"; }
_kill_orphans_on_abort() {
  if [ -n "${_LAUNCH_OK:-}" ]; then return 0; fi
  for _p in $_orphan_pids; do
    if [ -n "$_p" ] && kill -0 "$_p" 2>/dev/null; then
      kill "$_p" 2>/dev/null || true  # silent-ok: optional fallback path.
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
  # ANTHROPIC_BASE_URL is now exported in THIS launcher's process tree
else
  echo "[launch] WARNING: .env not found at $_ENV_FILE -- using defaults" >&2
fi

PROJECT_ROOT="${PROJECT_ROOT:-$_PROJECT_ROOT_FALLBACK}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"  # silent-ok: optional fallback path.
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_PID_LABEL="$(_hme_service_pid_label proxy 2>/dev/null || printf '%s' proxy)"  # silent-ok: optional fallback path.
OMNIROUTE_PID_LABEL="$(_hme_service_pid_label omniroute 2>/dev/null || printf '%s' omniroute)"  # silent-ok: optional fallback path.
CODEX_PROXY_PID_LABEL="$(_hme_service_pid_label codex_proxy 2>/dev/null || printf '%s' codex_proxy)"  # silent-ok: optional fallback path.
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

# 0. OmniRoute (OVERDRIVE_MODE=1 translator)
_OMNIROUTE_PORT="$(_hme_service_port omniroute 2>/dev/null || printf '%s' "${HME_OMNIROUTE_PORT:-20128}")"  # silent-ok: optional fallback path.
_OMNIROUTE_URL="http://127.0.0.1:${_OMNIROUTE_PORT}"
_OD_START="${OVERDRIVE_MODE:-0}"
if [ "$_OD_START" = "1" ]; then
  if [ "${HME_OMNIROUTE_OFF:-0}" != "1" ]; then
  _OR_DIR="$PROJECT_ROOT/tools/omniroute"
  if [ -x "$_OR_DIR/start.sh" ]; then
    if _port_healthy "${_OMNIROUTE_URL}/v1/models"; then
      echo "[launch] OmniRoute already up on :${_OMNIROUTE_PORT}" >&2
    else
      echo "[launch] starting OmniRoute on :${_OMNIROUTE_PORT} (OVERDRIVE_MODE=1 translator)..." >&2
      HME_OMNIROUTE_PORT="$_OMNIROUTE_PORT" \
        bash "$_OR_DIR/start.sh" --configure > "$PROJECT_ROOT/log/omniroute.out" 2>&1 &
      _ORPID=$!
      disown 2>/dev/null || true
      _record_pid "$OMNIROUTE_PID_LABEL" "$_ORPID"
      _owaited=0
      while [ "$_owaited" -lt 30 ]; do
        _port_healthy "${_OMNIROUTE_URL}/v1/models" && break
        sleep 1
        _owaited=$((_owaited + 1))
      done
      if _port_healthy "${_OMNIROUTE_URL}/v1/models"; then
        echo "[launch] OmniRoute ready after ${_owaited}s" >&2
      else
        echo "[launch] WARNING: OmniRoute startup timed out -- proxy may fall back to HME_OMNIROUTE_OFF=1" >&2
      fi
    fi
  else
    echo "[launch] WARNING: OmniRoute launcher not found at $_OR_DIR/start.sh -- OVERDRIVE_MODE=1 will fail" >&2
  fi
  fi
fi

# 0b. Codex proxy (optional OpenAI Responses bridge)
_CODEX_PROXY_SUPERVISOR="$PROJECT_ROOT/tools/HME/hooks/direct/codex-proxy-supervisor.sh"
if [ "${HME_CODEX_PROXY_START:-1}" != "0" ] && [ -x "$_CODEX_PROXY_SUPERVISOR" ]; then
  PROJECT_ROOT="$PROJECT_ROOT" "$_CODEX_PROXY_SUPERVISOR" start >/dev/null 2>&1 || \
    echo "[launch] WARNING: codex proxy supervisor start failed" >&2
  _CODEX_PROXY_PID=$(cat "$PROJECT_ROOT/runtime/hme/codex-proxy.pid" 2>/dev/null || true)
  if [ -n "$_CODEX_PROXY_PID" ]; then
    _record_pid "$CODEX_PROXY_PID_LABEL" "$_CODEX_PROXY_PID"
  fi
fi

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
  _record_pid "$PROXY_PID_LABEL" "$_PROXY_PID"

  _waited=0
  while [ "$_waited" -lt "$PROXY_STARTUP_TIMEOUT" ]; do
    _port_healthy "${PROXY_URL}/health" && break
    sleep 1
    _waited=$((_waited + 1))
  done

  if _port_healthy "${PROXY_URL}/health"; then
    echo "[launch] proxy ready after ${_waited}s" >&2
  else
    echo "[launch] ERROR: proxy did not become healthy within ${PROXY_STARTUP_TIMEOUT}s -- aborting" >&2
    exit 1
  fi
fi

# 2. llama-server instances

_llama_healthy() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q '"status":"ok"'  # silent-ok: optional fallback path.
}

_start_llama() {
  local name="$1" port="$2" model="$3" device="$4" alias="$5" ctx="$6"
  if _llama_healthy "$port"; then
    echo "[launch] llama-server ${name} already up on :${port}" >&2
    return 0
  fi
  if [ ! -f "$model" ]; then
    echo "[launch] WARN: llama-server ${name} model not found: $model -- skipping" >&2
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
_proxy_status=$(curl -sf --max-time 3 "${PROXY_URL}/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable")  # silent-ok: optional fallback path.
echo "[launch]   proxy  -> ${_proxy_status}" >&2

_worker_url="$(_hme_service_url worker 2>/dev/null || printf 'http://127.0.0.1:%s/health' "${HME_WORKER_PORT:-9098}")"  # silent-ok: optional fallback path.
_worker_status=$(curl -sf --max-time 3 "$_worker_url" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('phase',''))" 2>/dev/null || echo "starting...")  # silent-ok: optional fallback path.
echo "[launch]   worker -> ${_worker_status}" >&2

if [ "${HME_AUTOLAUNCH_LLAMA:-0}" = "1" ]; then
  _arb_ok=$(_llama_healthy "${HME_ARBITER_PORT:-8080}" && echo "ok" || echo "starting...")
  _cod_ok=$(_llama_healthy "${HME_CODER_PORT:-8081}" && echo "ok" || echo "starting...")
  echo "[launch]   arbiter llama -> ${_arb_ok}" >&2
  echo "[launch]   coder llama   -> ${_cod_ok}" >&2
fi

# 4. Routing readiness check

if [ "${HME_ROUTING_READY_ON_LAUNCH:-1}" != "0" ] && [ -x "$PROJECT_ROOT/tools/HME/tools/HME/scripts/routing_ready.py" ]; then
  echo "[launch] routing-ready check..." >&2
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/tools/HME/tools/HME/scripts/routing_ready.py" 2>&1 | sed 's/^/[launch]   /' >&2
fi

# 5. ANTHROPIC_BASE_URL bridge: VSCode/GUI claude doesn't source .env, so

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
        # safe default -- a destructive rewrite would wipe the user's
        # config. Print a clear instruction instead.
        print(f"[launch] WARN: .vscode/settings.json is not strict JSON "
              f"(parse error: {exc}). Refusing to auto-edit -- please add "
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
    print(f"[launch] .vscode/settings.json updated -- "
          f"terminal env injects ANTHROPIC_BASE_URL={base_url}",
          file=sys.stderr)
else:
    print(f"[launch] .vscode/settings.json already injects "
          f"ANTHROPIC_BASE_URL", file=sys.stderr)
PYEOF

  # Detection + AUTO-FIX: any running claude binary missing the env var?
  _bypass_pids=""
  for _pid in $(pgrep -f "anthropic.claude-code.*native-binary/claude" 2>/dev/null); do  # silent-ok: optional fallback path.
# silent-ok: optional fallback path.
    if ! tr '\0' '\n' < "/proc/$_pid/environ" 2>/dev/null | \
         grep -q "^ANTHROPIC_BASE_URL="; then
      _bypass_pids="$_bypass_pids $_pid"
    fi
  done
  if [ -n "$_bypass_pids" ]; then
    echo "[launch] PROXY BYPASS DETECTED:" >&2
    echo "[launch]   claude binary PIDs:$_bypass_pids running WITHOUT" \
         "ANTHROPIC_BASE_URL" >&2
    echo "[launch]   /v1/messages traffic goes DIRECT to" \
         "api.anthropic.com -- HME middleware is bypassed." >&2

    if [ "${HME_NO_AUTOFIX_VSCODE:-0}" = "1" ]; then
      echo "" >&2
      echo "[launch] HME_NO_AUTOFIX_VSCODE=1 set -- skipping auto-fix." >&2
      echo "[launch] Manual fix:" >&2
      echo "[launch]   1. Close VSCode (and any other claude-code clients)" >&2
      echo "[launch]   2. Confirm no rogue claude binaries:" >&2
      echo "[launch]        pgrep -af 'anthropic.claude-code.*native-binary/claude'" >&2
      echo "[launch]   3. Relaunch from a shell with .env sourced:" >&2
      echo "[launch]        set -a; source .env; set +a; code ." >&2
      echo "[launch]   4. Re-run this launcher" >&2
      if [ "${HME_ALLOW_PROXY_BYPASS:-0}" != "1" ]; then
        exit 1
      fi
      echo "[launch] HME_ALLOW_PROXY_BYPASS=1 -- continuing despite bypass" >&2
    else
      # AUTO-FIX path: kill bypassing claude binaries + every VSCode
      echo "" >&2
      echo "[launch] AUTO-FIX: killing bypassing processes and" \
           "relaunching VSCode with sourced env" >&2

      # Save any open VSCode workspace state -- VSCode auto-restores on
      _code_pids=$(pgrep -f "(^|/)code( |--type|$)|electron.*vscode" 2>/dev/null | tr '\n' ' ')  # silent-ok: optional fallback path.
      _code_pids="$_code_pids $_bypass_pids"
      # Defense-in-depth: never SIGTERM our own ancestor chain. Walk
      _ancestor_pids=" "
      _walk_pid=$$
      while [ -n "$_walk_pid" ] && [ "$_walk_pid" != "0" ] && [ "$_walk_pid" != "1" ]; do
        _ancestor_pids="$_ancestor_pids$_walk_pid "
        _walk_pid=$(awk '/^PPid:/ {print $2}' "/proc/$_walk_pid/status" 2>/dev/null)  # silent-ok: optional fallback path.
      done
      for _pid in $_code_pids; do
        if [ -n "$_pid" ]; then
          case "$_ancestor_pids" in
            *" $_pid "*)
              echo "[launch] SKIP kill on ancestor pid $_pid" \
                   "(would SIGTERM the caller)" >&2
              ;;
            *)
              kill "$_pid" 2>/dev/null || true  # silent-ok: optional fallback path.
              ;;
          esac
        fi
      done
      sleep 2
      # Hard kill anything still alive after SIGTERM grace period.
      # Same ancestor-skip rule as the SIGTERM pass above.
      for _pid in $_code_pids; do
        if [ -n "$_pid" ]; then
          case "$_ancestor_pids" in
            *" $_pid "*) ;;  # skip ancestor
            *) kill -9 "$_pid" 2>/dev/null || true ;;  # silent-ok: optional fallback path.
          esac
        fi
      done
      sleep 1

      _code_bin=$(command -v code 2>/dev/null || echo "/usr/bin/code")  # silent-ok: optional fallback path.
      if [ ! -x "$_code_bin" ]; then
        echo "[launch] WARN: 'code' binary not found at $_code_bin --" \
             "cannot auto-relaunch VSCode" >&2
        echo "[launch] Manual fix: set -a; source .env; set +a; code ." >&2
        if [ "${HME_ALLOW_PROXY_BYPASS:-0}" != "1" ]; then exit 1; fi
      else
        # Launch VSCode in a new session, fully detached. The launcher's
        ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
          PROJECT_ROOT="$PROJECT_ROOT" \
          setsid nohup "$_code_bin" "$PROJECT_ROOT" \
            > "$PROJECT_ROOT/log/vscode-relaunch.out" 2>&1 < /dev/null &
        _vscode_pid=$!
        disown 2>/dev/null || true
        echo "[launch] VSCode relaunched (pid $_vscode_pid) with" \
             "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL" >&2

        # Verify after a short delay -- new claude extension binary
        # should spawn within a few seconds and inherit the env.
        sleep 6
        _new_bypass=""
        for _pid in $(pgrep -f "anthropic.claude-code.*native-binary/claude" 2>/dev/null); do  # silent-ok: optional fallback path.
# silent-ok: optional fallback path.
          if ! tr '\0' '\n' < "/proc/$_pid/environ" 2>/dev/null | \
               grep -q "^ANTHROPIC_BASE_URL="; then
            _new_bypass="$_new_bypass $_pid"
          fi
        done
        if [ -n "$_new_bypass" ]; then
          echo "[launch] WARN: post-relaunch bypass still detected" \
               "on PIDs:$_new_bypass" >&2
          echo "[launch]   the relaunched VSCode did not propagate the" \
               "env to the claude extension." >&2
          echo "[launch]   This usually means the launcher's own env" \
               "lacks ANTHROPIC_BASE_URL -- check .env." >&2
          if [ "${HME_ALLOW_PROXY_BYPASS:-0}" != "1" ]; then exit 1; fi
        else
          echo "[launch] AUTO-FIX succeeded -- new VSCode session has" \
               "ANTHROPIC_BASE_URL set; proxy is now in the path" >&2
        fi
      fi
    fi
  fi
fi

echo "[launch] stack up -- PIDs logged to ${PID_FILE}" >&2

# Always (re)launch VS Code with ANTHROPIC_BASE_URL in its environ, even
if [ "${HME_NO_LAUNCH_VSCODE:-0}" != "1" ]; then
  _code_bin=$(command -v code 2>/dev/null || echo "/usr/bin/code")  # silent-ok: optional fallback path.
  if [ ! -x "$_code_bin" ]; then
    echo "[launch] note: 'code' binary not found at $_code_bin -- skip VS Code spawn" >&2
  elif ! command -v systemd-run >/dev/null 2>&1; then
    echo "[launch] note: systemd-run not available -- cannot guarantee" \
         "VS Code survives ancestor-kill. Skipping VS Code spawn." >&2
  else
    _vscode_running=$(pgrep -f "(^|/)code( |--type|$)|electron.*vscode" 2>/dev/null | head -1)  # silent-ok: optional fallback path.
    # Spawn the NEW VS Code FIRST in a transient systemd-user scope so
    _setenv_args=(
      "--setenv=ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
      "--setenv=PROJECT_ROOT=$PROJECT_ROOT"
    )
    [ -n "${DISPLAY:-}" ]                  && _setenv_args+=("--setenv=DISPLAY=$DISPLAY")
    # Right-side `${VAR:-}` is semantically identical to bare `$VAR` here
    [ -n "${WAYLAND_DISPLAY:-}" ]          && _setenv_args+=("--setenv=WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}")
    [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && _setenv_args+=("--setenv=DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-}")
    [ -n "${XDG_RUNTIME_DIR:-}" ]          && _setenv_args+=("--setenv=XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-}")
    [ -n "${XAUTHORITY:-}" ]               && _setenv_args+=("--setenv=XAUTHORITY=${XAUTHORITY:-}")
    [ -n "${HOME:-}" ]                     && _setenv_args+=("--setenv=HOME=$HOME")
    [ -n "${USER:-}" ]                     && _setenv_args+=("--setenv=USER=$USER")
    [ -n "${PATH:-}" ]                     && _setenv_args+=("--setenv=PATH=$PATH")
    _scope_unit="vscode-proxy-$(date +%s).scope"
    if [ -n "$_vscode_running" ]; then
      echo "[launch] existing VS Code (pid=$_vscode_running) will be killed" \
           "after fresh one starts. Active sessions end now." >&2
    fi
    echo "[launch] spawning fresh VS Code via systemd-run (unit=$_scope_unit," \
         "log=$PROJECT_ROOT/log/vscode-launch.out)..." >&2
    systemd-run --user --scope --collect --unit="$_scope_unit" \
      "${_setenv_args[@]}" \
      "$_code_bin" "$PROJECT_ROOT" \
      > "$PROJECT_ROOT/log/vscode-launch.out" 2>&1 &
    disown
    sleep 2
    if [ -n "$_vscode_running" ]; then
      pkill -f "(^|/)code( |--type|$)|electron.*vscode" 2>/dev/null || true  # silent-ok: optional fallback path.
      sleep 1
      pkill -9 -f "(^|/)code( |--type|$)|electron.*vscode" 2>/dev/null || true  # silent-ok: optional fallback path.
    fi
  fi
fi

# Mark success so the EXIT trap leaves the stack alone.
_LAUNCH_OK=1
