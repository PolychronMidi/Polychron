#!/usr/bin/env bash
# Restart the full HME stack -- shutdown then launch.
# Useful after config changes or when the stack is in a bad state.

set -u

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ENV_FILE="$(cd "$_LAUNCHER_DIR/../../.." && pwd)/.env"
if [ -f "$_ENV_FILE" ]; then set -a; source "$_ENV_FILE"; set +a; fi
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$_LAUNCHER_DIR/../../.." && pwd)}"
source "$PROJECT_ROOT/tools/HME/hooks/helpers/service_registry.sh" 2>/dev/null || true  # silent-ok: optional fallback path.

echo "[restart] shutting down..." >&2
"$_LAUNCHER_DIR/polychron-shutdown.sh"

echo "[restart] waiting for ports to clear..." >&2
_PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"  # silent-ok: optional fallback path.
_waited=0
while [ "$_waited" -lt 15 ]; do
  _proxy_up=$(curl -sf --max-time 1 "http://127.0.0.1:${_PROXY_PORT}/health" > /dev/null 2>&1 && echo 1 || echo 0)
  [ "$_proxy_up" = "0" ] && break
  sleep 1
  _waited=$((_waited + 1))
done
echo "[restart] ports clear after ${_waited}s" >&2

echo "[restart] launching..." >&2
# A restart implies the env was already configured before this run -- the
export HME_NO_AUTOFIX_VSCODE=1
export HME_ALLOW_PROXY_BYPASS=1
exec "$_LAUNCHER_DIR/polychron-launch.sh" "$@"
