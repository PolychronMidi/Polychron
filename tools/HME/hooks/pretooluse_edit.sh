#!/usr/bin/env bash
# HME PreToolUse: Edit — remind to call before_editing on src/ files
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
if echo "$FILE" | grep -q '/src/'; then
  MODULE=$(basename "$FILE" .js)
  echo "BEFORE EDITING $MODULE: Call before_editing(\"$FILE\") for KB constraints + callers + warnings. Or at minimum: search_knowledge \"$MODULE\"" >&2
fi
exit 0
