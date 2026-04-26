#!/usr/bin/env bash
# Mid-turn error-surface helper. Sourced by every PostToolUse hook (and any
# other hook that wants to push fresh errors into the model's next-turn
# context). Reads hme-errors.log, classifies new lines since the last
# inline check, and emits any agent-errors as additionalContext.
#
# This closes the silent-fail window between when an error fires (mid-turn)
# and when the Stop-hook lifesaver normally runs (end of turn). With this
# helper, every tool call's PostToolUse surfaces fresh errors immediately
# in the tool result, so the model sees them on the very next turn.
#
# Reuses the severity-based classifier from lifesaver.sh: lines containing
# WARN/INFO/DEBUG/NOTICE are observation-only; everything else is
# agent-origin and gets shoved into the model's teeth.

# Returns:
#   0 + JSON with hookSpecificOutput.additionalContext if new errors found
#   0 with no output if no new errors (passthrough)
#   Note: never blocks/fails the tool call; only ADDS context.
_hme_check_errors_inline() {
  local PROJECT="${PROJECT_ROOT:-/home/jah/Polychron}"
  local ERROR_LOG="$PROJECT/log/hme-errors.log"
  local INLINE_WATERMARK="$PROJECT/tmp/hme-errors.inline-watermark"
  # Heartbeat -- proves this helper actually ran.
  date +%s > "$PROJECT/tmp/hme-heartbeat-inline-check.ts" 2>/dev/null || true

  if [ ! -f "$ERROR_LOG" ]; then
    # Genuinely no log file yet (fresh repo) is a passthrough; an
    # unreachable log file is a silent-fail vector we should surface.
    return 0
  fi

  local TOTAL WATERMARK
  # Don't suppress wc/cat stderr -- if reading fails (permission, missing
  # parent dir), the caller (_proxy_bridge) routes our stderr to errors.log
  # so the failure is visible. Use -f tests + explicit zero defaults.
  TOTAL=$(wc -l < "$ERROR_LOG" | tr -d ' \t')
  TOTAL=${TOTAL:-0}
  if [ -f "$INLINE_WATERMARK" ]; then
    WATERMARK=$(cat "$INLINE_WATERMARK" | tr -d ' \t\n')
    WATERMARK=${WATERMARK:-0}
  else
    WATERMARK=0
  fi

  # No new errors since last inline check.
  [ "$TOTAL" -le "$WATERMARK" ] && return 0

  # Severity-based classifier (mirrors lifesaver.sh).
  # CANARY lines are alert-chain self-test markers; they're neither
  # agent-errors nor observations -- consume silently (advancing the
  # watermark past them is enough to prove this helper ran).
  local _OBS_RE='\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b'
  local _CANARY_RE='\[CANARY-'
  local NEW_RAW AGENT_ERRORS SELF_ERRORS CANARY_LINES
  NEW_RAW=$(awk "NR > $WATERMARK" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
  CANARY_LINES=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -E "$_CANARY_RE" || true)
  # Strip canaries before classifying so they don't count as agent-errors.
  local _NEW_NO_CANARY
  _NEW_NO_CANARY=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -vE "$_CANARY_RE" || true)
  AGENT_ERRORS=$(printf '%s\n' "$_NEW_NO_CANARY" | /usr/bin/grep -vE "$_OBS_RE" | /usr/bin/grep -v '^$' || true)
  SELF_ERRORS=$(printf '%s\n' "$_NEW_NO_CANARY" | /usr/bin/grep -E "$_OBS_RE" | /usr/bin/grep -v '^$' || true)
  # Mark each consumed canary in the pending tracker so the Stop-hook
  # watchdog knows the inline-check actually saw it. Strip the "CANARY-"
  # prefix to match the bare ID format the producer (canary.sh) writes
  # to the pending tracker -- consumed-vs-pending must use IDENTICAL ID
  # forms or the watchdog reports false-positive stale alarms.
  if [ -n "$CANARY_LINES" ]; then
    while IFS= read -r line; do
      local cid
      cid=$(printf '%s' "$line" | /usr/bin/grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
      [ -n "$cid" ] && echo "$cid|consumed-by-inline|$(date +%s)" >> "$PROJECT/tmp/hme-canary-consumed.txt" 2>/dev/null
    done <<< "$CANARY_LINES"
  fi

  # Advance watermark BEFORE emitting, so a downstream crash doesn't cause
  # the same lines to surface repeatedly. Failure to update watermark IS
  # itself a silent-fail vector -- check exit code.
  if ! echo "$TOTAL" > "$INLINE_WATERMARK"; then
    echo "_check_errors_inline: failed to update watermark at $INLINE_WATERMARK" >&2
    return 1
  fi

  # Only emit if there are agent-errors. Self/observation errors are
  # informational; surfacing them mid-turn would create noise.
  if [ -n "$AGENT_ERRORS" ]; then
    local BANNER="🚨 LIFESAVER - MID-TURN ERRORS DETECTED:
${AGENT_ERRORS}

These fired during the just-completed tool call. Diagnose and fix BEFORE the next tool call accumulates further failures on top of broken state."
    if [ -n "$SELF_ERRORS" ]; then
      BANNER="${BANNER}

[observation-only (informational, not blocking):
${SELF_ERRORS}]"
    fi
    # additionalContext lands in the next turn's context. Silent on stdout
    # for non-output-accepting events, but PostToolUse accepts this shape.
    # No stderr suppression on jq -- if jq is missing or fails, _proxy_bridge
    # routes our stderr to errors.log so the failure surfaces.
    if ! jq -n \
      --arg banner "$BANNER" \
      '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":$banner},"systemMessage":$banner}'; then
      echo "_check_errors_inline: jq failed to render LIFESAVER JSON" >&2
      return 1
    fi
  fi

  return 0
}
