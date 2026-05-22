#!/usr/bin/env bash
# Mid-turn error-surface helper for PostToolUse: reads hme-errors.log new
# lines since last check, classifies via lifesaver.sh severity rule
# (WARN/INFO/DEBUG/NOTICE = observation; else agent-origin), emits as
# additionalContext. Closes the gap between mid-turn fire and end-of-turn
# Stop lifesaver scan.

# Returns:
_hme_check_errors_inline() {
  local PROJECT="${PROJECT_ROOT}"
  local ERROR_LOG="$PROJECT/log/hme-errors.log"
  local INLINE_WATERMARK="$PROJECT/tools/HME/runtime/hme-errors.inline-watermark"
  # Heartbeat -- proves this helper actually ran.
  date +%s > "$PROJECT/tools/HME/runtime/heartbeat-inline-check.ts" 2>/dev/null || true  # silent-ok: optional fallback path.

  if [ ! -f "$ERROR_LOG" ]; then
    # Genuinely no log file yet (fresh repo) is a passthrough; an
    # unreachable log file is a silent-fail vector we should surface.
    return 0
  fi

  local TOTAL WATERMARK
  # Don't suppress wc/cat stderr -- if reading fails (permission, missing
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
  local _OBS_RE='\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b'
  # Self-origin source tags -- same list as lifesaver.sh _SELF_TAG_RE.
  local _SELF_TAG_RE='^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|hook-watchdog|hook-stop-block|hook-runtime-error|hook-ui-echo-leak|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker:[^]]+)\]'
  local _CANARY_RE='\[CANARY-'
  _hme_stale_runtime_resolved_or_grace() {
    local head live marker first marker_head now grace
    head=$(git -C "$PROJECT" rev-parse --short HEAD 2>/dev/null || true)
    live=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("git_sha") or "")' "$PROJECT/tools/HME/runtime/proxy-runtime.json" 2>/dev/null || true)
    [ -n "$head" ] && [ -n "$live" ] && [ "$head" = "$live" ] && return 0
    marker="$PROJECT/tools/HME/runtime/post-commit-stale-runtime.json"
    [ -f "$marker" ] || return 1
    first=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("first_seen_epoch") or "")' "$marker" 2>/dev/null || true)
    marker_head=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("head_sha") or "")' "$marker" 2>/dev/null || true)
    case "$first" in ''|*[!0-9]*) return 1 ;; esac
    [ -n "$head" ] && [ -n "$marker_head" ] && [ "$head" != "$marker_head" ] && return 1
    now=$(date +%s)
    grace="${HME_POST_COMMIT_STALE_GRACE_SEC:-120}"
    case "$grace" in ''|*[!0-9]*) grace=120 ;; esac
    [ $((now - first)) -lt "$grace" ]
  }
  local NEW_RAW AGENT_ERRORS SELF_ERRORS CANARY_LINES
  NEW_RAW=$(awk "NR > $WATERMARK" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
  CANARY_LINES=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -E "$_CANARY_RE" || true)
  # Strip canaries before classifying so they don't count as agent-errors.
  local _NEW_NO_CANARY
  _NEW_NO_CANARY=$(printf '%s\n' "$NEW_RAW" | /usr/bin/grep -vE "$_CANARY_RE" || true)
  if _hme_stale_runtime_resolved_or_grace; then
    _NEW_NO_CANARY=$(printf '%s\n' "$_NEW_NO_CANARY" | /usr/bin/grep -v '\[stale_runtime\]' || true)
  fi
  # Two-axis classification: source-tag first (self-origin regardless of
  # severity), then severity word (self-origin if WARN/INFO/DEBUG/NOTICE).
  local _SELF_BY_TAG _REMAINING _SELF_BY_SEV
  _SELF_BY_TAG=$(printf '%s\n' "$_NEW_NO_CANARY" | /usr/bin/grep -E "$_SELF_TAG_RE" || true)
  _REMAINING=$(printf '%s\n' "$_NEW_NO_CANARY" | /usr/bin/grep -vE "$_SELF_TAG_RE" || true)
  AGENT_ERRORS=$(printf '%s\n' "$_REMAINING" | /usr/bin/grep -vE "$_OBS_RE" | /usr/bin/grep -v '^$' || true)
  _SELF_BY_SEV=$(printf '%s\n' "$_REMAINING" | /usr/bin/grep -E "$_OBS_RE" | /usr/bin/grep -v '^$' || true)
  SELF_ERRORS=$(printf '%s\n%s\n' "$_SELF_BY_TAG" "$_SELF_BY_SEV" | /usr/bin/grep -v '^$' | sort -u || true)
  # Mark each consumed canary in the pending tracker so the Stop-hook
  if [ -n "$CANARY_LINES" ]; then
    while IFS= read -r line; do
      local cid
      cid=$(printf '%s' "$line" | /usr/bin/grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
      [ -n "$cid" ] && echo "$cid|consumed-by-inline|$(date +%s)" >> "$PROJECT/tools/HME/runtime/hme-canary-consumed.txt" 2>/dev/null  # silent-ok: optional fallback path.
    done <<< "$CANARY_LINES"
  fi

  # Advance watermark BEFORE emitting, so a downstream crash doesn't cause
  if ! echo "$TOTAL" > "$INLINE_WATERMARK"; then
    echo "_check_errors_inline: failed to update watermark at $INLINE_WATERMARK" >&2
    return 1
  fi

  # Only emit if there are agent-errors. Self/observation errors are
  # informational; surfacing them mid-turn would create noise.
  if [ -n "$AGENT_ERRORS" ]; then
    local BANNER="[ALERT] LIFESAVER - MID-TURN ERRORS DETECTED:
${AGENT_ERRORS}

These fired during the just-completed tool call. Diagnose and fix BEFORE the next tool call accumulates further failures on top of broken state."
    if [ -n "$SELF_ERRORS" ]; then
      BANNER="${BANNER}

[observation-only (informational, not blocking):
${SELF_ERRORS}]"
    fi
    # additionalContext lands in the next turn's context. Silent on stdout
    if ! jq -n \
      --arg banner "$BANNER" \
      '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":$banner},"systemMessage":$banner}'; then
      echo "_check_errors_inline: jq failed to render LIFESAVER JSON" >&2
      return 1
    fi
  fi

  return 0
}
