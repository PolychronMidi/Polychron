#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# HME PreToolUse: Bash — block run.lock deletion + suggest HME alternatives + anti-wait injection
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Dispatch HME shell-wrapper pre-hooks. These used to be triggered by MCP
# matchers in hooks.json (mcp__HME__* PreToolUse); now HME tools run via
# Bash(i/<tool>) shell wrappers and the dispatch happens here. The handler
# scripts read stdin (the same hook JSON) and emit their own jq blocks when
# they want to deny/redirect the call.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pipeline-status polling guard — fires on `i/status`.
# Match form: `i/status`, `./i/status`, `bash i/status`, etc.
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/status\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/pretooluse_check_pipeline.sh" || true
fi
# Agent primer — fires on FIRST HME tool call of a session (any i/<hme-tool>).
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)\b|scripts/hme-cli\.js'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/pretooluse_hme_primer.sh" || true
fi

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

# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
if echo "$TRIMMED_CHECK" | grep -qE '^npm run main' && ! _onb_is_graduated; then
  if _onb_before "reviewed"; then
    CUR_STEP=$(_onb_step_label)
    jq -n --arg step "$CUR_STEP" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("HME onboarding " + $step + "\n\nYou are about to run the pipeline but changes have not been audited against the KB.\n\nAUTO-CHAIN: run `i/review -- mode=forget` first.\nWhen it reports zero warnings, onboarding advances to reviewed and your npm run main will go through.")}}'
    exit 0
  fi
fi

# Strip explicit timeouts — all project scripts handle timeouts inline.
# Uses updatedInput to silently remove timeout and let the command proceed.
TIMEOUT=$(_safe_jq "$INPUT" '.tool_input.timeout' '')
if [ -n "$TIMEOUT" ] && [ "$TIMEOUT" != "0" ]; then
  RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
  # Build updatedInput: command + run_in_background (if set) + no timeout
  if [ "$RUN_BG" = "true" ]; then
    jq -n --arg cmd "$CMD" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd,"run_in_background":true}},"systemMessage":"timeout removed — all project scripts handle timeouts inline"}'
  else
    jq -n --arg cmd "$CMD" \
      '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"command":$cmd}},"systemMessage":"timeout removed — all project scripts handle timeouts inline"}'
  fi
  exit 0
fi

# Block any bash access to compiled output — out/ is a black box
if echo "$CMD" | grep -q "tools/HME/chat/out"; then
  cd /home/jah/Polychron/tools/HME/chat && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: tools/HME/chat/out/ is a black box. Work with the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block mkdir of non-root log/, metrics/, or tmp/ directories
if echo "$CMD" | grep -qE '\bmkdir\b' && echo "$CMD" | grep -qE '/(log|metrics|tmp)($|/)'; then
  if ! echo "$CMD" | grep -qE '"?'"${PROJECT_ROOT:-/home/jah/Polychron}"'/(log|metrics|tmp)'; then
    _emit_block "BLOCKED: log/, metrics/, and tmp/ only exist at project root. Do not mkdir subdirectory variants (e.g. tools/HME/mcp/metrics/). Route all output through \$PROJECT_ROOT/{log,metrics,tmp}/."
    exit 2
  fi
fi

# Block run.lock deletion (hard rule)
if echo "$CMD" | grep -q 'run\.lock' && echo "$CMD" | grep -q 'rm'; then
  _emit_block "BLOCKED: Never delete run.lock"
  exit 2
fi

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

# Block ALL other run.lock access — reading lock status IS polling
if echo "$CMD" | grep -q 'run\.lock'; then
  _emit_block "BLOCKED: Checking run.lock is pipeline status polling. Run \`i/status\` NOW for current status, then continue with other work."
  exit 2
fi

# Redirect: metric file timestamp polling → status tool
if echo "$CMD" | grep -qE '(stat|ls -l).*(pipeline-summary|trace-summary|run-history|perceptual-report)'; then
  REASON='Checking metric timestamps is indirect pipeline polling. Run `i/status` for current status, then continue with other work.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

# Anti-wait enforcement: pipeline commands MUST use run_in_background=true.
# Only triggers when the command itself starts with the pipeline command (not when
# the string appears inside a heredoc, commit message, or other argument).
TRIMMED_CMD=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
if echo "$TRIMMED_CMD" | grep -qE '^(npm run (main|snapshot)|node lab/run)'; then
  RUN_BG=$(_safe_jq "$INPUT" '.tool_input.run_in_background' 'false')
  if [[ "$RUN_BG" != "true" ]]; then
    _emit_block "ANTI-WAIT: npm run main must use run_in_background=true. Re-issue this Bash call with run_in_background: true, then CONTINUE with parallel work (HME indexing, doc updates, src/ improvements). Stopping to wait for the pipeline is the antipattern."
    exit 2
  fi
  # Emit pipeline_start to activity bridge
  _emit_activity pipeline_start --session="$SESSION_ID"
  # Block double-backgrounding: run_in_background=true AND & in command = premature exit code 0.
  # The & makes the shell return immediately, firing a false "completed" notification while npm still runs.
  # This is the root cause of check_pipeline polling loops.
  if echo "$CMD" | grep -qE '[[:space:]]&[[:space:]]*$|[[:space:]]&$'; then
    _emit_block "BLOCKED: Do NOT use & with run_in_background=true — double-backgrounding fires a false exit-code-0 notification while npm is still running, which causes check_pipeline polling loops. Remove the & from the command."
    exit 2
  fi
fi

# Redirect: pipeline log file polling → status tool
if echo "$CMD" | grep -qE '(tail|cat|head|grep).*(r4[0-9]+_run|run\.log|pipeline\.log)'; then
  REASON='Polling pipeline logs is the antipattern. Run `i/status` for current status, then continue with other work.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

# Enrich: sleep+check pattern — allow but inject guidance
if echo "$CMD" | grep -qE 'sleep.*(tail|cat|head|grep|\.output)'; then
  REASON='sleep+check detected. Background tasks fire a completion notification — no need to poll. If you must wait, use run_in_background=true instead of sleep loops.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$reason},"systemMessage":$reason}'
  exit 0
fi

# Redirect native-tool candidates — grep/cat/head/tail/ls via Bash wastes context
# and bypasses KB enrichment. Block and give the exact native equivalent.
_TRIMMED=$(echo "$CMD" | sed 's/^[[:space:]]*//')
if echo "$_TRIMMED" | grep -qE '^grep\b'; then
  _PATTERN=$(echo "$_TRIMMED" | sed -E 's/^grep[[:space:]]+(-[^ ]+ )*//; s/[[:space:]].*//')
  _emit_block "Use the Grep tool instead of Bash grep — it is KB-enriched and context-aware.
  Grep pattern=\"${_PATTERN}\" [path=...] [glob=\"*.ts\"] [output_mode=content|files_with_matches|count] [-i=true] [-C=3]"
  exit 2
fi
if echo "$_TRIMMED" | grep -qE '^(cat|head|tail)\b'; then
  _FILE=$(echo "$_TRIMMED" | awk '{print $NF}')
  if echo "$_FILE" | grep -qE '\.(js|ts|sh|py|json|md)$'; then
    _emit_block "Use the Read tool instead of Bash cat/head/tail — it is KB-enriched and context-aware.
  Read file_path=\"${_FILE}\" [offset=N] [limit=N]"
    exit 2
  fi
fi
if echo "$_TRIMMED" | grep -qE '^ls\b'; then
  _DIR=$(echo "$_TRIMMED" | sed -E 's/^ls[[:space:]]+((-[^ ]+ )*)?//')
  _emit_block "Use the Glob tool instead of Bash ls.
  Glob pattern=\"${_DIR:-.}/**\" [path=\"${_DIR:-.}\"]"
  exit 2
fi
# FAIL FAST — the core invariant of this project: NO error, anywhere, ever, may be silently
# swallowed, suppressed, logged-and-dropped, or masked by a fallback value.
# Every error must surface immediately with full context all the way to the top of the agent's
# context stack. Treat every error as life-saving criticality.
#
# Block any command that introduces silent-failure patterns in code or scripts:
#   1. Empty catch blocks: catch {} or catch(e) {}
#   2. Empty .catch chains: .catch(() => {}) or .catch(function() {})
#   3. No-op error callbacks: onError: () => {}, reject: () => {}, onFail = () => {}
#   4. Fallback values masquerading as success (e.g. "no reason given" where "timeout" is needed)
#   5. Build/compile stderr suppressed: tsc/npm/node 2>/dev/null hides errors that must surface
# Skip code-pattern checks when the command includes git commit — message text is not
# source code and legitimately describes patterns being removed (false-positive otherwise).
if echo "$CMD" | grep -q 'git commit'; then
  exit 0
fi
if echo "$CMD" | grep -qE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' \
   || echo "$CMD" | grep -qE '\.catch\([[:space:]]*(function[[:space:]]*\(\)|(\([^)]*\))[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}\)' \
   || echo "$CMD" | grep -qE '(onError|onFail|reject)[[:space:]]*[:(=][[:space:]]*(function\s*\(\)|\([^)]*\)[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}' \
   || echo "$CMD" | grep -q 'parseArbiterResponse.*no reason given' \
   || echo "$CMD" | grep -qE '(tsc|npm run|node scripts/|eslint)[^|;&]*2>/dev/null'; then
  _emit_block "FAIL FAST VIOLATION — silent error suppression detected. No empty catch blocks, no-op onError/reject handlers, fallback values masking failures, or suppressed build stderr. Every error MUST bubble immediately: throw it, call onError(), call _postError(), reject the promise. Log to hme-errors.log. Surface in UI. No silent failures. Assume life-saving criticality."
  exit 2
fi
_streak_tick 15
if ! _streak_check; then exit 1; fi
# Redirect: repeated polling of background task output files (3rd+ check).
# Covers both /tmp/claude-*/tasks/*.output paths AND any /tmp/*.log file,
# which catches the "wait for training" / "wait for background script"
# class of antipatterns. Also catches nvidia-smi polling when a bg task
# is running (GPU-check is a proxy for "is my job done yet?").
TASK_POLL_COUNTER="/tmp/polychron-task-poll-count"
_POLLING=0
# Pattern 1: file inspection tools targeting /tmp/claude-*, /tmp/*.log, /tmp/*.output
if echo "$CMD" | grep -qE '(tail|cat|head|grep|wc|ls).*/tmp/(claude-|.*\.log|.*\.output)'; then
  _POLLING=1
fi
# Pattern 2: nvidia-smi repeatedly (GPU status polling)
if echo "$CMD" | grep -qE '^nvidia-smi|\bnvidia-smi\b.*query'; then
  _POLLING=1
fi
# Pattern 3: ps -ef/aux piped through grep to find a specific background process
if echo "$CMD" | grep -qE 'ps\s+-[aef]+.*\|\s*grep' && echo "$CMD" | grep -qvE 'grep.*sudo'; then
  _POLLING=1
fi
if [ "$_POLLING" -eq 1 ]; then
  COUNT=$(_safe_int "$(cat "$TASK_POLL_COUNTER" 2>/dev/null)" 0)
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$TASK_POLL_COUNTER"
  if [ "$COUNT" -gt 2 ]; then
    jq -n --arg count "$COUNT" \
      '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":("PSYCHOPATHIC POLLING #" + $count + ": you are repeatedly checking background task status. Background processes fire a completion notification when done — WAIT for it. Working on independent parallel tasks is fine; re-checking the same file or nvidia-smi or ps is not. Do real work until the notification arrives.")},"systemMessage":("PSYCHOPATHIC POLLING #" + $count + ": repeated background-status polling. Do real work.")}'
    exit 0
  fi
fi
exit 0
