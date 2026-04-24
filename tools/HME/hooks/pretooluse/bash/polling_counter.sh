_streak_tick 15
if ! _streak_check; then exit 1; fi
# Redirect: repeated polling of background task output files (3rd+ check).
# Covers both /tmp/claude-*/tasks/*.output paths AND any /tmp/*.log file,
# which catches the "wait for training" / "wait for background script"
# class of antipatterns. Also catches nvidia-smi polling when a bg task
# is running (GPU-check is a proxy for "is my job done yet?").
TASK_POLL_COUNTER="/tmp/polychron-task-poll-count"
_POLLING=0
# Pattern 1: file inspection tools targeting /tmp/claude-*, /tmp/*.log, /tmp/*.output
if echo "$CMD" | grep -qE '(tail|cat|head|grep|wc|ls).*/tmp/(claude.*\.log|.*\.output)'; then
  _POLLING=1
fi
# Pattern 2: nvidia-smi repeatedly (GPU status polling)
if echo "$CMD" | grep -qE '^nvidia-smi|\bnvidia-smi\b.*query'; then
  _POLLING=1
fi
# Pattern 3: ps -ef/aux piped through grep to find a specific background process
if echo "$CMD" | grep -qE 'ps\s+-[aef]+.*\|\s*grep' && echo "$CMD" | grep -qvE 'grep.*sudo'; then
  _POLLING=1
fi
if [ "$_POLLING" -eq 1 ]; then
  COUNT=$(_safe_int "$(cat "$TASK_POLL_COUNTER" 2>/dev/null)" 0)
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$TASK_POLL_COUNTER"
  if [ "$COUNT" -gt 2 ]; then
    jq -n --arg count "$COUNT" \
      '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":("PSYCHOPATHIC POLLING #" + $count + ": you are repeatedly checking background task status. Background processes fire a completion notification when done — WAIT for it. Working on independent parallel tasks is fine; re-checking the same file or nvidia-smi or ps is not. Do real work until the notification arrives.")},"systemMessage":("PSYCHOPATHIC POLLING #" + $count + ": repeated background-status polling. Do real work.")}'
    exit 0
  fi
fi
