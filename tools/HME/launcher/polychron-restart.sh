#!/usr/bin/env bash
# Restart the full HME stack — shutdown then launch.
# Useful after config changes or when the stack is in a bad state.

set -u

_LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[restart] shutting down..." >&2
"$_LAUNCHER_DIR/polychron-shutdown.sh"

echo "[restart] waiting for ports to clear..." >&2
sleep 2

echo "[restart] launching..." >&2
exec "$_LAUNCHER_DIR/polychron-launch.sh" "$@"
