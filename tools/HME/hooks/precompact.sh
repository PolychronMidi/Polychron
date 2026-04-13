#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreCompact: surface pending KB anchors and tracked note files before compaction
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
HME_LOG="$PROJECT/log/hme.log"
printf '%s INFO compact: PRE-COMPACT event triggered\n' "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
TAB="$PROJECT/tmp/hme-tab.txt"
PARTS=()

if [[ -f "$TAB" && -s "$TAB" ]]; then
  # Pending KB anchors
  KB_LINES=$(grep '^KB:' "$TAB" 2>/dev/null)
  if [[ -n "$KB_LINES" ]]; then
    PARTS+=("PENDING KB ANCHORS — save with add_knowledge before compaction:")
    PARTS+=("$KB_LINES")
    PARTS+=("")
  fi

  # Tracked note files (from background tasks, writes, agents)
  FILE_LINES=$(grep '^FILE:' "$TAB" 2>/dev/null)
  if [[ -n "$FILE_LINES" ]]; then
    PARTS+=("TRACKED NOTE FILES — check these after compaction:")
    PARTS+=("$FILE_LINES")
    PARTS+=("")
  fi
fi

# Also scan project tmp/ for recent .md/.txt not already in the tab
FOUND=$(find "$PROJECT/tmp" -maxdepth 1 \( -name "*.md" -o -name "*.txt" \) -mmin -480 ! -name "hme-tab.txt" 2>/dev/null | sort)
if [[ -n "$FOUND" ]]; then
  # Filter out files already tracked in tab
  UNTRACKED=""
  while IFS= read -r f; do
    grep -qF "$f" "$TAB" 2>/dev/null || UNTRACKED+="  $f"$'\n'
  done <<< "$FOUND"
  if [[ -n "$UNTRACKED" ]]; then
    PARTS+=("UNTRACKED SESSION FILES in tmp/:")
    PARTS+=("$UNTRACKED")
  fi
fi

## L17: Conversation entanglement — inject system self-model into compaction context
ENTANGLE="$PROJECT/tmp/hme-entanglement.json"
if [[ -f "$ENTANGLE" ]]; then
  # Build compact summary from entanglement checkpoint
  ENT_AGE=$(( $(date +%s) - $(stat -c %Y "$ENTANGLE" 2>/dev/null || echo 0) ))
  if [[ "$ENT_AGE" -lt 600 ]]; then
    COH=$(_safe_py3 "import json; d=json.load(open('$ENTANGLE')); print(f\"coherence={d.get('coherence_avg','?')} trend={d.get('coherence_trend','?')} restarts={d.get('restarts_today','?')} session={int(d.get('session_age_s',0))//60}min\")" "" 2>/dev/null)
    if [[ -n "$COH" ]]; then
      PARTS+=("[HME L17 entanglement] $COH")
    fi
  fi
fi

if [[ ${#PARTS[@]} -gt 0 ]]; then
  printf '%s\n' "${PARTS[@]}" >&2
fi

# Log compact event for context meter calibration.
# Captures the statusline's last known reading so we can compare meter estimate vs actual trigger.
CTX_FILE=/tmp/claude-context.json
LOG="$PROJECT/metrics/compact-log.jsonl"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [[ -f "$CTX_FILE" ]]; then
  USED=$(jq -r '.used_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  REM=$(jq -r '.remaining_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  SIZE=$(jq -r '.size // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  AGE=$(( $(date +%s) - $(stat -c %Y "$CTX_FILE" 2>/dev/null || echo 0) ))
  echo "{\"ts\":\"$TS\",\"event\":\"pre_compact\",\"used_pct\":$USED,\"remaining_pct\":$REM,\"ctx_size\":$SIZE,\"meter_age_s\":$AGE}" >> "$LOG"
else
  echo "{\"ts\":\"$TS\",\"event\":\"pre_compact\",\"used_pct\":null,\"remaining_pct\":null,\"ctx_size\":null,\"meter_age_s\":null,\"note\":\"no_statusline_data\"}" >> "$LOG"
fi

exit 0
