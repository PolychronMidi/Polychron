# Bash intent translation (Level 7 of the dominance layer).
#
# When the agent runs raw bash that would be strictly better served by an
# HME tool, silently rewrite the command so HME runs instead of the raw
# grep/cat/find. The agent types its muscle-memory bash; HME executes the
# intent through its proper channel.
#
# Feature-flagged via HME_DOMINANCE env var. When off, this hook is a
# pure no-op.
#
# Design constraint: rewrites MUST produce equivalent or superior output.
# Never degrade the agent's observed result — that'd break the "tool
# falls into hand" experience. Safe translations only:
#
#   `grep -rn <pat> tools/HME` → `i/hme-read query=<pat>`  # KB-enriched
#   `find src -name <pat>`     → `i/hme-read mode=find query=<pat>`
#   `cat log/hme-errors.log`   → `i/status mode=coherence`  # indirect polling
#
# Skipped translations (too lossy):
#   - raw ls (too structural)
#   - cat on arbitrary files (the agent wants raw content, not briefs)
#   - any grep/find on output/ metrics/ (agent may want raw data)
#
# Non-translated commands pass through untouched.

[ "${HME_DOMINANCE:-}" = "1" ] || return 0

_INTENT_CMD="$CMD"
_INTENT_REWROTE=""

# grep -rn <pattern> tools/HME/...  →  i/hme-read query=<pattern>
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
