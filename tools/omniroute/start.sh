#!/usr/bin/env bash
# Start OmniRoute for HME MODE=4 integration.
# Usage: ./start.sh [--port PORT] [--configure]
#   --port PORT    Override default port (20128)
#   --configure     Also configure the opencode-go credential
#   --foreground    Run in foreground (default: background + disown)
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="20128"
DO_CONFIGURE=0
FOREGROUND=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --configure) DO_CONFIGURE=1; shift ;;
    --foreground) FOREGROUND=1; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

cd "$SCRIPT_DIR"

# Source project .env for credentials
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
PROJECT_ENV="${PROJECT_ROOT}/.env"
if [ -f "$PROJECT_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROJECT_ENV"
  set +a
fi

# Check if already running
if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1; then
  echo "[omniroute] already running on :${PORT}"
else
  echo "[omniroute] starting on :${PORT}..."
  HME_OMNIROUTE_PORT="$PORT" \
    node_modules/.bin/omniroute --no-open --port "$PORT" &
  ORPID=$!
  echo "[omniroute] pid=${ORPID}"

  if [ "$FOREGROUND" -eq 1 ]; then
    wait "$ORPID"
    exit $?
  fi

  disown 2>/dev/null || true

  # Wait for health
  _waited=0
  while [ "$_waited" -lt 20 ]; do
    curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1 && break
    sleep 1
    _waited=$((_waited + 1))
  done

  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" > /dev/null 2>&1; then
    echo "[omniroute] ready after ${_waited}s"
  else
    echo "[omniroute] WARNING: startup timed out after ${_waited}s"
  fi
fi

# Configure provider credentials
if [ "$DO_CONFIGURE" -eq 1 ]; then
  OPENCODE_KEY="${OPENCODE_API_KEY:-}"
  if [ -z "$OPENCODE_KEY" ]; then
    echo "[omniroute] OPENCODE_API_KEY not set -- skipping credential setup"
    exit 0
  fi

  # Login
  LOGIN=$(curl -sf -c /tmp/omni-setup-cookies.txt -X POST \
    "http://127.0.0.1:${PORT}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"password":"polychron"}' 2>&1) || true

  if ! echo "$LOGIN" | grep -q '"success":true'; then
    echo "[omniroute] login failed: $LOGIN"
    exit 1
  fi

  # Check if already configured
  EXISTING=$(curl -sf -b /tmp/omni-setup-cookies.txt \
    "http://127.0.0.1:${PORT}/api/providers?provider=opencode-go" 2>&1) || true

  if echo "$EXISTING" | grep -q '"apiKey"'; then
    echo "[omniroute] opencode-go already configured"
  else
    echo "[omniroute] adding opencode-go connection..."
    RESULT=$(curl -sf -b /tmp/omni-setup-cookies.txt -X POST \
      "http://127.0.0.1:${PORT}/api/providers" \
      -H "Content-Type: application/json" \
      -d "{\"provider\":\"opencode-go\",\"apiKey\":\"${OPENCODE_KEY}\",\"name\":\"Polychron HME\"}" 2>&1) || true

    if echo "$RESULT" | grep -q '"connection"'; then
      echo "[omniroute] opencode-go configured successfully"
    else
      echo "[omniroute] opencode-go setup failed: $RESULT"
    fi
  fi
  rm -f /tmp/omni-setup-cookies.txt
fi
