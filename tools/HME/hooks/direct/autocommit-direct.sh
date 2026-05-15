#!/usr/bin/env bash
# Direct autocommit: runs from settings.json without proxy dependency.
# Pairs with the Claude adapter path; safe no-op when both run (nothing to commit).
# Constraints: NOT _safety.sh (fragile); NO stdout (interpreted as hook JSON);
# always exit 0 (blocking would be worse than silent failure).

set +e  # explicitly NOT fail-fast -- we own our bookkeeping

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_DIRECT_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _DIRECT_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _DIRECT_ROOT="$CLAUDE_PROJECT_DIR"
else
  _ad_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # silent-ok: optional fallback path.
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

# Source the helper. Use the repo copy -- it's derived independently of env.
_HELPER="$_DIRECT_ROOT/tools/HME/hooks/helpers/_autocommit.sh"
if [ ! -f "$_HELPER" ]; then
  # Even the helper is missing. Last-resort: append one line to stderr and
  # to the error log, then exit 0.
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  echo "[autocommit-direct FAIL $ts] helper missing at $_HELPER" >&2
  mkdir -p "$_DIRECT_ROOT/log" 2>/dev/null
  # FAIL-LOUD on alert-sink writes (see claude_adapter.js rationale).
  echo "[$ts] [autocommit-direct] helper missing at $_HELPER" >> "$_DIRECT_ROOT/log/hme-errors.log"
  mkdir -p "$_DIRECT_ROOT/tmp" 2>/dev/null
  echo "[$ts] helper missing at $_HELPER" > "$_DIRECT_ROOT/runtime/hme/autocommit.fail" 2>/dev/null  # silent-ok: optional fallback path.
  exit 0
fi

# shellcheck source=/dev/null
source "$_HELPER"

# Track HEAD before the commit so we can detect whether a NEW commit
_AC_HEAD_BEFORE=$(git -C "$_DIRECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")  # silent-ok: optional fallback path.

# The helper owns everything: counter, fail flag, log, retries. We just
# call it with a caller name and let it do its thing.
_ac_do_commit "direct-${1:-unknown}" || true

# Auto-fire i/review on any NEW commit touching code/tooling. Previously
_AC_HEAD_AFTER=$(git -C "$_DIRECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")  # silent-ok: optional fallback path.
if [ -n "$_AC_HEAD_BEFORE" ] && [ -n "$_AC_HEAD_AFTER" ] && [ "$_AC_HEAD_BEFORE" != "$_AC_HEAD_AFTER" ]; then
  # SPEC/TODO same-commit invariant (skill-set pattern, soft-warning form):
  _AC_DIFF=$(git -C "$_DIRECT_ROOT" diff --name-only "$_AC_HEAD_BEFORE" "$_AC_HEAD_AFTER" 2>/dev/null)  # silent-ok: optional fallback path.
  if echo "$_AC_DIFF" | /usr/bin/grep -qE '^src/' \
     && ! echo "$_AC_DIFF" | /usr/bin/grep -qE '^doc/(SPEC|TODO)\.md$'; then
    _AC_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    echo "[$_AC_TS] [autocommit-direct] WARN spec-drift: src/ changed but doc/templates/SPEC.md + doc/templates/TODO.md untouched (commit ${_AC_HEAD_AFTER:0:8})" \
      >> "$_DIRECT_ROOT/log/hme-errors.log"
  fi
  # Auto-fire of `i/review mode=forget` after every commit was burning
  if [ "${HME_AUTOCOMMIT_REVIEW:-0}" = "1" ] && [ -x "$_DIRECT_ROOT/i/review" ]; then
# silent-ok: optional fallback path.
    if git -C "$_DIRECT_ROOT" diff --name-only "$_AC_HEAD_BEFORE" "$_AC_HEAD_AFTER" 2>/dev/null \
         | /usr/bin/grep -qE '^(src|tools/HME|scripts|lab)/'; then
      (
        timeout 600 "$_DIRECT_ROOT/i/review" mode=forget \
          > "$_DIRECT_ROOT/tmp/hme-review-auto.out" 2>&1
        _AR_RC=$?
        if [ "$_AR_RC" -ne 0 ]; then
          _AR_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
          echo "[$_AR_TS] [review_auto_fire_direct] FAILED (rc=$_AR_RC) -- see tmp/hme-review-auto.out" \
            >> "$_DIRECT_ROOT/log/hme-errors.log"
        fi
      ) >/dev/null 2>&1 &
    fi
  fi
fi

exit 0
