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
  # FAIL-LOUD: was `2>/dev/null`. A python crash here silently disabled
  # the i/wrapper path auto-correct, leading to the hard-to-debug
  # `i/review: No such file or directory` error class this very hook
  # was added to fix.
  _CWD_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_cwd_py_err_$$")
  _FIXED_CMD=$(PROJECT_ROOT="$PROJECT_ROOT" python3 - "$CMD" <<'PYEOF' 2>"$_CWD_PY_ERR"
import os, re, sys
cmd = sys.argv[1]
root = os.environ["PROJECT_ROOT"]
TOOLS = r'(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)'
pat = re.compile(r'(^|(?<=[\s;&|(]))i/' + TOOLS + r'\b')
print(pat.sub(lambda m: f"{m.group(1)}{root}/i/{m.group(2)}", cmd), end='')
PYEOF
)
  if [ -s "$_CWD_PY_ERR" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _CWD_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _cwd_line; do
      [ -n "$_cwd_line" ] && echo "[$_CWD_TS] [cwd_rewrite] python3 failed (i/ rewrite skipped): $_cwd_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_CWD_PY_ERR"
  fi
  rm -f "$_CWD_PY_ERR" 2>/dev/null
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
