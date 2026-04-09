#!/usr/bin/env bash
# Shared helpers for compact tab operations
# Note: _safety.sh is sourced by each hook script before this file

_tab_path() {
  local project="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
  echo "$project/tmp/hme-tab.txt"
}

_ensure_tab() {
  local tab; tab=$(_tab_path)
  mkdir -p "$(dirname "$tab")"
  touch "$tab"
  echo "$tab"
}

_append_file_to_tab() {
  local file="$1"
  local tab; tab=$(_ensure_tab)
  grep -qxF "FILE: $file" "$tab" 2>/dev/null || echo "FILE: $file" >> "$tab"
}

_extract_bg_output_path() {
  python3 -c "
import json, sys, re
data = json.load(sys.stdin)
result = data.get('tool_result', '') or ''
if isinstance(result, list):
    result = ' '.join(str(x.get('text','') if isinstance(x,dict) else x) for x in result)
m = re.search(r'Output is being written to: (\S+)', str(result))
print(m.group(1) if m else '')
" 2>/dev/null
}
