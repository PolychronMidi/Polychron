#!/usr/bin/env bash
# Restart the full HME stack — shutdown then launch.
# Useful after config changes or when the stack is in a bad state.

set -u

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ENV_FILE="$(cd "$_LAUNCHER_DIR/../../.." && pwd)/.env"
if [ -f "$_ENV_FILE" ]; then set -a; source "$_ENV_FILE"; set +a; fi

echo "[restart] shutting down..." >&2
"$_LAUNCHER_DIR/polychron-shutdown.sh"

echo "[restart] waiting for ports to clear..." >&2
_CHAT_PORT="${HME_CHAT_PORT:-3131}"
_PROXY_PORT="${HME_PROXY_PORT:-9099}"
_waited=0
while [ "$_waited" -lt 15 ]; do
  _chat_up=$(curl -sf --max-time 1 "http://localhost:${_CHAT_PORT}" > /dev/null 2>&1 && echo 1 || echo 0)
  _proxy_up=$(curl -sf --max-time 1 "http://127.0.0.1:${_PROXY_PORT}/health" > /dev/null 2>&1 && echo 1 || echo 0)
  [ "$_chat_up" = "0" ] && [ "$_proxy_up" = "0" ] && break
  sleep 1
  _waited=$((_waited + 1))
done
echo "[restart] ports clear after ${_waited}s" >&2

echo "[restart] compiling chat src/..." >&2
(cd "$_LAUNCHER_DIR/../chat" && npx tsc 2>&1) || { echo "[restart] ERROR: tsc failed — aborting" >&2; exit 1; }

echo "[restart] launching..." >&2
exec "$_LAUNCHER_DIR/polychron-launch.sh" "$@"
