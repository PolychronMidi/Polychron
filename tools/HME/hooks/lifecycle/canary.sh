#!/usr/bin/env bash
# Alert-chain canary: writes [CANARY-<uuid>] to errors.log at UserPromptSubmit
# so PostToolUse/Stop lifesaver can verify it advances watermark. If injected
# but never processed -> consumer side regressed. Passive marker, never blocks.

PROJECT="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
CANARY_TRACK="$PROJECT/runtime/hme/canary-pending.txt"

# UUID-ish fingerprint. Avoid uuidgen dependency.
TS=$(date +%s%N 2>/dev/null || date +%s)  # silent-ok: optional fallback path.
CANARY_ID="canary-${TS}-$RANDOM"

mkdir -p "$PROJECT/log" "$PROJECT/tmp" 2>/dev/null

# downstream classifiers recognize.
printf '[%s] [CANARY-%s] alert-chain self-test injection\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CANARY_ID" \
  >> "$ERROR_LOG" 2>/dev/null  # silent-ok: optional fallback path.

# Track pending canaries so the Stop-hook watchdog can verify they got
LINE_NUM=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' ')  # silent-ok: optional fallback path.
echo "${CANARY_ID}|${LINE_NUM}|$(date +%s)" >> "$CANARY_TRACK" 2>/dev/null  # silent-ok: optional fallback path.

# Heartbeat for this component too.
date +%s > "$PROJECT/runtime/hme/heartbeat-canary.ts" 2>/dev/null  # silent-ok: optional fallback path.

exit 0
