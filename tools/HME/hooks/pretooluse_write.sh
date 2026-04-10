#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Write — enforce lab rules, block memory saves, detect secrets
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')

# Block writes to the auto-memory directory — memory saving is an antipattern here
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  echo '{"decision":"block","reason":"BLOCKED: Memory saving is an antipattern. Do not write to .claude/projects memory directory. Fix behavior, not memory."}' >&2
  exit 2
fi

# Detect secret patterns in content (API keys, tokens, passwords)
if echo "$CONTENT" | grep -qE '(api[_-]?key|password|secret|token)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9+/]{20,}'; then
  echo '{"decision":"block","reason":"BLOCKED: Potential secret/credential detected in write content. Review before writing."}' >&2
  exit 2
fi

# Block stub/placeholder writes — LLM-generated code with "# ... existing code ..." patterns
# destroys files by replacing real content with placeholder references.
if echo "$CONTENT" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  echo '{"decision":"block","reason":"BLOCKED: Write contains LLM stub placeholder (e.g. \"# ... existing code ...\"). This destroys files. Write the COMPLETE file content or use Edit for partial changes."}' >&2
  exit 2
fi
if echo "$CONTENT" | grep -qE '\.\.\. rest of (file|implementation|code)'; then
  echo '{"decision":"block","reason":"BLOCKED: Write contains \"... rest of ...\" stub placeholder. Write complete content or use Edit."}' >&2
  exit 2
fi

if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
# fix_antipattern: expected background failures must be logger.info, not logger.warning.
# Only genuine critical failures (interactive timeout, HTTP 500, connection refused) stay as warning.
# Catches: logger.warning(...background...) and logger.warning(...warm...failed/error...) in HME server code.
if echo "$FILE" | grep -q 'tools/HME/mcp/server'; then
  if echo "$CONTENT" | grep -qE 'logger\.warning\(.*\b(background|warm.*fail|warm.*error|onnx.*failed|VRAM TIGHT|lazy warm)\b'; then
    echo '{"decision":"block","reason":"BLOCKED: Expected background failure logged as WARNING — use logger.info. Only critical failures (interactive timeout, HTTP 500) should be WARNING in HME server. See ANTIPATTERN: stderr-to-UI popup spam."}' >&2
    exit 2
  fi
fi
# Track consecutive non-HME tool calls
STREAK_FILE="/tmp/hme-non-hme-streak.count"
STREAK=$(cat "$STREAK_FILE" 2>/dev/null || echo 0)
STREAK=$((STREAK + 1))
echo "$STREAK" > "$STREAK_FILE"

if [[ "$STREAK" -ge 7 ]]; then
  echo "BLOCKED: 7+ consecutive raw tool calls. You MUST use an mcp__HME__ tool (read, find, review) before continuing. They add KB context that raw tools miss." >&2
  exit 1
elif [[ "$STREAK" -ge 5 ]]; then
  echo "REMINDER: You've made ${STREAK} consecutive non-HME tool calls. Use HME tools (read, find, review) instead of raw Read/Grep/Bash — they add KB constraints and boundary warnings." >&2
fi
exit 0
