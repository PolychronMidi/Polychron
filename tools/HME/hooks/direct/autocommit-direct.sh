#!/usr/bin/env bash
# Direct autocommit — runs from Claude Code's hook settings.json WITHOUT
# going through the HME proxy.
#
# Why this exists:
# ---------------
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
#    decision JSON). stderr is fine but dropped by plugin machinery in
#    some paths, so _autocommit.sh's sticky fail flag is the durable
#    signal.
#  - Must exit 0 unconditionally. Blocking Claude Code on autocommit
#    failure would create a worse problem than silent failure.

set +e  # explicitly NOT fail-fast — we own our bookkeeping

# Resolve repo root. BASH_SOURCE-relative ascent is UNSAFE here because
# Claude Code invokes this hook via the plugin-cache path, where the
# ascent lands inside ~/.claude/plugins/cache/. Prefer CLAUDE_PROJECT_DIR
# (set by Claude Code on every hook invocation), then hardcoded fallback.
_DIRECT_ROOT=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _DIRECT_ROOT="$CLAUDE_PROJECT_DIR"
fi
[ -z "$_DIRECT_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _DIRECT_ROOT="/home/jah/Polychron"

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
  echo "[$ts] [autocommit-direct] helper missing at $_HELPER" >> "$_DIRECT_ROOT/log/hme-errors.log" 2>/dev/null
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
            >> "$_DIRECT_ROOT/log/hme-errors.log" 2>/dev/null
        fi
      ) >/dev/null 2>&1 &
    fi
  fi
fi

exit 0
