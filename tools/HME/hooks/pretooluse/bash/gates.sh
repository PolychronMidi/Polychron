# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
if echo "$TRIMMED_CHECK" | grep -qE '^npm run main' && ! _onb_is_graduated; then
  if _onb_before "reviewed"; then
    CUR_STEP=$(_onb_step_label)
    jq -n --arg step "$CUR_STEP" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("HME onboarding " + $step + "\n\nYou are about to run the pipeline but changes have not been audited against the KB.\n\nAUTO-CHAIN: run `i/review -- mode=forget` first.\nWhen it reports zero warnings, onboarding advances to reviewed and your npm run main will go through.")}}'
    exit 0
  fi
fi

# Strip explicit timeouts — all project scripts handle timeouts inline.
# Uses updatedInput to silently remove timeout and let the command proceed.
TIMEOUT=$(_safe_jq "$INPUT" '.tool_input.timeout' '')
if [ -n "$TIMEOUT" ] && [ "$TIMEOUT" != "0" ]; then
  RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
  # Build updatedInput: command + run_in_background (if set) + no timeout
  if [ "$RUN_BG" = "true" ]; then
    jq -n --arg cmd "$CMD" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd,"run_in_background":true}},"systemMessage":"timeout removed — all project scripts handle timeouts inline"}'
  else
    jq -n --arg cmd "$CMD" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd}},"systemMessage":"timeout removed — all project scripts handle timeouts inline"}'
  fi
  exit 0
fi
