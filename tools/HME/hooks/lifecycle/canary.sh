#!/usr/bin/env bash
# Alert-chain canary: writes [CANARY-<uuid>] to errors.log at UserPromptSubmit
# so PostToolUse/Stop lifesaver can verify it advances watermark. If injected
# but never processed -> consumer side regressed. Passive marker, never blocks.

PROJECT="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
CANARY_TRACK="$PROJECT/runtime/hme/canary-pending.txt"

# UUID-ish fingerprint. Avoid uuidgen dependency.
TS=$(date +%s%N 2>/dev/null || date +%s)
CANARY_ID="canary-${TS}-$RANDOM"

mkdir -p "$PROJECT/log" "$PROJECT/tmp" 2>/dev/null

# Write the canary marker to errors.log. The "[CANARY-...]" prefix is what
# downstream classifiers recognize.
printf '[%s] [CANARY-%s] alert-chain self-test injection\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CANARY_ID" \
  >> "$ERROR_LOG" 2>/dev/null

# Track pending canaries so the Stop-hook watchdog can verify they got
# consumed. Append id+log-line-number so the watchdog knows where each
# canary lives.
LINE_NUM=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' ')
echo "${CANARY_ID}|${LINE_NUM}|$(date +%s)" >> "$CANARY_TRACK" 2>/dev/null

# Heartbeat for this component too.
date +%s > "$PROJECT/runtime/hme/heartbeat-canary.ts" 2>/dev/null

exit 0
