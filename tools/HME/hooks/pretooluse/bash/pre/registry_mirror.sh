# Generic PreToolUse mirror for transcript-scope Stop detectors. Iterates
# registry.json entries with `pre_tool_use_mirror` and applies each predicate.

[ -n "${INPUT:-}" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.
_RPR_ROOT="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
[ -n "$_RPR_ROOT" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.

_RPR_PAYLOAD=$(printf '%s' "$INPUT" | jq -c '{transcript_path, tool_name, tool_input}' 2>/dev/null)
[ -n "$_RPR_PAYLOAD" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.

_RPR_OUT=$(printf '%s' "$_RPR_PAYLOAD" | python3 "${_RPR_ROOT}/tools/HME/scripts/detectors/pre_tool_use_mirror.py" 2>/dev/null || true)
if [ -n "$_RPR_OUT" ]; then
  printf '%s\n' "$_RPR_OUT"
  exit 0
fi
