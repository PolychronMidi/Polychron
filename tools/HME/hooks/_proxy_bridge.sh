#!/usr/bin/env bash
# The ONLY Claude-Code-side hook. Stateless forwarder: POSTs stdin to the
# proxy's /hme/lifecycle endpoint with ?event=<EventName>, relays ONLY
# actionable output back to Claude Code.
#
# Filtering rules (context-burn avoidance):
#   - Hook stdout is relayed only when it's a valid decision JSON
#     ({"decision":...} or {"permissionDecision":...}). Routine text
#     output (git status, banners, etc.) stays local to the proxy log.
#   - Hook stderr is dropped entirely. Hooks emit verbose stderr for
#     operator observability; that belongs in hme-proxy.out, NOT in
#     Claude's per-turn context. Showing it every turn burns tokens on
#     redundant banners.
#   - Exit code is preserved so blocking semantics still work.
#
# If the proxy is unreachable, fail open (exit 0, empty output) so
# Claude Code never wedges on proxy downtime.
#
# Usage (from hooks.json): bash _proxy_bridge.sh <EventName>

EVENT="${1:-unknown}"
PORT="${HME_PROXY_PORT:-9099}"

BODY=$(cat)

RESP=$(curl -sf --max-time 60 -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "$BODY" \
  "http://127.0.0.1:${PORT}/hme/lifecycle?event=${EVENT}" 2>/dev/null)

if [ -z "$RESP" ]; then
  exit 0
fi

STDOUT=$(echo "$RESP" | jq -r '.stdout // ""' 2>/dev/null)
EXIT_CODE=$(echo "$RESP" | jq -r '.exit_code // 0' 2>/dev/null)

# Only relay stdout that is a structured decision JSON. Everything else
# (git status output, KB draft hints, routine banners) stays in proxy
# log and out of Claude's per-turn context.
if [ -n "$STDOUT" ]; then
  IS_DECISION=$(printf '%s' "$STDOUT" | jq -e 'has("decision") or has("permissionDecision")' >/dev/null 2>&1 && echo 1 || echo 0)
  if [ "$IS_DECISION" = "1" ]; then
    printf '%s' "$STDOUT"
  fi
fi

exit "${EXIT_CODE:-0}"
