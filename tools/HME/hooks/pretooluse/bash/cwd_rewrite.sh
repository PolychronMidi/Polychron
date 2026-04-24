# Auto-correct bare `i/<tool>` invocations to an absolute path under
# PROJECT_ROOT. Always rewrites — the previous conditional-rewrite depended
# on knowing the shell's real cwd, but Claude Code doesn't always populate
# `tool_input.cwd`, so the rewriter's cwd guess fell back to root and the
# rewrite was skipped even when the Bash tool's persistent cwd was a
# subdir from a prior `cd`. That produced the hard-to-debug failure
# `/bin/bash: i/review: No such file or directory` even though every
# surface command pattern "should have" rewritten.
#
# Rewriting is idempotent (absolute path works from any cwd) and cheap
# (regex substitution), so we drop the cwd-guessing entirely. Still skips
# when already absolute (leading `/`) or ./-prefixed.
if [ -n "${PROJECT_ROOT:-}" ] \
   && echo "$CMD" | grep -qE '(^|[[:space:]])i/(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)\b'; then
  _FIXED_CMD=$(PROJECT_ROOT="$PROJECT_ROOT" python3 - "$CMD" <<'PYEOF' 2>/dev/null
import os, re, sys
cmd = sys.argv[1]
root = os.environ["PROJECT_ROOT"]
TOOLS = r'(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)'
# Match bare `i/<tool>` at start-of-command or after whitespace/shell
# separator. Skip occurrences already prefixed with `/` or `./` —
# the preceding lookbehind is [\s;&|(] so `/i/x` and `./i/x` don't match.
pat = re.compile(r'(^|(?<=[\s;&|(]))i/' + TOOLS + r'\b')
print(pat.sub(lambda m: f"{m.group(1)}{root}/i/{m.group(2)}", cmd), end='')
PYEOF
)
  if [ -n "$_FIXED_CMD" ] && [ "$_FIXED_CMD" != "$CMD" ]; then
    _RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
    if [ "$_RUN_BG" = "true" ]; then
      jq -n --arg cmd "$_FIXED_CMD" \
        '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd,"run_in_background":true}},"systemMessage":"i/ wrapper path auto-corrected — rewritten to absolute path under PROJECT_ROOT"}'
    else
      jq -n --arg cmd "$_FIXED_CMD" \
        '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd}},"systemMessage":"i/ wrapper path auto-corrected — rewritten to absolute path under PROJECT_ROOT"}'
    fi
    exit 0
  fi
fi
