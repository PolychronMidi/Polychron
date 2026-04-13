#!/usr/bin/env bash
# Nexus — shared lifecycle state for the hook web.
# Every hook sources this. State lives in tmp/hme-nexus.state.
# Format: TYPE:TIMESTAMP:PAYLOAD (one per line, grep-friendly).

_NEXUS_FILE="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}/tmp/hme-nexus.state"

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
  echo -e "$issues"
}
