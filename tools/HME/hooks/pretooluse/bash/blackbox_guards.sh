# Source the policy-enabled helper. Each gate that has a JS counterpart
# in tools/HME/policies/builtin/ guards itself with `_policy_enabled` so
# `i/policies disable <name>` works uniformly across both layers (the
# disable-doesn't-fully-disable wart documented in policies/README.md).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../helpers/_policy_enabled.sh" 2>/dev/null || true

# Block any bash access to compiled output — out/ is a black box.
# (No JS counterpart yet — `block-out-dir-writes` covers Edit/Write but
# this also blocks Bash commands that touch out/, which is broader.)
if echo "$CMD" | grep -q "tools/HME/chat/out"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: tools/HME/chat/out/ is a black box. Work with the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block mkdir of misplaced log/, metrics/, or tmp/ directories.
# JS counterparts: block-mkdir-misplaced-log-tmp + block-mkdir-misplaced-metrics.
if _policy_enabled block-mkdir-misplaced-log-tmp && echo "$CMD" | grep -qE '\bmkdir\b' && echo "$CMD" | grep -qE '/(log|tmp)($|/)'; then
  if ! echo "$CMD" | grep -qE '"?'"${PROJECT_ROOT}"'/(log|tmp)'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not mkdir subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if _policy_enabled block-mkdir-misplaced-metrics && echo "$CMD" | grep -qE '\bmkdir\b' && echo "$CMD" | grep -qE '/metrics($|/)'; then
  if ! echo "$CMD" | grep -qE '"?'"${PROJECT_ROOT}"'/output/metrics'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not mkdir any other metrics/ directory."
    exit 2
  fi
fi

# Block run.lock deletion (hard rule). Argv-tokenized matching via shlex —
# the previous `grep run.lock && grep rm` check missed deletion-class verbs
# that aren't `rm`: mv, unlink, find -delete, shred, truncate, >run.lock
# (redirect-truncate). FailproofAI's architecture doc names argv tokenization
# as the concrete defense against shell-operator-injection bypasses; we apply
# the same idea here. Best-effort: variable-expanded paths (e.g.
# `BASE=run; rm tmp/$BASE.lock`) still require runtime evaluation to detect
# and are out of scope. The guard is paired with a settings.json deny rule
# (Bash(rm*run.lock*)) — defense in depth.
# Block curl|sh and wget|sh — supply-chain attack vector. The pattern catches
# curl/wget piped into a shell interpreter (sh, bash, zsh, ksh) regardless of
# spacing, flag order, or which way the pipe is written. FailproofAI calls this
# out as a primary class of LLM-agent compromise.
if _policy_enabled block-curl-pipe-sh && echo "$CMD" | grep -qE '\b(curl|wget|fetch)\b[^|]*\|[[:space:]]*(\.[[:space:]]+|sudo[[:space:]]+|exec[[:space:]]+)?(sh|bash|zsh|ksh|dash)\b'; then
  _emit_block "BLOCKED: piping a remote download into a shell interpreter (curl|sh, wget|bash, etc.) is a primary supply-chain attack pattern. Download to a file, inspect it, then execute deliberately if needed."
  exit 2
fi

if _policy_enabled block-runlock-deletion && echo "$CMD" | grep -q 'run\.lock'; then
  # FAIL-LOUD: was `2>/dev/null`. A python crash silently disabled the
  # run.lock deletion-block — `tmp/run.lock` is a hard rule per CLAUDE.md
  # ("Never remove tmp/run.lock"). Gate failing OPEN here is critical.
  _BBG_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_bbg_py_err_$$")
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
# `find ... run.lock ... -delete` — find with -delete is deletion.
if "find" in tokens and runlock_tokens and any(t == "-delete" for t in tokens):
    print("BLOCK:find_delete")
    sys.exit(0)
# `mv` with run.lock as the source argument moves it out of the way —
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
# run.lock — string-presence inside the script body counts. Crude but
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
      [ -n "$_bbg_line" ] && echo "[$_BBG_TS] [blackbox_guards:runlock] python3 failed (run.lock guard fails OPEN — CRITICAL): $_bbg_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_BBG_PY_ERR"
  fi
  rm -f "$_BBG_PY_ERR" 2>/dev/null
  if [ "${_RUNLOCK_VERDICT:-}" != "ALLOW" ] && [ -n "${_RUNLOCK_VERDICT:-}" ]; then
    _emit_block "BLOCKED: Never delete run.lock (matched: ${_RUNLOCK_VERDICT})"
    exit 2
  fi
fi
