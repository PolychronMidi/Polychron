# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
CMD="${CMD:-}"
# silent-ok: empty/advisory hook branch; sourced/executed compatibility.
[ -n "$CMD" ] || return 0 2>/dev/null || exit 0
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
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
