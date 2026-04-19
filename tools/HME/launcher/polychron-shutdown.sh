#!/usr/bin/env bash
# Stop the full HME stack: chat server, proxy (which supervises worker +
# llamacpp_daemon), and llama-server instances.
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

PROJECT_ROOT="${PROJECT_ROOT:-$_PROJECT_ROOT_FALLBACK}"
PID_FILE="$PROJECT_ROOT/log/hme-pids"

_term_pid() {
  local pid="$1" label="$2"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null && echo "[shutdown] SIGTERM → ${label} (${pid})" >&2
  fi
}

_kill_pid() {
  local pid="$1" label="$2"
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null && echo "[shutdown] SIGKILL → ${label} (${pid})" >&2
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

# 2. Pattern-based SIGTERM sweep (catches anything not in PID file)

_PATTERNS=(
  "hme_proxy.js"
  "worker.py"
  "llamacpp_daemon.py"
  "hme-chat"
  "out/server.js"
  "llama-server.*8080"
  "llama-server.*8081"
)
for pat in "${_PATTERNS[@]}"; do
  pkill -TERM -f "$pat" 2>/dev/null && echo "[shutdown] SIGTERM → $pat" >&2 || true
done

sleep 3

# 3. SIGKILL anything that survived

for label in "${!_TRACKED_PIDS[@]}"; do
  _kill_pid "${_TRACKED_PIDS[$label]}" "$label"
done
for pat in "${_PATTERNS[@]}"; do
  pkill -KILL -f "$pat" 2>/dev/null && echo "[shutdown] SIGKILL → $pat" >&2 || true
done

# 4. Cleanup

[ -f "$PID_FILE" ] && rm -f "$PID_FILE" && echo "[shutdown] removed $PID_FILE" >&2

echo "[shutdown] stack stopped" >&2
