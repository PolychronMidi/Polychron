#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Grep — surface KB relevance for search queries.
INPUT=$(cat)
PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""')
MULTILINE=$(echo "$INPUT" | jq -r '.tool_input.multiline // false')

# Allow multiline silently — HME can't do cross-line patterns
if [[ "$MULTILINE" == "true" ]]; then
  exit 0
fi

# Check if KB has knowledge about this search topic (2s timeout)
KB_JSON=$(_safe_curl "http://127.0.0.1:7734/enrich" "{\"query\":\"$PATTERN\",\"top_k\":2}")
KB_COUNT=$(_safe_int "$(_safe_jq "$KB_JSON" '.kbCount' '0')")
if [[ "$KB_COUNT" -gt 0 ]]; then
  KB_TITLES=$(_safe_jq "$KB_JSON" '.kb[]?.title // empty' '' | head -2 | sed 's/^/    /')
  echo "HME HAS CONTEXT ($KB_COUNT entries). Use mcp__HME__find(query=\"$PATTERN\") for KB-enriched results:" >&2
  echo "$KB_TITLES" >&2
else
  echo "HME FIRST: Use mcp__HME__find(query=\"$PATTERN\") — returns matches + KB cross-references. Raw Grep finds text; find() finds meaning." >&2
fi
# fix_antipattern: Track consecutive non-HME tool calls using /tmp/hme-non-hme-streak.count. Read c
# Track consecutive non-HME tool calls
STREAK_FILE="/tmp/hme-non-hme-streak.count"
STREAK=$(cat "$STREAK_FILE" 2>/dev/null || echo 0)
STREAK=$((STREAK + 1))
echo "$STREAK" > "$STREAK_FILE"

if [[ "$STREAK" -ge 5 ]]; then
  echo "REMINDER: You've made $STREAK+ consecutive non-HME tool calls. Use HME tools (read, find, review) instead of raw Read/Grep/Bash  they add KB constraints and boundary warnings." >&2
  if [[ "$STREAK" -ge 7 ]]; then
    echo "BLOCKED: 7+ consecutive raw tool calls. You MUST use an mcp__HME__ tool (read, find, review) before continuing. They add KB context that raw tools miss." >&2
    exit 1
  fi
fi
exit 0
