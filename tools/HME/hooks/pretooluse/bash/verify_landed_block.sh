# Block verify-the-edit-landed Bash patterns. Edit tool already returns
# "updated successfully"; re-grepping is context-burn. Override: HME_VERIFY_LANDED_OK=1.
if [ "${HME_VERIFY_LANDED_OK:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0  # silent-ok: optional fallback path.
fi

_VLB_TURN_EDITS="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
[ -s "$_VLB_TURN_EDITS" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.
[ -n "${CMD:-}" ] || { return 0 2>/dev/null || exit 0; }  # silent-ok: optional fallback path.

_VLB_HIT=$(_VLB_CMD="$CMD" _VLB_FILE="$_VLB_TURN_EDITS" python3 - <<'PYEOF' 2>/dev/null  # silent-ok: optional fallback path.
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
  _VLB_MSG="verify-landed antipattern -- Bash reads $_VLB_HIT which was Edit/Written this turn. The Edit tool already returned 'updated successfully' as explicit confirmation; re-grepping is context-burn. Trust the success affordance. Override: HME_VERIFY_LANDED_OK=1."
  if ! _VLB_COUNT=$(_VLB_FILE="${PROJECT_ROOT:-}/tmp/hme-verify-landed-grace.tsv" _VLB_HIT="$_VLB_HIT" python3 - <<'PYEOF' 2>/dev/null  # silent-ok: optional fallback path.
import os, time
path = os.environ.get("_VLB_FILE", "")
hit = os.environ.get("_VLB_HIT", "")
now = int(time.time())
cutoff = now - 180
rows = []
if path and os.path.isfile(path):
    with open(path) as f:
        for line in f:
            parts = line.rstrip("\n").split("\t", 1)
            if len(parts) == 2 and parts[0].isdigit() and int(parts[0]) >= cutoff:
                rows.append((int(parts[0]), parts[1]))
rows.append((now, hit))
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = f"{path}.{os.getpid()}.tmp"
with open(tmp, "w") as f:
    for ts, label in rows:
        f.write(f"{ts}\t{label}\n")
os.replace(tmp, path)
print(len(rows))
PYEOF
); then
    _VLB_COUNT=3
  fi
  if [ "$_VLB_COUNT" -le 1 ]; then
    return 0 2>/dev/null || exit 0  # silent-ok: optional fallback path.
  fi
  if [ "$_VLB_COUNT" -eq 2 ]; then
    _emit_enrich_allow "WARNING: $_VLB_MSG Next verify-landed violation within 3 minutes will block."
    exit 0
  fi
  _emit_block "BLOCKED: $_VLB_MSG"
  exit 2
fi
