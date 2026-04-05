#!/usr/bin/env bash
# HME PreToolUse: Write — enforce lab rules for sketches.js
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
exit 0
