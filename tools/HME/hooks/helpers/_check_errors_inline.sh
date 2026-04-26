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

  [ ! -f "$ERROR_LOG" ] && return 0

  local TOTAL WATERMARK
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)
  TOTAL=${TOTAL:-0}
  WATERMARK=$(cat "$INLINE_WATERMARK" 2>/dev/null | tr -d ' \t\n' || echo 0)
  WATERMARK=${WATERMARK:-0}

  # No new errors since last inline check.
  [ "$TOTAL" -le "$WATERMARK" ] && return 0

  # Severity-based classifier (mirrors lifesaver.sh).
  local _OBS_RE='\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b'
  local NEW_RAW AGENT_ERRORS SELF_ERRORS
  NEW_RAW=$(awk "NR > $WATERMARK" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
  AGENT_ERRORS=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -vE "$_OBS_RE" | /usr/bin/grep -v '^$' || true)
  SELF_ERRORS=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -E "$_OBS_RE" | /usr/bin/grep -v '^$' || true)

  # Always advance watermark so the same errors don't surface twice.
  echo "$TOTAL" > "$INLINE_WATERMARK" 2>/dev/null

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
    jq -n \
      --arg banner "$BANNER" \
      '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":$banner},"systemMessage":$banner}' 2>/dev/null
  fi

  return 0
}
