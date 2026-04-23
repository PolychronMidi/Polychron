#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# HME PostToolUse: Write — track .md/.txt note files + mirror EDIT tracking
# for direct-to-API sessions where the proxy middleware never sees the result.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_tab_helpers.sh"

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Mirror nexus_tracking.js middleware's EDIT-tracking gate. Same path-allowlist
# regex. Idempotent — proxy-routed sessions can also fire this without harm.
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy))/'; then
  _nexus_add EDIT "$FILE"
fi

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
