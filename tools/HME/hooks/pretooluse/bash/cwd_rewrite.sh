# Auto-correct bare `i/<tool>` invocations when the effective cwd is not the
# project root. Two ways the cwd diverges:
#   1. tool_input.cwd (or top-level .cwd) set to a subdir — Claude Code sets
#      this when it issues a Bash call with an explicit working directory.
#   2. Inline `cd <dir> && i/<tool> ...` — the Bash tool doesn't set cwd; the
#      agent shifted directory inline. Parse the command itself to catch it.
# Either way, rewrite occurrences of `i/<tool>` to $PROJECT_ROOT/i/<tool>.
_TOOL_CWD=$(_safe_jq "$INPUT" '.tool_input.cwd' '')
[ -z "$_TOOL_CWD" ] && _TOOL_CWD=$(_safe_jq "$INPUT" '.cwd' '')
# Cheap pre-filter: only proceed if PROJECT_ROOT is known and the command
# actually contains an i/<tool> invocation (avoids python overhead on the
# vast majority of unrelated Bash calls).
if [ -n "${PROJECT_ROOT:-}" ] \
   && echo "$CMD" | grep -qE '(^|[[:space:]])i/(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)\b'; then
  _FIXED_CMD=$(PROJECT_ROOT="$PROJECT_ROOT" TOOL_CWD="$_TOOL_CWD" python3 - "$CMD" <<'PYEOF' 2>/dev/null
import os, re, sys
cmd = sys.argv[1]
root = os.environ["PROJECT_ROOT"]
tool_cwd = os.environ.get("TOOL_CWD", "")

TOOLS = r'(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)'

def inline_cd_target(s):
    """Return the absolute path an inline `cd <dir> && ...` prefix
    resolves to (relative to tool_cwd or root). Return None if no such
    prefix is present. Handles `cd X &&`, `cd X;`, and quoted targets."""
    m = re.match(r'^\s*cd\s+(?:"([^"]+)"|\'([^\']+)\'|(\S+))\s*(?:&&|;)\s*', s)
    if not m:
        return None
    target = m.group(1) or m.group(2) or m.group(3)
    if os.path.isabs(target):
        return os.path.normpath(target)
    base = tool_cwd if tool_cwd else root
    return os.path.normpath(os.path.join(base, target))

# Determine effective cwd. Inline `cd` wins over tool_cwd because the
# shell would honor it before resolving i/<tool>.
effective_cwd = inline_cd_target(cmd) or tool_cwd or root
if os.path.normpath(effective_cwd) == os.path.normpath(root):
    # cwd already at project root — no rewrite needed.
    print(cmd, end='')
    sys.exit(0)

# Match bare `i/<tool>` at start-of-command or after whitespace or shell
# separator. Skip if already prefixed with `/` or `./`.
pat = re.compile(r'(^|(?<=[\s;&|(]))i/' + TOOLS + r'\b')
print(pat.sub(lambda m: f"{m.group(1)}{root}/i/{m.group(2)}", cmd), end='')
PYEOF
)
  if [ -n "$_FIXED_CMD" ] && [ "$_FIXED_CMD" != "$CMD" ]; then
    _RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
    if [ "$_RUN_BG" = "true" ]; then
      jq -n --arg cmd "$_FIXED_CMD" \
        '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd,"run_in_background":true}},"systemMessage":"i/ wrapper path auto-corrected — call was issued from a subdir (tool_cwd or inline cd); rewritten to absolute path under PROJECT_ROOT"}'
    else
      jq -n --arg cmd "$_FIXED_CMD" \
        '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd}},"systemMessage":"i/ wrapper path auto-corrected — call was issued from a subdir (tool_cwd or inline cd); rewritten to absolute path under PROJECT_ROOT"}'
    fi
    exit 0
  fi
fi
