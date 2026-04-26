#!/usr/bin/env bash
# Alert-chain canary. Injects a uniquely-fingerprinted line into errors.log
# at UserPromptSubmit. The expected lifecycle:
#   1. UserPromptSubmit fires this script -> writes [CANARY-<uuid>] line
#   2. PostToolUse inline-check or Stop lifesaver scans errors.log,
#      observes the canary, treats it as a self-test marker (NOT an
#      agent-error), advances watermark past it
#   3. Watchdog later verifies the canary watermark advanced as expected
#
# If the canary is INJECTED but never processed (watermark never advances),
# the alert chain has regressed -- the consumer side is broken even though
# the producer side ran. This is the inverse of the "I'll detect the next
# silent-fail one bug at a time" pattern.
#
# Canaries are passive markers, not denies. They never block the user.

PROJECT="${PROJECT_ROOT:-/home/jah/Polychron}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
CANARY_TRACK="$PROJECT/tmp/hme-canary-pending.txt"

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
date +%s > "$PROJECT/tmp/hme-heartbeat-canary.ts" 2>/dev/null

exit 0
