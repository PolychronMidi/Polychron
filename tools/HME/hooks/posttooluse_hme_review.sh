#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
# PostToolUse: mcp__HME__review — clear edit backlog, point to next step.
INPUT=$(cat)
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' 'digest')

if [ "$MODE" = "forget" ]; then
  EDIT_COUNT=$(_nexus_count EDIT)
  _nexus_clear_type EDIT
  _nexus_mark REVIEW
  if [ "$EDIT_COUNT" -gt 0 ]; then
    echo "NEXUS: Review complete (${EDIT_COUNT} files audited). Edit backlog cleared." >&2
  fi
  # Extract depth meter issue count from tool response — block stop if ≥4 issues remain.
  # `|| true` masks grep-returns-1 when no matches so `set -euo pipefail` doesn't
  # kill the script before reaching the clear branch (regression fixed 2026-04-15:
  # silent death here meant the stale REVIEW_ISSUES count from a prior dirty
  # review would never get cleared, permanently blocking stop).
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
