# Source the policy-enabled helper. Each gate that has a JS counterpart
# in tools/HME/policies/builtin/ guards itself with `_policy_enabled` so
# `i/policies disable <name>` works uniformly across both layers (the
# disable-doesn't-fully-disable wart documented in policies/README.md).
# Use $PROJECT_ROOT (set by _safety.sh, which the parent pretooluse_bash.sh
# sources before this file). The previous BASH_SOURCE-relative `../../`
# ascent resolved into Claude Code's plugin cache when hooks were invoked
# from there -- a silent disable. The audit-shell-hooks R1 rule catches
# this specific cache-trap pattern.
source "${PROJECT_ROOT}/tools/HME/hooks/helpers/_policy_enabled.sh" 2>/dev/null || true  # silent-ok: optional fallback path.

# Block mkdir of misplaced log/, metrics/, or tmp/ directories via the
# canonical JS path_policy module used by proxy policies.
if echo "$CMD" | grep -qE '\bmkdir\b'; then
  _MKDIR_VERDICT=$(CMD="$CMD" PROJECT_ROOT="${PROJECT_ROOT:-}" node -e "
const p = require(process.env.PROJECT_ROOT + '/tools/HME/proxy/path_policy');
const cmd = process.env.CMD || '';
if (p.mkdirHasMisplacedRootOnlyDir(cmd, ['log', 'tmp'])) console.log('root-only');
else if (p.mkdirHasMisplacedMetrics(cmd)) console.log('metrics');
" 2>/dev/null || true)  # silent-ok: optional fallback path.
  if [ "$_MKDIR_VERDICT" = "root-only" ] && _policy_enabled block-mkdir-misplaced-log-tmp; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not mkdir subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
  if [ "$_MKDIR_VERDICT" = "metrics" ] && _policy_enabled block-mkdir-misplaced-metrics; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not mkdir any other metrics/ directory."
    exit 2
  fi
fi

# Block run.lock deletion (hard rule, defense-in-depth with settings.json
if _policy_enabled block-curl-pipe-sh && echo "$CMD" | grep -qE '\b(curl|wget|fetch)\b[^|]*\|[[:space:]]*(\.[[:space:]]+|sudo[[:space:]]+|exec[[:space:]]+)?(sh|bash|zsh|ksh|dash)\b'; then
  _emit_block "BLOCKED: piping a remote download into a shell interpreter (curl|sh, wget|bash, etc.) is a primary supply-chain attack pattern. Download to a file, inspect it, then execute deliberately if needed."
  exit 2
fi

if _policy_enabled block-runlock-deletion && echo "$CMD" | grep -q 'run\.lock'; then
  # FAIL-LOUD: was `2>/dev/null`. A python crash silently disabled the
  _BBG_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_bbg_py_err_$$")  # silent-ok: optional fallback path.
  _RUNLOCK_VERDICT=$(python3 - "$CMD" 2>"$_BBG_PY_ERR" <<'PY'
import shlex, sys, re
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
DELETION_VERBS = {"rm", "unlink", "shred", "truncate"}
def has_runlock(tok):
    return "run.lock" in tok
try:
    tokens = shlex.split(cmd, posix=True, comments=False)
except ValueError:
    # Mismatched quotes: fall back to substring presence checks.
    tokens = re.split(r"\s+", cmd)
joined = " ".join(tokens)
verbs_in_cmd = {t for t in tokens if t in DELETION_VERBS}
runlock_tokens = [t for t in tokens if has_runlock(t)]
# Direct deletion verb operating on a run.lock token.
if verbs_in_cmd and runlock_tokens:
    print("BLOCK:deletion_verb")
    sys.exit(0)
# `find ... run.lock ... -delete` -- find with -delete is deletion.
if "find" in tokens and runlock_tokens and any(t == "-delete" for t in tokens):
    print("BLOCK:find_delete")
    sys.exit(0)
# `mv` with run.lock as the source argument moves it out of the way --
# functionally equivalent to deletion as far as the lock contract goes.
if "mv" in tokens:
    mv_idx = tokens.index("mv")
    args = [t for t in tokens[mv_idx+1:] if not t.startswith("-")]
    if args and has_runlock(args[0]):
        print("BLOCK:mv_lock")
        sys.exit(0)
# Redirect-truncation: `> tmp/run.lock` or `>tmp/run.lock`.
if re.search(r">\s*[^|&;\s]*run\.lock\b", cmd):
    print("BLOCK:redirect_truncate")
    sys.exit(0)
# Python/Node/Perl that calls os.remove / fs.unlinkSync / unlink against
# run.lock -- string-presence inside the script body counts. Crude but
# catches the obvious scripted-bypass.
if any(t in tokens for t in ("python3", "python", "node", "perl", "ruby")):
    if re.search(r"(os\.remove|os\.unlink|unlink(Sync)?|shutil\.move|Path[^\)]*\.unlink)", cmd) and runlock_tokens:
        print("BLOCK:scripted_unlink")
        sys.exit(0)
print("ALLOW")
PY
)
  if [ -s "$_BBG_PY_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _BBG_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _bbg_line; do
      [ -n "$_bbg_line" ] && echo "[$_BBG_TS] [blackbox_guards:runlock] python3 failed (run.lock guard fails OPEN -- CRITICAL): $_bbg_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_BBG_PY_ERR"
  fi
  rm -f "$_BBG_PY_ERR" 2>/dev/null
  if [ "${_RUNLOCK_VERDICT:-}" != "ALLOW" ] && [ -n "${_RUNLOCK_VERDICT:-}" ]; then
    _emit_block "BLOCKED: Never delete run.lock (matched: ${_RUNLOCK_VERDICT})"
    exit 2
  fi
fi
