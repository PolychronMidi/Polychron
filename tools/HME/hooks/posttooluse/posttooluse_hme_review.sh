#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: `i/review` dispatch (called by posttooluse_bash.sh).
# Parses the review mode out of tool_input.command (either `mode=forget` or
# `--mode forget`) — default digest.
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')
MODE=$(echo "$CMD" | grep -oE '\bmode[= ][a-z_]+' | head -1 | sed -E 's/^.*mode[= ]//')
[ -z "$MODE" ] && MODE="digest"

if [ "$MODE" = "forget" ]; then
  # EDIT clear + REVIEW mark live in BOTH the proxy middleware and this hook.
  # The middleware path covers sessions whose API requests route through the
  # HME proxy. Direct-to-api.anthropic.com sessions (VS Code Claude Code with
  # no HME_PROXY_URL) never trigger the middleware, so without the shell-hook
  # path here, EDIT entries accumulated indefinitely and stop.sh blocked
  # forever. _nexus_clear_type is idempotent — double-clear is safe when both
  # paths fire.
  TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
  # Fail-fast on CLI transport errors — `hme-cli: request failed ...` means
  # the worker was down or the request timed out. Never interpret that as
  # "review passed with zero issues"; mark CLI_FAILURE in nexus so stop.sh
  # blocks until the user notices.
  if echo "$TOOL_RESULT" | grep -q '^hme-cli:'; then
    _nexus_mark REVIEW_CLI_FAILURE "review CLI failed — worker down or request timed out"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review CLI call failed — worker down? Cannot trust REVIEW_ISSUES state. Re-run i/review mode=forget after fixing." >&2
    exit 0
  fi
  # Canonical verdict detection.
  #
  # The server's single source of truth is the structured HTML-comment marker
  # emitted by onboarding_chain.emit_review_verdict_marker(verdict):
  #   <!-- HME_REVIEW_VERDICT: clean -->
  #   <!-- HME_REVIEW_VERDICT: warnings -->
  #   <!-- HME_REVIEW_VERDICT: error -->
  # If the marker is present, trust it exclusively and skip prose parsing.
  # Prose-count patterns ("Found N issues total") are fallback only, kept
  # for older review outputs that predate the marker.
  # `|| true` on every grep is load-bearing — under `set -euo pipefail` a
  # grep that legitimately finds nothing returns 1 and would kill the hook
  # before the drift-detection branch runs, letting format drift masquerade
  # as a silent pass. Trailing `|| true` converts "no match" to empty string.
  VERDICT_MARKER=$(echo "$TOOL_RESULT" | { grep -oE '<!--[[:space:]]*HME_REVIEW_VERDICT:[[:space:]]*(clean|warnings|error)[[:space:]]*-->' || true; } | head -1 | { grep -oE '(clean|warnings|error)' || true; })
  ISSUES_COUNT=$(echo "$TOOL_RESULT" | { grep -oE 'Found [0-9]+ issues total' || true; } | { grep -oE '[0-9]+' || true; } | head -1)
  if [ -n "$VERDICT_MARKER" ]; then
    case "$VERDICT_MARKER" in
      clean)
        _nexus_clear_type REVIEW_CLI_FAILURE
        _nexus_clear_type REVIEW_PARSE_FAILED
        _nexus_clear_type REVIEW_ISSUES
        _EDIT_COUNT_CLEARED=$(_nexus_count EDIT)
        _nexus_clear_type EDIT
        _nexus_mark REVIEW "$_EDIT_COUNT_CLEARED"
        ;;
      warnings)
        _nexus_clear_type REVIEW_CLI_FAILURE
        _nexus_clear_type REVIEW_PARSE_FAILED
        # Prefer the precise count when present; otherwise record "?" so the
        # stop hook still blocks on unknown-count warnings.
        if [ -n "$ISSUES_COUNT" ] && [ "$ISSUES_COUNT" -gt 0 ] 2>/dev/null; then
          _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
          echo "NEXUS: ${ISSUES_COUNT} review issue(s) found — fix and re-run i/review mode=forget until 0." >&2
        else
          _nexus_mark REVIEW_ISSUES "?"
          echo "NEXUS: review reported warnings (exact count unavailable) — fix and re-run i/review mode=forget." >&2
        fi
        ;;
      error)
        _nexus_mark REVIEW_CLI_FAILURE "review emitted verdict=error — server-side exception during what_did_i_forget"
        _nexus_mark REVIEW_ISSUES "?"
        echo "NEXUS: review server-side error — see worker log. Re-run i/review mode=forget after fixing." >&2
        exit 0
        ;;
      *)
        # Impossible branch: grep already constrained to (clean|warnings|error).
        # Treat as parse failure rather than silently passing.
        _nexus_mark REVIEW_PARSE_FAILED "unreachable verdict value: $VERDICT_MARKER"
        _nexus_mark REVIEW_ISSUES "?"
        exit 0
        ;;
    esac
  elif [ -n "$ISSUES_COUNT" ] && [ "$ISSUES_COUNT" -gt 0 ] 2>/dev/null; then
    # Legacy path: no marker, but explicit issue count present.
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_mark REVIEW_ISSUES "$ISSUES_COUNT"
    echo "NEXUS: ${ISSUES_COUNT} review issue(s) found — fix and re-run i/review mode=forget until 0." >&2
  elif echo "$TOOL_RESULT" | grep -qE 'Found 0 issues total|^All clean$|review passed'; then
    # Legacy path: no marker, but an explicit zero-issues sentinel.
    _nexus_clear_type REVIEW_CLI_FAILURE
    _nexus_clear_type REVIEW_PARSE_FAILED
    _nexus_clear_type REVIEW_ISSUES
  else
    # No canonical marker, no legacy sentinel — the server output has drifted
    # OR the worker returned a non-review payload. Refuse to silently claim
    # review passed. This is the exact path that let the missing-sentinel bug
    # masquerade as "clean" before the marker was added to the regex.
    _nexus_mark REVIEW_PARSE_FAILED "review output missing HME_REVIEW_VERDICT marker and all legacy sentinels — sentinel list drifted from server emit"
    _nexus_mark REVIEW_ISSUES "?"
    echo "NEXUS: review output missing canonical HME_REVIEW_VERDICT marker — server/hook sentinel contract broken. Investigate emit_review_verdict_marker() before proceeding." >&2
    exit 0
  fi
  # Point to next step
  if _nexus_has PIPELINE; then
    VERDICT=$(_nexus_get PIPELINE)
    if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
      echo "NEXUS: Pipeline already passed ($VERDICT). Commit if not done yet." >&2
    fi
  else
    echo "NEXUS: Ready for pipeline run (npm run main)." >&2
  fi
fi

_streak_reset

exit 0
