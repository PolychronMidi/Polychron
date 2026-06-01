#!/usr/bin/env bash
# Alert-chain canary: writes [CANARY-<uuid>] to errors.log at UserPromptSubmit
# so PostToolUse/Stop lifesaver can verify it advances watermark. If injected
# but never processed -> consumer side regressed. Passive marker, never blocks.

PROJECT="${PROJECT_ROOT}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
CANARY_TRACK="$PROJECT/tools/HME/runtime/canary-pending.txt"

# UUID-ish fingerprint. Avoid uuidgen dependency.
TS=$(date +%s%N 2>/dev/null || date +%s)  # silent-ok: timestamp precision fallback only affects canary id uniqueness, not alert-chain verdict.
CANARY_ID="canary-${TS}-$RANDOM"

mkdir -p "$PROJECT/log" "$PROJECT/tmp" "$(dirname "$CANARY_TRACK")" || {
  echo "HME fail-fast: cannot create canary log/runtime directories" >&2
  exit 1
}

# downstream classifiers recognize.
printf '[%s] [CANARY-%s] alert-chain self-test injection\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CANARY_ID" \
  >> "$ERROR_LOG" || {
    echo "HME fail-fast: canary write failed: $ERROR_LOG" >&2
    exit 1
  }

# Track pending canaries so the Stop-hook watchdog can verify they got
LINE_NUM=$(wc -l < "$ERROR_LOG" | tr -d ' ') || {
  echo "HME fail-fast: cannot read canary line number from $ERROR_LOG" >&2
  exit 1
}
case "$LINE_NUM" in ''|*[!0-9]*) echo "HME fail-fast: invalid canary line number: $LINE_NUM" >&2; exit 1 ;; esac
echo "${CANARY_ID}|${LINE_NUM}|$(date +%s)" >> "$CANARY_TRACK" || {
  echo "HME fail-fast: cannot track pending canary: $CANARY_TRACK" >&2
  exit 1
}

# Heartbeat for this component too.
date +%s > "$PROJECT/tools/HME/runtime/heartbeat-canary.ts" 2>/dev/null  # silent-ok: heartbeat telemetry only; canary log+tracking above remain the load-bearing path.

exit 0
