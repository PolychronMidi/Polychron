# Anti-wait enforcement: pipeline commands MUST use run_in_background=true.
# Only triggers when the command itself starts with the pipeline command (not when
# the string appears inside a heredoc, commit message, or other argument).
if echo "$TRIMMED_CMD" | grep -qE '^(npm run (main|snapshot)|node lab/run)'; then
  RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
  if [[ "$RUN_BG" != "true" ]]; then
    _emit_block "ANTI-WAIT: npm run main must use run_in_background=true. Re-issue this Bash call with run_in_background: true, then CONTINUE with parallel work (HME indexing, doc updates, src/ improvements). Stopping to wait for the pipeline is the antipattern."
    exit 2
  fi
  # Emit pipeline_start to activity bridge. Extract session_id from INPUT —
  # SESSION_ID was previously referenced unset, which under `set -u` would
  # have crashed the hook at pipeline launch; caught by audit-shell-undefined-vars.
  _SESSION_ID_PIPE=$(_safe_jq "$INPUT" '.session_id' 'unknown')
  _emit_activity pipeline_start --session="$_SESSION_ID_PIPE"
  # Block double-backgrounding: run_in_background=true AND & in command = premature exit code 0.
  # The & makes the shell return immediately, firing a false "completed" notification while npm still runs.
  # This is the root cause of check_pipeline polling loops.
  if echo "$CMD" | grep -qE '[[:space:]]&[[:space:]]*$|[[:space:]]&$'; then
    _emit_block "BLOCKED: Do NOT use & with run_in_background=true — double-backgrounding fires a false exit-code-0 notification while npm is still running, which causes check_pipeline polling loops. Remove the & from the command."
    exit 2
  fi
fi

# Redirect: pipeline log file polling → status tool
if echo "$CMD" | grep -qE '(tail|cat|head|grep).*(r4[0-9]+_run|run\.log|pipeline\.log)'; then
  REASON='Polling pipeline logs is the antipattern. Run `i/status` for current status, then continue with other work.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

# Enrich: sleep+check pattern — allow but inject guidance
if echo "$CMD" | grep -qE 'sleep.*(tail|cat|head|grep|\.output)'; then
  REASON='sleep+check detected. Background tasks fire a completion notification — no need to poll. If you must wait, use run_in_background=true instead of sleep loops.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$reason},"systemMessage":$reason}'
  exit 0
fi
