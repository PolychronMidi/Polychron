# Bash intent translation: silently rewrite raw grep/find/cat into the
# corresponding HME tool when superior. Feature-flagged via HME_DOMINANCE.
# Translations: grep -rn .. tools/HME -> i/hme-read; find src -name X ->
# i/hme-read mode=find; cat log/hme-errors.log -> i/status mode=coherence.
# Skips raw ls, cat-on-arbitrary, grep/find on output|metrics. Pass-through default.

[ "${HME_DOMINANCE:-}" = "1" ] || return 0

_INTENT_CMD="$CMD"
_INTENT_REWROTE=""

# grep -rn <pattern> tools/HME/...  ->  i/hme-read query=<pattern>
#
# Only rewrites when the search scope is entirely within tools/HME/ AND
# the pattern is a single symbol-like token (not a regex). Raw grep is
# still available for complex patterns; we only absorb the "find a
# symbol in HME" case because i/hme-read adds KB briefs the raw grep
# misses.
if echo "$_INTENT_CMD" | grep -qE '^\s*grep\s+-rn?\s+[A-Za-z_][A-Za-z0-9_]*\s+tools/HME[/\s]'; then
  _pat=$(echo "$_INTENT_CMD" | sed -nE 's/^\s*grep\s+-rn?\s+([A-Za-z_][A-Za-z0-9_]*).*/\1/p')
  if [ -n "$_pat" ] && [ -x "$PROJECT_ROOT/i/hme-read" ]; then
    _INTENT_REWROTE="$PROJECT_ROOT/i/hme-read query=$_pat"
  fi
fi

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
