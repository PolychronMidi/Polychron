#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostToolUse: Write — track .md/.txt note files outside tmp/ to compact tab
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_tab_helpers.sh"

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Only track note files outside tmp/ (tmp/ is covered by precompact find)
[[ "$FILE" =~ \.(md|txt)$ ]] || exit 0
[[ "$FILE" == */tmp/* ]] && exit 0

# Rebuild dir-intent index whenever a README.md is written — keeps the proxy's
# 60s cache fed with fresh data rather than waiting for manual aggregator runs.
if [[ "$FILE" == */README.md ]]; then
  python3 "$PROJECT_ROOT/scripts/pipeline/hme/build-dir-intent-index.py" \
    >/dev/null 2>&1 &
fi

_append_file_to_tab "$FILE"
exit 0
