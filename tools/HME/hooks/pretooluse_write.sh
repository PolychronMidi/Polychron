#!/usr/bin/env bash
# HME PreToolUse: Write — enforce lab rules and block memory saves
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Block writes to the auto-memory directory — memory saving is an antipattern here
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  echo '{"decision":"block","reason":"BLOCKED: Memory saving is an antipattern. Do not write to .claude/projects memory directory. Fix behavior, not memory."}'
  exit 2
fi

if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
exit 0
