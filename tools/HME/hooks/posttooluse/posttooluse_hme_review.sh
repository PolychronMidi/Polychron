#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: `i/review` dispatch (called by posttooluse_bash.sh).
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')
MODE=$(echo "$CMD" | grep -oE '\bmode[= ][a-z_]+' | head -1 | sed -E 's/^.*mode[= ]//')
[ -z "$MODE" ] && MODE="digest"

if [ "$MODE" = "forget" ]; then
  # EDIT clear + REVIEW mark fired in BOTH proxy middleware and this hook
  TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
  if echo "$TOOL_RESULT" | grep -q '^hme-cli:'; then
    _nexus_mark REVIEW_CLI_FAILURE "review CLI failed -- worker down or request timed out"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review CLI call failed -- worker down? Cannot trust REVIEW_ISSUES state. Re-run i/review mode=forget after fixing." >&2
    exit 0
  fi
  # Canonical verdict from emit_review_verdict_marker:
  VERDICT_MARKER=$(echo "$TOOL_RESULT" | { grep -oE '<!--[[:space:]]*HME_REVIEW_VERDICT:[[:space:]]*(clean|warnings|error)[[:space:]]*-->' || true; } | head -1 | { grep -oE '(clean|warnings|error)' || true; })
  ISSUES_COUNT=$(echo "$TOOL_RESULT" | { grep -oE 'Found [0-9]+ issues total' || true; } | { grep -oE '[0-9]+' || true; } | head -1)
  if [ -n "$VERDICT_MARKER" ]; then
    case "$VERDICT_MARKER" in
      clean)
        _nexus_clear_type REVIEW_CLI_FAILURE
        _nexus_clear_type REVIEW_PARSE_FAILED
        _nexus_clear_type REVIEW_ISSUES
        _EDIT_COUNT_CLEARED=$(_nexus_count EDIT)
        _nexus_clear_type EDIT
        _nexus_mark REVIEW "$_EDIT_COUNT_CLEARED"
        ;;
      warnings)
        _nexus_clear_type REVIEW_CLI_FAILURE
        _nexus_clear_type REVIEW_PARSE_FAILED
        # Detect "scaffolding-only" warnings: HOOK CHANGE / DOC CHECK /
        _ACTIONABLE_COUNT=$(echo "$TOOL_RESULT" \
          | awk '/^## Warnings \(/,/^##[^#]/' \
          | grep -cE '^\s*- ' \
          | head -1 || true)
        _SCAFFOLD_COUNT=$(echo "$TOOL_RESULT" \
          | awk '/^## Warnings \(/,/^##[^#]/' \
          | grep -cE '\] (HOOK CHANGE|DOC CHECK|SKIPPED|KB):|audit skipped\s*[:\-]' \
          | head -1 || true)
        if [ "${_ACTIONABLE_COUNT:-0}" -gt 0 ] \
           && [ "${_SCAFFOLD_COUNT:-0}" -eq "${_ACTIONABLE_COUNT:-0}" ]; then
          # All warnings are scaffolding -- treat as clean for nexus.
          _nexus_clear_type REVIEW_ISSUES
          _EDIT_COUNT_CLEARED=$(_nexus_count EDIT)
          _nexus_clear_type EDIT
          _nexus_mark REVIEW "$_EDIT_COUNT_CLEARED"
          echo "NEXUS: review warnings are all scaffolding reminders (no actionable defects); EDIT cleared." >&2
        elif [ -n "$ISSUES_COUNT" ] && [ "$ISSUES_COUNT" -gt 0 ] 2>/dev/null; then  # silent-ok: optional fallback path.
          _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
          echo "NEXUS: ${ISSUES_COUNT} review issue(s) found -- fix and re-run i/review mode=forget until 0." >&2
        else
          _nexus_mark REVIEW_ISSUES "?"
          echo "NEXUS: review reported warnings (exact count unavailable) -- fix and re-run i/review mode=forget." >&2
        fi
        ;;
      error)
        _nexus_mark REVIEW_CLI_FAILURE "review emitted verdict=error -- server-side exception during what_did_i_forget"
        _nexus_mark REVIEW_ISSUES "?"
        echo "NEXUS: review server-side error -- see worker log. Re-run i/review mode=forget after fixing." >&2
        exit 0
        ;;
      *)
        # Impossible branch: grep already constrained to (clean|warnings|error).
        # Treat as parse failure rather than silently passing.
        _nexus_mark REVIEW_PARSE_FAILED "unreachable verdict value: $VERDICT_MARKER"
        _nexus_mark REVIEW_ISSUES "?"
        exit 0
        ;;
    esac
  elif [ -n "$ISSUES_COUNT" ] && [ "$ISSUES_COUNT" -gt 0 ] 2>/dev/null; then  # silent-ok: optional fallback path.
    # Legacy path: no marker, but explicit issue count present.
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
    echo "NEXUS: ${ISSUES_COUNT} review issue(s) found -- fix and re-run i/review mode=forget until 0." >&2
  elif echo "$TOOL_RESULT" | grep -qE 'Found 0 issues total|^All clean$|review passed'; then
    # Legacy path: no marker, but an explicit zero-issues sentinel.
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_clear_type REVIEW_ISSUES
  else
    # No canonical marker, no legacy sentinel -- the server output has drifted
    _nexus_mark REVIEW_PARSE_FAILED "review output missing HME_REVIEW_VERDICT marker and all legacy sentinels -- sentinel list drifted from server emit"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review output missing canonical HME_REVIEW_VERDICT marker -- server/hook sentinel contract broken. Investigate emit_review_verdict_marker() before proceeding." >&2
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

exit 0
