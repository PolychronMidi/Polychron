#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostToolUse: Read — silent KB enrichment after file reads.
# Informative only — never blocks. Resets streak (reading = gathering context).
INPUT=$(cat)
FILE_PATH=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Only enrich project source files
if _is_project_src "$FILE_PATH"; then
  MODULE=$(_extract_module "$FILE_PATH")
  KB_JSON=$(_hme_enrich "$MODULE" 2)
  KB_COUNT=$(_hme_kb_count "$KB_JSON")
  if [[ "$KB_COUNT" -gt 0 ]]; then
    echo "KB: $KB_COUNT entries on $MODULE — mcp__HME__read(target=\"$MODULE\") for constraints + callers." >&2
  fi
  _streak_reset
fi
exit 0
