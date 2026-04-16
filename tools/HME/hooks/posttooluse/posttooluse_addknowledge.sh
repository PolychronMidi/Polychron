#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostToolUse: learn — clear pending KB entries from tab after an ADD call.
# Only fires when the learn call is an add (title + content provided) — search,
# remove, list, etc. should not clear the KB tab.
#
# History: this hook was originally matched to mcp__HME__add_knowledge, a tool
# that was renamed to learn(title=, content=) during unification.
INPUT=$(cat)

TITLE=$(_safe_jq "$INPUT" '.tool_input.title' '')
CONTENT=$(_safe_jq "$INPUT" '.tool_input.content' '')
ACTION=$(_safe_jq "$INPUT" '.tool_input.action' '')

# Only run on add-style calls: title + content present and action != special
if [[ -z "$TITLE" || -z "$CONTENT" ]]; then
  exit 0
fi
# Skip if action is a non-add operation (list, compact, etc.)
case "$ACTION" in
  list|compact|export|graph|dream|health) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"

TAB=$(_tab_path)
[[ -f "$TAB" ]] || exit 0
sed -i '/^KB:/d' "$TAB"
exit 0
