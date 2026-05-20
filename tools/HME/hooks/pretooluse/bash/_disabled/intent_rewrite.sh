# Bash intent translation: silently rewrite raw commands into the
# corresponding HME tool when superior. Feature-flagged via HME_DOMINANCE.
# Explicit HME read rewrites are retired; native Read/Grep/Edit are enriched.
# Remaining translation: cat log/hme-errors.log -> i/status mode=coherence.
# Skips raw ls, cat-on-arbitrary, grep/find on output|metrics. Pass-through default.

[ "${HME_DOMINANCE}" = "1" ] || return 0

_INTENT_CMD="$CMD"
_INTENT_REWROTE=""

if [ -n "$_INTENT_REWROTE" ]; then
  _RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
  if [ "$_RUN_BG" = "true" ]; then
    jq -n --arg cmd "$_INTENT_REWROTE" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd,"run_in_background":true}}}'
  else
    jq -n --arg cmd "$_INTENT_REWROTE" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd}}}'
  fi
  exit 0
fi
