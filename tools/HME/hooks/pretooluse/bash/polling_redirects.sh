# Block ALL other run.lock access — reading lock status IS polling
if echo "$CMD" | grep -q 'run\.lock'; then
  _emit_block "BLOCKED: Checking run.lock is pipeline status polling. Run \`i/status\` NOW for current status, then continue with other work."
  exit 2
fi

# Redirect: metric file timestamp polling → status tool
if echo "$CMD" | grep -qE '(stat|ls -l).*(pipeline-summary|trace-summary|run-history|perceptual-report)'; then
  REASON='Checking metric timestamps is indirect pipeline polling. Run `i/status` for current status, then continue with other work.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi
