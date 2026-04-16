#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PreToolUse: Grep — surface KB relevance for search queries.
INPUT=$(cat)
PATTERN=$(_safe_jq "$INPUT" '.tool_input.pattern' '')
MULTILINE=$(_safe_jq "$INPUT" '.tool_input.multiline' 'false')

# Allow multiline silently — HME can't do cross-line patterns
if [[ "$MULTILINE" == "true" ]]; then
  exit 0
fi

KB_JSON=$(_hme_enrich "$PATTERN" 2)
KB_COUNT=$(_hme_kb_count "$KB_JSON")
if [[ "$KB_COUNT" -gt 0 ]]; then
  TITLES=$(_hme_kb_titles "$KB_JSON" 3)
  _emit_enrich_allow "HME: $KB_COUNT KB entries match \"$PATTERN\":
$TITLES"
  _streak_tick 20
  exit 0
fi
_streak_tick 20
if ! _streak_check; then exit 1; fi
exit 0
