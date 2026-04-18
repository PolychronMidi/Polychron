#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: `i/review` dispatch (called by posttooluse_bash.sh).
# Parses the review mode out of tool_input.command (either `mode=forget` or
# `--mode forget`) — default digest.
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')
MODE=$(echo "$CMD" | grep -oE '\bmode[= ][a-z_]+' | head -1 | sed -E 's/^.*mode[= ]//')
[ -z "$MODE" ] && MODE="digest"

if [ "$MODE" = "forget" ]; then
  # EDIT clear + REVIEW mark moved to proxy middleware (nexus_tracking.js).
  # Shell hook keeps user-facing stderr + REVIEW_ISSUES parsing (requires
  # the tool_response text which middleware doesn't reliably receive).
  TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
  # Fail-fast on CLI transport errors — `hme-cli: request failed ...` means
  # the worker was down or the request timed out. Never interpret that as
  # "review passed with zero issues"; mark CLI_FAILURE in nexus so stop.sh
  # blocks until the user notices.
  if echo "$TOOL_RESULT" | grep -q '^hme-cli:'; then
    _nexus_mark REVIEW_CLI_FAILURE "review CLI failed — worker down or request timed out"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review CLI call failed — worker down? Cannot trust REVIEW_ISSUES state. Re-run i/review mode=forget after fixing." >&2
    exit 0
  fi
  # Parse the issue count. Two expected forms:
  #   "Found N issues total"      (N > 0 → mark REVIEW_ISSUES N)
  #   "Found 0 issues total" OR "All clean" sentinel (→ clear REVIEW_ISSUES)
  # If NEITHER form is present, the output shape has drifted — mark
  # REVIEW_PARSE_FAILED so stop.sh blocks (silently clearing would let
  # format drift masquerade as "all clean").
  ISSUES_COUNT=$(echo "$TOOL_RESULT" | grep -oE 'Found [0-9]+ issues total' | grep -oE '[0-9]+' | head -1 || true)
  ALL_CLEAN=$(echo "$TOOL_RESULT" | grep -cE 'Found 0 issues total|^All clean$|review passed' || true)
  if [ -n "$ISSUES_COUNT" ] && [ "$ISSUES_COUNT" -gt 0 ] 2>/dev/null; then
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
    echo "NEXUS: ${ISSUES_COUNT} review issue(s) found — fix and re-run i/review mode=forget until 0." >&2
  elif [ -n "$ISSUES_COUNT" ] || [ "$ALL_CLEAN" -gt 0 ] 2>/dev/null; then
    # Explicit zero-issues marker present → safe to clear.
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_clear_type REVIEW_ISSUES
  else
    # Neither "Found N issues total" nor the all-clean sentinel appeared.
    # Output format has drifted — refuse to silently claim review passed.
    _nexus_mark REVIEW_PARSE_FAILED "review output missing expected sentinels"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review output format drifted — neither 'Found N issues total' nor 'All clean' detected. REVIEW_ISSUES marked unknown; investigate before proceeding." >&2
    exit 0
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
