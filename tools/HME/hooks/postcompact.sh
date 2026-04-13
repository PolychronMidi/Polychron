#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostCompact: re-surface pending KB anchors, tracked note files, and session orientation
cat > /dev/null  # consume stdin

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOKS_DIR/_nexus.sh"

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
HME_LOG="$PROJECT/log/hme.log"
printf '%s INFO compact: POST-COMPACT event triggered\n' "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
TAB="$PROJECT/tmp/hme-tab.txt"
PARTS=()

if [[ -f "$TAB" && -s "$TAB" ]]; then
  KB_LINES=$(grep '^KB:' "$TAB" 2>/dev/null)
  if [[ -n "$KB_LINES" ]]; then
    PARTS+=("POST-COMPACT: pending KB anchors still unsaved:")
    PARTS+=("$KB_LINES")
    PARTS+=("")
  fi

  FILE_LINES=$(grep '^FILE:' "$TAB" 2>/dev/null)
  if [[ -n "$FILE_LINES" ]]; then
    PARTS+=("Tracked note files from this session:")
    PARTS+=("$FILE_LINES")
  fi
fi

if [[ ${#PARTS[@]} -gt 0 ]]; then
  printf '%s\n' "${PARTS[@]}" >&2
fi

# Log post-compact event. The statusline meter hasn't fired yet with the new (reset) context value,
# so used_pct here is still the pre-compact reading — the delta between this and the next
# statusline update shows how much context was freed.
CTX_FILE="${HME_CTX_FILE:-/tmp/claude-context.json}"
LOG="$PROJECT/metrics/compact-log.jsonl"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [[ -f "$CTX_FILE" ]]; then
  USED=$(jq -r '.used_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  REM=$(jq -r '.remaining_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  echo "{\"ts\":\"$TS\",\"event\":\"post_compact\",\"stale_used_pct\":$USED,\"stale_remaining_pct\":$REM}" >> "$LOG"
else
  echo "{\"ts\":\"$TS\",\"event\":\"post_compact\",\"stale_used_pct\":null,\"stale_remaining_pct\":null}" >> "$LOG"
fi

# Reset context meter — compaction freed the window. Only clear token counts;
# used_pct will be written by statusLine on the next assistant message.
echo '{}' > "${HME_CTX_FILE:-/tmp/claude-context.json}"

# Re-orient after compaction — surface current session state directly
ORIENT=""
PS="$PROJECT/metrics/pipeline-summary.json"
if [ -f "$PS" ]; then
  VERDICT=$(_safe_py3 "import json; print(json.load(open('$PS')).get('verdict',''))" '')
  WALL=$(_safe_py3 "import json; d=json.load(open('$PS')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
  [ -n "$VERDICT" ] && ORIENT="$ORIENT\n  Pipeline: $VERDICT${WALL:+ (${WALL})}"
fi
CHANGED=$(_safe_int "$(git -C "$PROJECT" diff --name-only 2>/dev/null | wc -l)")
[ "$CHANGED" -gt 0 ] && ORIENT="$ORIENT\n  Uncommitted: $CHANGED file(s)"
LAST_COMMIT=$(git -C "$PROJECT" log --oneline -1 2>/dev/null)
[ -n "$LAST_COMMIT" ] && ORIENT="$ORIENT\n  Last commit: $LAST_COMMIT"
PENDING=$(_nexus_pending)
[ -n "$PENDING" ] && ORIENT="$ORIENT\n  Pending:$PENDING"
echo -e "[PostCompact] Context compacted. Session state:$ORIENT" >&2

exit 0
