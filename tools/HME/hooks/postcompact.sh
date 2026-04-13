#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostCompact: re-surface pending KB anchors and tracked note files after compaction
cat > /dev/null  # consume stdin

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

# Reset context meter — compaction freed the context window; PTY will see this on next initBuf
echo '{"used_pct":5,"remaining_pct":95,"size":200000,"input_tokens":10000,"output_tokens":0}' > "${HME_CTX_FILE:-/tmp/claude-context.json}"

# Suggest resume after compaction — context was just lost
echo "Context compacted. Use mcp__HME__status(mode='resume') for session state recovery." >&2

exit 0
