#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# First HME tool of session: emit compact orientation, never the full primer doc.
cat > /dev/null  # consume stdin

PROJECT="$PROJECT_ROOT"
FLAG="$PROJECT/tmp/hme-primer-needed.flag"
SENT="$PROJECT/tmp/hme-primer-emitted.ts"
WINDOW="${HME_PRIMER_REPEAT_WINDOW_SEC:-43200}"

[ -f "$FLAG" ] || exit 0
rm -f "$FLAG"
mkdir -p "$PROJECT/tmp"

_now=$(date +%s 2>/dev/null || echo 0)
_last=$(cat "$SENT" 2>/dev/null || echo 0)
case "$_last:$_now:$WINDOW" in
  *[!0-9:]* ) _last=0 ;;
esac
if [ "$_now" -gt 0 ] && [ "$_last" -gt 0 ] && [ "$WINDOW" -gt 0 ] \
   && [ $((_now - _last)) -lt "$WINDOW" ]; then
  exit 0
fi
echo "$_now" > "$SENT" 2>/dev/null || true

AGENT_FINGERPRINT="${CLAUDE_MODEL_ID:-unknown}"
case "$AGENT_FINGERPRINT" in
  *opus*|claude-opus*)     AGENT_TIER="rich" ;;
  *sonnet*|claude-sonnet*) AGENT_TIER="medium" ;;
  *haiku*|claude-haiku*)   AGENT_TIER="terse" ;;
  *)                       AGENT_TIER="medium" ;;
esac
printf '%s\n' "$AGENT_FINGERPRINT" > "$PROJECT/tmp/hme-agent-fingerprint.txt" 2>/dev/null || true
printf '%s\n' "$AGENT_TIER" > "$PROJECT/tmp/hme-agent-tier.txt" 2>/dev/null || true

CUR_STEP=$(_onb_step_label 2>/dev/null || echo "unknown")
CTX="=== HME PRIMER (compact) ===
Reference: doc/templates/ONBOARDING.md (not pasted; avoid context bloat)
Current onboarding step: ${CUR_STEP}
Use native tools normally; use i/<tool> only when the task actually needs HME.
If a hook blocks, follow its exact redirect. No retry dance.
TODO surfaces sync automatically: native todo/update_plan/TODO.md.
[agent tier: ${AGENT_TIER}, fingerprint: ${AGENT_FINGERPRINT}]
=== END HME PRIMER ==="

jq -n --arg ctx "$CTX" \
  '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$ctx}}'
