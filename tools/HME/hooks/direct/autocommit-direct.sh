#!/usr/bin/env bash
# Direct autocommit — runs from Claude Code's hook settings.json WITHOUT
# going through the HME proxy.
#
# Why this exists:
#
# The primary hook path goes through _proxy_bridge.sh, which POSTs to the
# HME proxy on port 9099. If the proxy is DOWN (crashed, restarting, not
# yet started), _proxy_bridge.sh fail-opens with exit 0 — Claude Code
# thinks the hook succeeded and NOTHING runs. No autocommit. No LIFESAVER.
# Silence.
#
# This direct script is wired as a SECOND hook alongside the proxy path.
# It runs unconditionally, regardless of proxy state, and commits the
# working tree through the _autocommit.sh helper. If the proxy IS up and
# ALSO did an autocommit, the second attempt safely no-ops ("nothing to
# commit" → success path in the helper).
#
# Requirements:
#  - Must NOT source _safety.sh. _safety.sh has `set -euo pipefail` plus
#    .env loading that can itself fail silently. This script bypasses the
#    fragile layer that keeps breaking.
#  - Must emit nothing to stdout (Claude Code interprets stdout as hook
#    decision JSON). stderr is fine but can be dropped by the harness,
#    so _autocommit.sh's sticky fail flag is the durable signal.
#  - Must exit 0 unconditionally. Blocking Claude Code on autocommit
#    failure would create a worse problem than silent failure.

set +e  # explicitly NOT fail-fast — we own our bookkeeping

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_DIRECT_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _DIRECT_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _DIRECT_ROOT="$CLAUDE_PROJECT_DIR"
else
  _ad_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
  while [ -n "$_ad_try" ] && [ "$_ad_try" != "/" ]; do
    if [ -d "$_ad_try/.git" ] && [ -d "$_ad_try/src" ]; then
      _DIRECT_ROOT="$_ad_try"
      break
    fi
    _ad_try="$(dirname "$_ad_try")"
  done
fi
if [ -z "$_DIRECT_ROOT" ]; then
  echo "[autocommit-direct] cannot resolve project root; exiting silently to avoid blocking the parent hook chain" >&2
  exit 0
fi

# Consume stdin (Claude Code hook payload) so the caller doesn't block.
cat >/dev/null 2>&1

# Source the helper. Use the repo copy — it's derived independently of env.
_HELPER="$_DIRECT_ROOT/tools/HME/hooks/helpers/_autocommit.sh"
if [ ! -f "$_HELPER" ]; then
  # Even the helper is missing. Last-resort: append one line to stderr and
  # to the error log, then exit 0.
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[autocommit-direct FAIL $ts] helper missing at $_HELPER" >&2
  mkdir -p "$_DIRECT_ROOT/log" 2>/dev/null
  # FAIL-LOUD on alert-sink writes (see _proxy_bridge.sh rationale).
  echo "[$ts] [autocommit-direct] helper missing at $_HELPER" >> "$_DIRECT_ROOT/log/hme-errors.log"
  mkdir -p "$_DIRECT_ROOT/tmp" 2>/dev/null
  echo "[$ts] helper missing at $_HELPER" > "$_DIRECT_ROOT/tmp/hme-autocommit.fail" 2>/dev/null
  exit 0
fi

# shellcheck source=/dev/null
source "$_HELPER"

# Track HEAD before the commit so we can detect whether a NEW commit
# landed. _ac_do_commit returns 0 for both "committed something" and
# "nothing to commit" — the only way to distinguish is HEAD movement.
_AC_HEAD_BEFORE=$(git -C "$_DIRECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")

# The helper owns everything: counter, fail flag, log, retries. We just
# call it with a caller name and let it do its thing.
_ac_do_commit "direct-${1:-unknown}" || true

# Auto-fire i/review on any NEW commit touching code/tooling. Previously
# this lived only in posttooluse_bash.sh, gated on the user manually
# running `git commit` via the Bash tool — which never happens in normal
# autocommit flow. Result: review hadn't fired in days. Now any commit
# (manual via Bash tool OR autocommit-direct OR proxy autocommit) that
# touches src/tools/HME/scripts/lab triggers the review.
_AC_HEAD_AFTER=$(git -C "$_DIRECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
if [ -n "$_AC_HEAD_BEFORE" ] && [ -n "$_AC_HEAD_AFTER" ] && [ "$_AC_HEAD_BEFORE" != "$_AC_HEAD_AFTER" ]; then
  # SPEC/TODO same-commit invariant (skill-set pattern, soft-warning form):
  # if src/** changed in this commit AND neither doc/SPEC.md nor doc/TODO.md
  # changed, surface a drift warning to hme-errors.log (LIFESAVER picks it
  # up next turn). Soft warning rather than hard block — autocommit fires
  # frequently and intermediate commits during a multi-step landing
  # legitimately may not touch the spec yet. Drift is the SUSTAINED-not-
  # touching-spec pattern; one-off skips are fine. The watchdog tier is
  # the place to catch sustained drift, not autocommit.
  _AC_DIFF=$(git -C "$_DIRECT_ROOT" diff --name-only "$_AC_HEAD_BEFORE" "$_AC_HEAD_AFTER" 2>/dev/null)
  if echo "$_AC_DIFF" | /usr/bin/grep -qE '^src/' \
     && ! echo "$_AC_DIFF" | /usr/bin/grep -qE '^doc/(SPEC|TODO)\.md$'; then
    _AC_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    echo "[$_AC_TS] [autocommit-direct] WARN spec-drift: src/ changed but doc/SPEC.md + doc/TODO.md untouched (commit ${_AC_HEAD_AFTER:0:8})" \
      >> "$_DIRECT_ROOT/log/hme-errors.log"
  fi
  if [ -x "$_DIRECT_ROOT/i/review" ]; then
    if git -C "$_DIRECT_ROOT" diff --name-only "$_AC_HEAD_BEFORE" "$_AC_HEAD_AFTER" 2>/dev/null \
         | /usr/bin/grep -qE '^(src|tools/HME|scripts|lab)/'; then
      # _lifesaver_bg backgrounds with timeout + LIFESAVER-on-failure.
      # Source it from helpers (it's defined in misc_safe.sh, sourced via
      # _safety.sh -- but _safety.sh isn't sourced in direct mode).
      # Safe inline equivalent: backgrounded subshell with timeout.
      (
        timeout 600 "$_DIRECT_ROOT/i/review" mode=forget \
          > "$_DIRECT_ROOT/tmp/hme-review-auto.out" 2>&1
        _AR_RC=$?
        if [ "$_AR_RC" -ne 0 ]; then
          _AR_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
          echo "[$_AR_TS] [review_auto_fire_direct] FAILED (rc=$_AR_RC) — see tmp/hme-review-auto.out" \
            >> "$_DIRECT_ROOT/log/hme-errors.log"
        fi
      ) >/dev/null 2>&1 &
    fi
  fi
fi

exit 0
