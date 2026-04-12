#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
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
  jq -n --arg pattern "$PATTERN" --arg count "$KB_COUNT" --arg titles "$TITLES" \
    '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("HME has " + $count + " KB entries matching \"" + $pattern + "\". For KB-enriched results: mcp__HME__find(query=\"" + $pattern + "\")\n" + $titles)}'
  _streak_tick 20
  exit 0
else
  jq -n --arg pattern "$PATTERN" \
    '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("mcp__HME__find(query=\"" + $pattern + "\") returns matches + KB cross-references. Raw Grep finds text; find() finds meaning.")}'
  _streak_tick 20
  exit 0
fi
