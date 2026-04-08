#!/usr/bin/env bash
# HME PreToolUse: Grep — surface KB relevance for search queries.
INPUT=$(cat)
PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""')
MULTILINE=$(echo "$INPUT" | jq -r '.tool_input.multiline // false')

# Allow multiline silently — HME can't do cross-line patterns
if [[ "$MULTILINE" == "true" ]]; then
  exit 0
fi

# Check if KB has knowledge about this search topic (2s timeout)
KB_JSON=$(curl -s --max-time 2 -X POST http://127.0.0.1:7734/enrich \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"$PATTERN\",\"top_k\":2}" 2>/dev/null)
KB_COUNT=$(echo "$KB_JSON" | jq -r '.kbCount // 0' 2>/dev/null)
if [[ "$KB_COUNT" -gt 0 ]]; then
  KB_TITLES=$(echo "$KB_JSON" | jq -r '.kb[]?.title // empty' 2>/dev/null | head -2 | sed 's/^/    /')
  echo "HME HAS CONTEXT ($KB_COUNT entries). Use mcp__HME__find(query=\"$PATTERN\") for KB-enriched results:" >&2
  echo "$KB_TITLES" >&2
else
  echo "HME FIRST: Use mcp__HME__find(query=\"$PATTERN\") — returns matches + KB cross-references. Raw Grep finds text; find() finds meaning." >&2
fi
exit 0
