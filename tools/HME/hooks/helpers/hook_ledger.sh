#!/usr/bin/env bash
# Append one hook execution row to log/hme-hook-exec.jsonl.

_hme_hook_ledger_append() {
  local event="${1:-unknown}"
  local script="${2:-unknown}"
  local exit_code="${3:-0}"
  local duration_ms="${4:-0}"
  local stdout_bytes="${5:-0}"
  local stderr_bytes="${6:-0}"

  if [ -z "${PROJECT_ROOT}" ] || [ ! -d "$PROJECT_ROOT/src" ]; then
    return 0
  fi

  local log_file="$PROJECT_ROOT/log/hme-hook-exec.jsonl"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || return 0

  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
    --arg event "$event" \
    --arg script "$script" \
    --arg cwd "${PWD:-}" \
    --arg session_id "${SESSION_ID:-}" \
    --argjson exit_code "${exit_code:-0}" \
    --argjson duration_ms "${duration_ms:-0}" \
    --argjson stdout_bytes "${stdout_bytes:-0}" \
    --argjson stderr_bytes "${stderr_bytes:-0}" \
    '{ts:$ts,event:$event,script:$script,cwd:$cwd,session_id:$session_id,exit_code:$exit_code,duration_ms:$duration_ms,stdout_bytes:$stdout_bytes,stderr_bytes:$stderr_bytes}' \
    >> "$log_file" 2>/dev/null || return 0  # silent-ok: optional fallback path.

  local size
  size=$(wc -l < "$log_file" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  if [ "$size" -gt 20000 ]; then
# silent-ok: optional fallback path.
    tail -10000 "$log_file" > "${log_file}.tmp" 2>/dev/null \
      && mv "${log_file}.tmp" "$log_file" 2>/dev/null || true  # silent-ok: optional fallback path.
  fi
}
