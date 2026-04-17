#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: mcp__HME__review — clear edit backlog, point to next step.
INPUT=$(cat)
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' 'digest')

if [ "$MODE" = "forget" ]; then
  # EDIT clear + REVIEW mark moved to proxy middleware (nexus_tracking.js).
  # Shell hook keeps user-facing stderr + REVIEW_ISSUES parsing (requires
  # the tool_response text which middleware doesn't reliably receive).
  TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
  ISSUES_COUNT=$(echo "$TOOL_RESULT" | grep -oE 'Found [0-9]+ issues total' | grep -oE '[0-9]+' | head -1 || true)
  if [ -n "$ISSUES_COUNT" ]; then
    _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
    echo "NEXUS: ${ISSUES_COUNT} review issue(s) found — fix and re-run review(mode='forget') until 0." >&2
  else
    _nexus_clear_type REVIEW_ISSUES
  fi
  # Point to next step
  if _nexus_has PIPELINE; then
    VERDICT=$(_nexus_get PIPELINE)
    if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
      echo "NEXUS: Pipeline already passed ($VERDICT). Commit if not done yet." >&2
    fi
  else
    echo "NEXUS: Ready for pipeline run (npm run main)." >&2
  fi
fi

_streak_reset

exit 0
