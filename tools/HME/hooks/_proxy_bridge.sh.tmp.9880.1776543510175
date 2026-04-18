#!/usr/bin/env bash
# The ONLY Claude-Code-side hook. Stateless forwarder: POSTs stdin to the
# proxy's /hme/lifecycle endpoint with ?event=<EventName>, relays the
# JSON response {stdout, stderr, exit_code} back to Claude Code's plugin
# machinery as actual stdout/stderr/exit.
#
# All hook LOGIC lives in the proxy. This script is the single unavoidable
# coupling surface with Claude Code's plugin system. If the proxy is down,
# we fail open (exit 0, empty output) so Claude Code isn't wedged.
#
# Usage (from hooks.json): bash _proxy_bridge.sh <EventName>

EVENT="${1:-unknown}"
PORT="${HME_PROXY_PORT:-9099}"

# Capture stdin (the Claude Code hook payload).
BODY=$(cat)

# POST to proxy. --max-time 60s accommodates stop.sh's longer chain
# (auto-commit + lifecycle checks). On transport failure, fail open.
RESP=$(curl -sf --max-time 60 -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "$BODY" \
  "http://127.0.0.1:${PORT}/hme/lifecycle?event=${EVENT}" 2>/dev/null)

if [ -z "$RESP" ]; then
  # Proxy unreachable. Fail open — never block Claude Code on proxy downtime.
  exit 0
fi

# Parse response and relay. jq is available in every Claude Code environment;
# this is the simplest way to pull structured fields from the JSON.
STDOUT=$(echo "$RESP" | jq -r '.stdout // ""' 2>/dev/null)
STDERR=$(echo "$RESP" | jq -r '.stderr // ""' 2>/dev/null)
EXIT_CODE=$(echo "$RESP" | jq -r '.exit_code // 0' 2>/dev/null)

[ -n "$STDOUT" ] && printf '%s' "$STDOUT"
[ -n "$STDERR" ] && printf '%s' "$STDERR" >&2
exit "${EXIT_CODE:-0}"
