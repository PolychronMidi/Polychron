#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Glob — streak tracking + suggest HME glob_search for KB enrichment.
INPUT=$(cat)
PATTERN=$(_safe_jq "$INPUT" '.tool_input.pattern' '')

# Extract likely module names from pattern for KB check
MODULE=$(echo "$PATTERN" | sed 's|.*/||; s|\*.*||; s|\..*||' | grep -E '^[a-zA-Z]' || true)
if [[ -n "$MODULE" && ${#MODULE} -gt 3 ]]; then
  KB_JSON=$(_hme_enrich "$MODULE" 1)
  KB_COUNT=$(_hme_kb_count "$KB_JSON")
  if [[ "$KB_COUNT" -gt 0 ]]; then
    _emit_enrich_allow "HME has KB entries matching \"$MODULE\". For KB-enriched results: mcp__HME__glob_search(pattern=\"$PATTERN\")"
    _streak_tick 15
    exit 0
  fi
fi
_streak_tick 15
if ! _streak_check; then exit 1; fi
exit 0
