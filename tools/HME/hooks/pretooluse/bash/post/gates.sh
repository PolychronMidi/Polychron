# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
CMD="${CMD:-}"
# silent-ok: empty/advisory hook branch; sourced/executed compatibility.
[ -n "$CMD" ] || return 0 2>/dev/null || exit 0
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
_nexus_latest_ts() {
  local type="$1"
  _nexus_ensure
  # silent-ok: absent nexus entries are represented by empty output.
  grep -oE "${type}:[0-9]+:" "$_NEXUS_FILE" 2>/dev/null | tail -1 | cut -d: -f2
}
_is_uint() {
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}
_review_is_newer_than_failures() {
  local r issue parse cli maxfail
  r=$(_nexus_latest_ts REVIEW); issue=$(_nexus_latest_ts REVIEW_ISSUES)
  parse=$(_nexus_latest_ts REVIEW_PARSE_FAILED); cli=$(_nexus_latest_ts REVIEW_CLI_FAILURE)
  _is_uint "$r" || return 1
  maxfail=0
  _is_uint "$issue" && [ "$issue" -gt "$maxfail" ] && maxfail="$issue"
  _is_uint "$parse" && [ "$parse" -gt "$maxfail" ] && maxfail="$parse"
  _is_uint "$cli" && [ "$cli" -gt "$maxfail" ] && maxfail="$cli"
  [ "$r" -gt "$maxfail" ]
}
if echo "$TRIMMED_CHECK" | grep -qE '^npm run main' && ! _onb_is_graduated; then
  if _onb_before "reviewed"; then
    # Recovery path: the review hook may have marked NEXUS clean but missed
    # onboarding advancement (e.g. sessions edited before the edit hook was
    if _review_is_newer_than_failures; then
      if [ "$(_onb_state)" = "targeted" ]; then
        _onb_advance_to edited >/dev/null 2>&1 || true
      fi
      if [ "$(_onb_state)" = "edited" ]; then
        _onb_advance_to reviewed >/dev/null 2>&1 || true
      fi
    fi
  fi
  if _onb_before "reviewed"; then
    CUR_STEP=$(_onb_step_label)
    jq -n --arg step "$CUR_STEP" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("HME onboarding " + $step + "\n\nYou are about to run the pipeline but changes have not been audited against the KB.\n\nAUTO-CHAIN: run `i/review -- mode=forget` first.\nWhen it reports no actionable warnings, onboarding advances to reviewed and your npm run main will go through.")}}'
    exit 0
  fi
fi
