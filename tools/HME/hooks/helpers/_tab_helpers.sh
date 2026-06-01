#!/usr/bin/env bash
# Shared helpers for compact tab operations
# Note: _safety.sh is sourced by each hook script before this file

_tab_path() {
  local project="$PROJECT_ROOT"
  echo "$project/tmp/hme-tab.txt"  #
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
  if [ ! -r "$tab" ]; then
    echo "HME fail-fast: tab file is not readable: $tab" >&2
    return 1
  fi
  if grep -qxF "FILE: $file" "$tab"; then
    return 0
  fi
  echo "FILE: $file" >> "$tab" || {
    echo "HME fail-fast: cannot append to tab file: $tab" >&2
    return 1
  }
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
" || {
    echo "HME fail-fast: malformed PostToolUse payload while extracting background output path" >&2
    return 1
  }
}
