#!/usr/bin/env bash
# Resolve Claude Code "Command running in background ID: X" stubs to real
# task output by polling /tmp/claude-*/*/tasks/<id>.output, rewriting
# .tool_response in the stdin hook JSON in place.
# Usage: _resolve_bg_stub <max-wait-seconds> <must-contain-marker-or-empty>
# Caller MUST be in `set +e` (uses `|| true` internally).

_rbg_input="$(cat)"
_rbg_max_wait="${1:-10}"
_rbg_must_contain="${2:-}"

# Fast path: if no stub in response, pass through.
_rbg_jq_err=$(mktemp 2>/dev/null || echo "/tmp/_rbg_jq_$$.err")  # silent-ok: optional fallback path.
_rbg_tool_response="$(printf '%s' "$_rbg_input" | jq -r '.tool_response // ""' 2>"$_rbg_jq_err")"
if [ -s "$_rbg_jq_err" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  while IFS= read -r _rbg_line; do
    [ -n "$_rbg_line" ] && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [_resolve_bg_stub] jq parse failed extracting tool_response: $_rbg_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_rbg_jq_err"
fi
rm -f "$_rbg_jq_err" 2>/dev/null
_rbg_stub_line="$(printf '%s' "$_rbg_tool_response" \
  | grep -oE 'Command running in background with ID:[[:space:]]*[a-zA-Z0-9]+' | head -1 || true)"
if [ -z "$_rbg_stub_line" ]; then
  printf '%s' "$_rbg_input"
  exit 0
fi
_rbg_task_id="$(printf '%s' "$_rbg_stub_line" | grep -oE '[a-zA-Z0-9]+$' || true)"
if [ -z "$_rbg_task_id" ]; then
  printf '%s' "$_rbg_input"
  exit 0
fi

# Poll for the output file.
_rbg_output_path=""
_rbg_waited=0
while [ "$_rbg_waited" -lt "$_rbg_max_wait" ]; do
  _rbg_cand="$(find /tmp -maxdepth 5 -name "${_rbg_task_id}.output" 2>/dev/null | head -1 || true)"  # silent-ok: optional fallback path.
  if [ -n "$_rbg_cand" ] && [ -s "$_rbg_cand" ]; then
    if [ -z "$_rbg_must_contain" ] || grep -q -- "$_rbg_must_contain" "$_rbg_cand" 2>/dev/null; then  # silent-ok: optional fallback path.
      _rbg_output_path="$_rbg_cand"
      break
    fi
  fi
  sleep 1
  _rbg_waited=$((_rbg_waited + 1))
done

if [ -z "$_rbg_output_path" ]; then
  # Timed out -- surface diagnostically, pass through original.
  echo "[_resolve_bg_stub] task ${_rbg_task_id} unresolved after ${_rbg_max_wait}s${_rbg_must_contain:+ (marker=$_rbg_must_contain)}" >&2
  printf '%s' "$_rbg_input"
  exit 0
fi

_rbg_real="$(cat "$_rbg_output_path" 2>/dev/null || true)"
if [ -z "$_rbg_real" ]; then
  printf '%s' "$_rbg_input"
  exit 0
fi

# Rewrite .tool_response with the real output. Use jq with --arg so
_rbg_rewrite_err=$(mktemp 2>/dev/null || echo "/tmp/_rbg_rewrite_$$.err")  # silent-ok: optional fallback path.
_rbg_rewritten="$(printf '%s' "$_rbg_input" \
  | jq --arg real "$_rbg_real" '.tool_response = $real' 2>"$_rbg_rewrite_err" || true)"
if [ -s "$_rbg_rewrite_err" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  while IFS= read -r _rbg_line; do
    [ -n "$_rbg_line" ] && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [_resolve_bg_stub] jq rewrite failed (task=$_rbg_task_id): $_rbg_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_rbg_rewrite_err"
fi
rm -f "$_rbg_rewrite_err" 2>/dev/null
if [ -z "$_rbg_rewritten" ]; then
  # jq blew up (logged above) -- pass through to avoid wedging downstream.
  printf '%s' "$_rbg_input"
  exit 0
fi
echo "[_resolve_bg_stub] resolved task ${_rbg_task_id} after ${_rbg_waited}s (${#_rbg_real} bytes)" >&2
printf '%s' "$_rbg_rewritten"
