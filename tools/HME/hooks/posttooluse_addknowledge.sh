#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostToolUse: add_knowledge — clear pending KB entries from tab after save
cat > /dev/null  # consume stdin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"

TAB=$(_tab_path)
[[ -f "$TAB" ]] || exit 0
sed -i '/^KB:/d' "$TAB"
exit 0
