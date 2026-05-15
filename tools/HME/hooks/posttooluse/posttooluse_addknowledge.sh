#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostToolUse: `i/learn` dispatch -- clear pending KB entries from
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Fail-fast on CLI transport errors -- never clear KB tab if the learn call
TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
if echo "$TOOL_RESULT" | grep -q '^hme-cli:'; then
  echo "NEXUS: learn CLI failed -- KB tab NOT cleared. Investigate worker/shim health before re-running." >&2
  exit 0
fi

_extract_arg() {
  local key="$1"
  # Try quoted form first, then bare form.
  local v
  v=$(echo "$CMD" | grep -oE "\\b${key}[= ]\"[^\"]*\"" | head -1 | sed -E "s/^.*${key}[= ]\"([^\"]*)\"$/\\1/")
  if [ -z "$v" ]; then
    v=$(echo "$CMD" | grep -oE "\\b${key}[= ][^[:space:]\"]+" | head -1 | sed -E "s/^.*${key}[= ]//")
  fi
  printf '%s' "$v"
}

TITLE=$(_extract_arg title)
CONTENT=$(_extract_arg content)
ACTION=$(_extract_arg action)

# Only run on add-style calls: title + content present.
if [[ -z "$TITLE" || -z "$CONTENT" ]]; then
  exit 0
fi
# Skip if action is a non-add operation (list, compact, etc.)
case "$ACTION" in
  list|compact|export|graph|dream|health) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_tab_helpers.sh"

TAB=$(_tab_path)
[[ -f "$TAB" ]] || exit 0
sed -i '/^KB:/d' "$TAB"
exit 0
