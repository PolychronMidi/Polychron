#!/usr/bin/env bash
# Stop the full HME stack: proxy (which supervises worker +
# llamacpp_daemon) and llama-server instances.
#
# Strategy:
#   1. SIGTERM to all known PIDs (from log/hme-pids if present)
#   2. Pattern-based pkill as fallback for anything not in the PID file
#   3. SIGKILL sweep for anything that survived SIGTERM after 3s

set -u

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT_FALLBACK="$(cd "$_LAUNCHER_DIR/../../.." && pwd)"
_ENV_FILE="${_PROJECT_ROOT_FALLBACK}/.env"

if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
fi

PROJECT_ROOT="${PROJECT_ROOT}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
PID_FILE="$PROJECT_ROOT/log/hme-pids"

_term_pid() {
  local pid="$1" label="$2"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null && echo "[shutdown] SIGTERM -> ${label} (${pid})" >&2  # silent-ok: optional fallback path.
  fi
}

_kill_pid() {
  local pid="$1" label="$2"
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null && echo "[shutdown] SIGKILL -> ${label} (${pid})" >&2  # silent-ok: optional fallback path.
  fi
}

# 1. SIGTERM to launcher-tracked PIDs

declare -A _TRACKED_PIDS
if [ -f "$PID_FILE" ]; then
  while IFS='=' read -r label pid; do
    [ -z "$label" ] || [ -z "$pid" ] && continue
    _TRACKED_PIDS["$label"]="$pid"
    _term_pid "$pid" "$label"
  done < "$PID_FILE"
fi

# 2. Service-owned shutdown helpers

_CODEX_PROXY_SUPERVISOR="$PROJECT_ROOT/tools/HME/hooks/direct/codex-proxy-supervisor.sh"
if [ -x "$_CODEX_PROXY_SUPERVISOR" ]; then
  PROJECT_ROOT="$PROJECT_ROOT" "$_CODEX_PROXY_SUPERVISOR" stop >/dev/null 2>&1 || true  # silent-ok: optional fallback path.
fi

# 3. Pattern-based SIGTERM sweep (catches anything not in PID file)

_PATTERNS=()
for _svc in proxy worker llamacpp_daemon codex_proxy omniroute; do
  while IFS= read -r _pat; do
    [ -n "$_pat" ] && _PATTERNS+=("$_pat")
  done < <(_hme_service_process_patterns "$_svc" 2>/dev/null || true)  # silent-ok: optional fallback path.
done
_PATTERNS+=("llama-server.*8080" "llama-server.*8081")
for pat in "${_PATTERNS[@]}"; do
  pkill -TERM -f "$pat" 2>/dev/null && echo "[shutdown] SIGTERM -> $pat" >&2 || true  # silent-ok: optional fallback path.
done

sleep 3

# 4. SIGKILL anything that survived

for label in "${!_TRACKED_PIDS[@]}"; do
  _kill_pid "${_TRACKED_PIDS[$label]}" "$label"
done
for pat in "${_PATTERNS[@]}"; do
  pkill -KILL -f "$pat" 2>/dev/null && echo "[shutdown] SIGKILL -> $pat" >&2 || true  # silent-ok: optional fallback path.
done

# 5. Cleanup

[ -f "$PID_FILE" ] && rm -f "$PID_FILE" && echo "[shutdown] removed $PID_FILE" >&2

# Clear emergency-valve persisted-trip flag so a fresh polychron-restart.sh
_VALVE_FLAG="$PROJECT_ROOT/tmp/hme-proxy-valve-tripped.flag"
[ -f "$_VALVE_FLAG" ] && rm -f "$_VALVE_FLAG" && echo "[shutdown] removed $_VALVE_FLAG (valve state reset)" >&2
# Clear the auto-recovery state file too -- same semantic: deliberate
# restart starts fresh, watchdog respawns inherit.
_VALVE_STATE="$PROJECT_ROOT/tmp/hme-proxy-valve-state.json"
[ -f "$_VALVE_STATE" ] && rm -f "$_VALVE_STATE" && echo "[shutdown] removed $_VALVE_STATE (auto-recovery state reset)" >&2

echo "[shutdown] stack stopped" >&2
