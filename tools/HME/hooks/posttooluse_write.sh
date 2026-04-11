#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostToolUse: Write — track .md/.txt note files outside tmp/ to compact tab
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Only track note files outside tmp/ (tmp/ is covered by precompact find)
[[ "$FILE" =~ \.(md|txt)$ ]] || exit 0
[[ "$FILE" == */tmp/* ]] && exit 0

_append_file_to_tab "$FILE"
exit 0
