#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostToolUse: Agent — track random-hash output files to compact tab
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"

INPUT=$(cat)
BG_FILE=$(echo "$INPUT" | _extract_bg_output_path)
[[ -n "$BG_FILE" ]] && _append_file_to_tab "$BG_FILE"
exit 0
