#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0
case "$FILE" in
  *.js|*.mjs|*.cjs)
    if [ -f "$PROJECT_ROOT/package.json" ]; then
      (cd "$PROJECT_ROOT" && npx eslint --quiet "$FILE") >&2 || true
    fi
    ;;
  *.py)
    python3 -m py_compile "$FILE" >&2 || true
    ;;
  *) ;;
esac
python3 "$PROJECT_ROOT/scripts/audit-comment-bloat.py" --files "$FILE" >&2 || true
exit 0
