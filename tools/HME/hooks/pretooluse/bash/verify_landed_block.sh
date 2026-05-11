# Block verify-the-edit-landed Bash patterns. Edit tool already returns
# "updated successfully"; re-grepping is context-burn. Override: HME_VERIFY_LANDED_OK=1.
if [ "${HME_VERIFY_LANDED_OK:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

_VLB_TURN_EDITS="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
[ -s "$_VLB_TURN_EDITS" ] || { return 0 2>/dev/null || exit 0; }
[ -n "${CMD:-}" ] || { return 0 2>/dev/null || exit 0; }

_VLB_HIT=$(_VLB_CMD="$CMD" _VLB_FILE="$_VLB_TURN_EDITS" python3 - <<'PYEOF' 2>/dev/null
import os, shlex
cmd = os.environ.get("_VLB_CMD", "")
edits_file = os.environ.get("_VLB_FILE", "")
if not cmd or not edits_file or not os.path.isfile(edits_file):
    raise SystemExit
edited_modules = set()
with open(edits_file) as f:
    for line in f:
        m = line.strip()
        if m:
            edited_modules.add(m)
if not edited_modules:
    raise SystemExit
try:
    tokens = shlex.split(cmd, posix=True)
except ValueError:
    tokens = cmd.split()
# Execution-verb bypass: interpreter running the file is execution, not verify.
exec_verbs = {"python", "python3", "node", "bash", "sh", "zsh", "fish", "pytest", "ruby", "perl", "go", "rustc", "ts-node", "deno"}
for tok in tokens:
    base = os.path.basename(tok)
    if base in exec_verbs or tok in exec_verbs:
        raise SystemExit
# git reads snapshots/deltas, not current state.
if any(t == "git" or os.path.basename(t) == "git" for t in tokens):
    raise SystemExit
# /tmp/ paths are scratch, not source-file reads.
if any(t.startswith("/tmp/") for t in tokens):
    raise SystemExit
verify_verbs = {"grep", "egrep", "fgrep", "rg", "ag", "ack",
                "cat", "head", "tail", "less", "more", "bat", "batcat",
                "wc", "awk", "sed"}
has_verify_verb = any(t in verify_verbs for t in tokens)
if not has_verify_verb:
    raise SystemExit
matched = None
for tok in tokens:
    base = os.path.basename(tok).rsplit(".", 1)[0]
    if base in edited_modules:
        matched = base
        break
if matched:
    print(matched)
PYEOF
)

if [ -n "$_VLB_HIT" ]; then
  _emit_block "BLOCKED: verify-landed antipattern -- Bash reads $_VLB_HIT which was Edit/Written this turn. The Edit tool already returned 'updated successfully' as explicit confirmation; re-grepping is context-burn. Trust the success affordance. Override: HME_VERIFY_LANDED_OK=1."
  exit 2
fi
