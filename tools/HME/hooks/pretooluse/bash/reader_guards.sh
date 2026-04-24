# Block cat/head/tail/less/more against context-guarded paths — otherwise Bash
# becomes the loophole that bypasses pretooluse_read.sh's blocklist.
# Uses shlex tokenization so we only match ACTUAL invocations (not path tokens
# buried in string literals, heredocs, or unrelated arguments).
GUARD_CFG="${PROJECT_ROOT}/tools/HME/config/context-guards.json"
if [ -f "$GUARD_CFG" ] && echo "$CMD" | grep -qE '\b(cat|head|tail|less|more|batcat|bat|diff|sed|awk|xxd|od|git)\b'; then
  BASH_HIT=$(python3 - "$CMD" "$GUARD_CFG" <<'PYEOF' 2>/dev/null
import json, os, shlex, sys
cmd, cfg = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(cfg))
except Exception:
    sys.exit(0)
try:
    tokens = shlex.split(cmd, posix=True)
except ValueError:
    tokens = cmd.split()
proj = os.environ.get("PROJECT_ROOT", "")
blocked = d.get("blocked_paths", [])
blocked_exts = d.get("blocked_extensions", [])
paginated = d.get("paginated_paths", [])
READERS = {"cat", "less", "more", "bat", "batcat", "head", "tail", "xxd", "od"}
# Tools that reveal content but whose "path argument" isn't the first non-flag.
# sed -n 'Np' <file>       — file is last arg; program is positional 1
# awk '<prog>' <file>      — first positional is program, second is file
# diff <a> <b>             — both args are files we'd reveal
SPECIAL_READERS = {"sed", "awk", "diff"}
# git subcommands that dump file content
GIT_CONTENT_SUBS = {"diff", "show", "log", "blame", "cat-file"}
REDIRECTS = {"<", "<<", "<<<", ">", ">>", "|", "||", "&&", ";", "&"}

# Per-command: which short flags take a value (so we skip both flag and value).
# Default (no entry) = all flags are boolean.
CMD_VAL_FLAGS = {
    "head": {"-n", "-c"},
    "tail": {"-n", "-c"},
    "sed":  {"-e", "-f"},
    "awk":  {"-f", "-F", "-v"},
    "od":   {"-A", "-j", "-N", "-w", "-S", "-t"},
    "xxd":  {"-s", "-l", "-c", "-g"},
}

def takes_value(cmd, flag):
    vf = CMD_VAL_FLAGS.get(cmd, set())
    return flag in vf
def check(arg):
    rel = arg
    if proj and arg.startswith(proj + "/"):
        rel = arg[len(proj) + 1:]
    for p in blocked:
        if p.endswith("/") and rel.startswith(p):
            return p
        if rel == p:
            return p
    for ext in blocked_exts:
        if rel.endswith(ext):
            return f"*{ext}"
    # Paginated: blocked unless the invocation used -n (head/tail pagination)
    return None  # paginated handled below with context
def check_path_arg(t, used_pagination):
    """Check a single path argument against blocklists and paginated-only list.
    Returns a hit string (reason) or None."""
    hit = check(t)
    if hit:
        return hit
    rel = t
    if proj and t.startswith(proj + "/"):
        rel = t[len(proj) + 1:]
    for entry in paginated:
        prefix = entry.get("prefix", "")
        if prefix and rel.startswith(prefix) and not used_pagination:
            return f"{prefix} (paginated-only; pass -n N or use Read with limit)"
    return None

i = 0
while i < len(tokens):
    tok = tokens[i]
    # Peel off command-prefixing shell wrappers
    if tok in ("sudo", "env", "time", "nice"):
        i += 1
        continue
    cmd_name = tok.split("/")[-1]

    # git <subcommand> [flags] [-- <path>]
    if cmd_name == "git":
        # Find subcommand (first non-flag token after `git`)
        sub = None
        for k in range(i + 1, len(tokens)):
            if tokens[k].startswith("-"):
                continue
            sub = tokens[k]
            break
        if sub in GIT_CONTENT_SUBS:
            # Scan remaining tokens for path arguments — git diff reveals
            # anything it mentions as a pathspec. `git show HEAD:path` uses
            # a colon-joined ref:path form; extract the path part.
            for t in tokens[i + 2:]:
                if t in REDIRECTS:
                    break
                if t == "--" or t.startswith("-"):
                    continue
                # Extract path from ref:path or branch..branch --
                candidate = t.split(":", 1)[-1] if ":" in t and not t.startswith("/") else t
                hit = check_path_arg(candidate, used_pagination=False)
                if hit:
                    print(f"{hit} (via git {sub})"); sys.exit(0)
        i += 1
        continue

    # Standard readers: cat, head, tail, less, more, bat, xxd, od
    if cmd_name in READERS:
        used_pagination = False
        j = i + 1
        while j < len(tokens):
            t = tokens[j]
            if t in REDIRECTS:
                break
            if t.startswith("-"):
                if takes_value(cmd_name, t):
                    used_pagination = True
                    j += 2
                    continue
                # -nN style (e.g. tail -n50); only head/tail treat numeric tails as pagination
                if t[1:].isdigit() and cmd_name in ("head", "tail"):
                    used_pagination = True
                j += 1
                continue
            hit = check_path_arg(t, used_pagination)
            if hit:
                print(hit); sys.exit(0)
            break
        i = j + 1
        continue

    # Special readers: diff A B / sed [-e prog | prog] FILE / awk [-f scr | prog] FILE
    if cmd_name in SPECIAL_READERS:
        # sed/awk's program can come from positional #1 OR from -e/-f flags.
        # If -e/-f specified the program, then positional #1 is already a file.
        j = i + 1
        positional = 0
        program_specified_via_flag = False
        while j < len(tokens):
            t = tokens[j]
            if t in REDIRECTS:
                break
            if t.startswith("-"):
                if takes_value(cmd_name, t):
                    if cmd_name == "sed" and t in ("-e", "-f"):
                        program_specified_via_flag = True
                    elif cmd_name == "awk" and t == "-f":
                        program_specified_via_flag = True
                    j += 2
                    continue
                j += 1
                continue
            positional += 1
            # sed/awk program is positional #1 ONLY when not already given via flag.
            # diff has no program — both positionals are files.
            if cmd_name in ("sed", "awk") and positional == 1 and not program_specified_via_flag:
                j += 1
                continue
            hit = check_path_arg(t, used_pagination=False)
            if hit:
                print(f"{hit} (via {cmd_name})"); sys.exit(0)
            j += 1
        i += 1
        continue

    i += 1
PYEOF
)
  if [ -n "$BASH_HIT" ]; then
    _emit_block "BLOCKED: Bash reader (cat/head/tail/less/more) targets context-guarded path '$BASH_HIT' (see tools/HME/config/context-guards.json). Use Grep with a targeted pattern, or head/tail -n N for paginated files."
    exit 2
  fi
fi
