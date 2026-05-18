# rationale: Real-time mirror of lifecycle/stop/spiralling_petulance detector.
# rationale: Blocks the 2nd no-op Bash this turn (`:`, `true`, empty printf/echo)
# rationale: before the spiral compounds. Stop-hook detector fires too late.
# rationale: Override: HME_PETULANCE_OK=1 for legitimate single no-op chains.

if [ "${HME_PETULANCE_OK:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0  # silent-ok: optional fallback path.
fi
[ -n "${CMD:-}" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.

# rationale: Mirror _NOOP_BASH from detectors/spiralling_petulance.py.
if ! printf '%s\n' "$CMD" | grep -qE "^[[:space:]]*(:|true|printf[[:space:]]+['\"]?['\"]?|echo[[:space:]]*['\"]?['\"]?)[[:space:]]*$"; then
  return 0 2>/dev/null || exit 0  # silent-ok: optional fallback path.
fi

_NPG_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
[ -n "$_NPG_TRANSCRIPT" ] && [ -f "$_NPG_TRANSCRIPT" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.

# rationale: Reuse detector's walker; one source-of-truth regex.
_NPG_PRIOR=$(_NPG_PATH="$_NPG_TRANSCRIPT" python3 - <<'PYEOF' 2>/dev/null
import os, sys
root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
if not root:
    print(0); raise SystemExit
sys.path.insert(0, os.path.join(root, "tools/HME/scripts/detectors"))
try:
    from spiralling_petulance import _current_turn_noop_tools  # noqa: WPS433
    noop_count, _failed_reads = _current_turn_noop_tools(os.environ["_NPG_PATH"])
    print(noop_count)
except Exception:  # rationale: gate fails OPEN on parser error.
    print(0)
PYEOF
)
_NPG_PRIOR="${_NPG_PRIOR:-0}"

if [ "$_NPG_PRIOR" -ge 1 ]; then
  jq -n --arg n "$_NPG_PRIOR" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("SPIRALLING_PETULANCE (real-time): blocking 2nd no-op Bash this turn (prior count=" + $n + "). The current command (`:` / `true` / empty printf|echo) is unconditional no-op spam typical of petulant retry-spiraling. Address the user, run a real command, or set HME_PETULANCE_OK=1 if this is genuinely intentional.")}}'
  exit 0
fi
