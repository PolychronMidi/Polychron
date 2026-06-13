# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
CMD="${CMD:-}"
# silent-ok: empty/advisory hook branch; sourced/executed compatibility.
[ -n "$CMD" ] || return 0 2>/dev/null || exit 0
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
_nexus_latest_ts() {
  local type="$1"
  _nexus_ensure
  grep -oE "${type}:[0-9]+:" "$_NEXUS_FILE" 2>/dev/null | tail -1 | cut -d: -f2
}
_review_is_newer_than_failures() {
  local r issue parse cli maxfail
  r=$(_nexus_latest_ts REVIEW); issue=$(_nexus_latest_ts REVIEW_ISSUES)
  parse=$(_nexus_latest_ts REVIEW_PARSE_FAILED); cli=$(_nexus_latest_ts REVIEW_CLI_FAILURE)
  [ -n "$r" ] || return 1
  maxfail=0
  [ -n "$issue" ] && [ "$issue" -gt "$maxfail" ] 2>/dev/null && maxfail="$issue"
  [ -n "$parse" ] && [ "$parse" -gt "$maxfail" ] 2>/dev/null && maxfail="$parse"
  [ -n "$cli" ] && [ "$cli" -gt "$maxfail" ] 2>/dev/null && maxfail="$cli"
  [ "$r" -gt "$maxfail" ] 2>/dev/null
}
if echo "$TRIMMED_CHECK" | grep -qE '^npm run main' && ! _onb_is_graduated; then
  if _onb_before "reviewed"; then
    # Recovery path: the review hook may have marked NEXUS clean but missed
    # onboarding advancement (e.g. sessions edited before the edit hook was
    if _nexus_has REVIEW \
       && ! _nexus_has REVIEW_ISSUES \
       && ! _nexus_has REVIEW_CLI_FAILURE \
       && ! _nexus_has REVIEW_PARSE_FAILED; then
      _onb_advance_to edited >/dev/null 2>&1 || true
      _onb_advance_to reviewed >/dev/null 2>&1 || true
    fi
  fi
  if _onb_before "reviewed"; then
    CUR_STEP=$(_onb_step_label)
    jq -n --arg step "$CUR_STEP" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("HME onboarding " + $step + "\n\nYou are about to run the pipeline but changes have not been audited against the KB.\n\nAUTO-CHAIN: run `i/review -- mode=forget` first.\nWhen it reports no actionable warnings, onboarding advances to reviewed and your npm run main will go through.")}}'
    exit 0
  fi
fi
