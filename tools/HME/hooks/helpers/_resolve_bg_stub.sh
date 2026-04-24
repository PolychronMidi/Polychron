#!/usr/bin/env bash
# Shared helper: resolve Claude Code's "Command running in background
# with ID: X" stubs into the real task-output content, rewriting the
# hook INPUT JSON's .tool_response field in place.
#
# Usage:
#   _resolve_bg_stub <max-wait-seconds> <must-contain-marker-or-empty>
#
# Consumes the hook INPUT JSON on stdin and prints the (possibly rewritten)
# JSON on stdout. Behavior:
#   - If .tool_response doesn't contain a bg-stub → pass through unchanged.
#   - If it does → extract task-id, locate /tmp/claude-*/*/tasks/<id>.output,
#     poll (1s interval, up to max-wait-seconds) for the file to contain
#     the optional must-contain-marker (or just to be non-empty if no
#     marker specified). On success, swap .tool_response to the file
#     contents. On timeout, pass through unchanged.
#
# Why this exists: when Bash auto-backgrounds a long command, every hook
# consuming .tool_response sees the useless stub instead of the real
# output. Centralising the resolution here keeps every HME sub-hook
# (review, hme_read, learn, …) inheriting the resolved result from a
# single code path rather than each re-implementing the wait.
#
# Must be invoked WITHIN a set +e block in the caller — this helper uses
# `|| true` on jq/cat fragments so partial failures don't wedge the pipe.

_rbg_input="$(cat)"
_rbg_max_wait="${1:-10}"
_rbg_must_contain="${2:-}"

# Fast path: if no stub in response, pass through.
_rbg_stub_line="$(printf '%s' "$_rbg_input" | jq -r '.tool_response // ""' 2>/dev/null \
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
  _rbg_cand="$(find /tmp -maxdepth 5 -name "${_rbg_task_id}.output" 2>/dev/null | head -1 || true)"
  if [ -n "$_rbg_cand" ] && [ -s "$_rbg_cand" ]; then
    if [ -z "$_rbg_must_contain" ] || grep -q -- "$_rbg_must_contain" "$_rbg_cand" 2>/dev/null; then
      _rbg_output_path="$_rbg_cand"
      break
    fi
  fi
  sleep 1
  _rbg_waited=$((_rbg_waited + 1))
done

if [ -z "$_rbg_output_path" ]; then
  # Timed out — surface diagnostically, pass through original.
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
# the payload is safely string-escaped regardless of content.
_rbg_rewritten="$(printf '%s' "$_rbg_input" \
  | jq --arg real "$_rbg_real" '.tool_response = $real' 2>/dev/null || true)"
if [ -z "$_rbg_rewritten" ]; then
  # jq blew up (shouldn't) — pass through to avoid wedging downstream.
  printf '%s' "$_rbg_input"
  exit 0
fi
echo "[_resolve_bg_stub] resolved task ${_rbg_task_id} after ${_rbg_waited}s (${#_rbg_real} bytes)" >&2
printf '%s' "$_rbg_rewritten"
