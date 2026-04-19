#!/usr/bin/env bash
# Nexus — shared lifecycle state for the hook web.
# Every hook sources this. State lives in tmp/hme-nexus.state.
# Format: TYPE:TIMESTAMP:PAYLOAD (one per line, grep-friendly).

_NEXUS_FILE="$PROJECT_ROOT/tmp/hme-nexus.state"

_nexus_ensure() {
  mkdir -p "$(dirname "$_NEXUS_FILE")"
  touch "$_NEXUS_FILE"
}

_nexus_reset() {
  _nexus_ensure
  > "$_NEXUS_FILE"
}

_nexus_add() {
  local type="$1" payload="${2:-}"
  _nexus_ensure
  echo "${type}:$(date +%s):${payload}" >> "$_NEXUS_FILE"
}

_nexus_mark() {
  local type="$1" payload="${2:-}"
  _nexus_ensure
  # Remove old entries of this type, add new one
  grep -v "^${type}:" "$_NEXUS_FILE" > "${_NEXUS_FILE}.tmp" 2>/dev/null || true
  echo "${type}:$(date +%s):${payload}" >> "${_NEXUS_FILE}.tmp"
  mv "${_NEXUS_FILE}.tmp" "$_NEXUS_FILE"
}

_nexus_clear_type() {
  local type="$1"
  _nexus_ensure
  grep -v "^${type}:" "$_NEXUS_FILE" > "${_NEXUS_FILE}.tmp" 2>/dev/null || true
  mv "${_NEXUS_FILE}.tmp" "$_NEXUS_FILE"
}

_nexus_has() {
  local type="$1" payload="${2:-}"
  _nexus_ensure
  if [ -n "$payload" ]; then
    grep -q "^${type}:[0-9]*:${payload}$" "$_NEXUS_FILE" 2>/dev/null
  else
    grep -q "^${type}:" "$_NEXUS_FILE" 2>/dev/null
  fi
}

_nexus_count() {
  local type="$1"
  _nexus_ensure
  local c; c=$(grep -c "^${type}:" "$_NEXUS_FILE" 2>/dev/null || true)
  echo "${c:-0}" | tr -d '[:space:]'
}

_nexus_get() {
  local type="$1"
  _nexus_ensure
  grep "^${type}:" "$_NEXUS_FILE" 2>/dev/null | tail -1 | cut -d: -f3-
}

_nexus_list() {
  local type="$1"
  _nexus_ensure
  grep "^${type}:" "$_NEXUS_FILE" 2>/dev/null | cut -d: -f3-
}

_nexus_pending() {
  _nexus_ensure
  local issues=""
  local edit_count; edit_count=$(_nexus_count EDIT)
  if [ "$edit_count" -gt 0 ]; then
    issues="${issues}\n  - ${edit_count} edited file(s) not yet reviewed: run review(mode='forget')"
  fi
  local ri_count; ri_count=$(_nexus_get REVIEW_ISSUES)
  if [ -n "$ri_count" ] && [ "$ri_count" -gt 3 ] 2>/dev/null; then
    issues="${issues}\n  - ${ri_count} unresolved review issue(s) — fix then re-run review(mode='forget') until count drops to 0"
  fi
  local verdict; verdict=$(_nexus_get PIPELINE)
  if [ "$verdict" = "STABLE" ] || [ "$verdict" = "EVOLVED" ]; then
    if ! _nexus_has COMMIT; then
      issues="${issues}\n  - Pipeline passed ($verdict) but changes not committed"
    fi
  fi
  if [ "$verdict" = "FAILED" ] || [ "$verdict" = "DRIFTED" ]; then
    issues="${issues}\n  - Pipeline $verdict — needs diagnosis before stopping"
  fi
  local commit_fail; commit_fail=$(_nexus_get COMMIT_FAILED)
  if [ -n "$commit_fail" ]; then
    issues="${issues}\n  - COMMIT FAILED: $commit_fail — run 'git status' and commit manually"
  fi
  # Onboarding: if state is 'verified', the agent has a clean pipeline but
  # hasn't called learn() yet — graduation requires it.
  local _onb_f="$PROJECT_ROOT/tmp/hme-onboarding.state"
  if [ -f "$_onb_f" ]; then
    local _onb_s; _onb_s="$(cat "$_onb_f" 2>/dev/null | tr -d '[:space:]')"
    if [ "$_onb_s" = "verified" ]; then
      issues="${issues}\n  - Onboarding step 8/8: pipeline STABLE but learn() not called — run learn(title='round summary', content='...') to graduate"
    fi
  fi
  echo -e "$issues"
}

# Canonical BRIEF-recording entry point. Writes to tmp/hme-nexus.state AND
# emits a `brief_recorded` activity event so downstream can see WHICH paths
# are firing. Centralizes what was previously 4 independent _nexus_add
# call sites (posttooluse_read_kb, posttooluse_hme_read, pretooluse_grep,
# nexus_tracking.js middleware) — each can still call _nexus_add directly
# for backward compat, but new paths should use _brief_add.
_brief_add() {
  local target="${1:-}" source="${2:-unknown}"
  [ -z "$target" ] && return 0
  # Store under multiple forms so hme_read_prior matching works regardless
  # of whether downstream looks up by module / basename / abs path.
  _nexus_add BRIEF "$target"
  if [[ "$target" == */* ]]; then
    # It's a path — also store basename and module stem
    local _basename _stem
    _basename="$(basename "$target")"
    _stem="${_basename%.*}"
    [ -n "$_basename" ] && _nexus_add BRIEF "$_basename"
    [ -n "$_stem" ] && [ "$_stem" != "$_basename" ] && _nexus_add BRIEF "$_stem"
  fi
  # Derive file + module fields separately for structured downstream filtering
  local _brief_file="" _brief_module=""
  if [[ "$target" == */* ]]; then
    _brief_file="$target"
    local _bn; _bn="$(basename "$target")"
    _brief_module="${_bn%.*}"
  else
    _brief_module="$target"
  fi
  # Emit activity event in background; never block the caller
  if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ] 2>/dev/null; then
    python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
      --event=brief_recorded \
      --target="$target" \
      --file="$_brief_file" \
      --module="$_brief_module" \
      --source="$source" \
      --session="$(whoami 2>/dev/null || echo shell)" \
      >/dev/null 2>&1 &
  fi
}
