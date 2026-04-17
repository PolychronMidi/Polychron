#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# HME PreToolUse: Bash — block run.lock deletion + suggest HME alternatives + anti-wait injection
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Onboarding gate: npm run main requires 'reviewed' state (edited + reviewed)
TRIMMED_CHECK=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
if echo "$TRIMMED_CHECK" | grep -qE '^npm run main' && ! _onb_is_graduated; then
  if _onb_before "reviewed"; then
    CUR_STEP=$(_onb_step_label)
    jq -n --arg step "$CUR_STEP" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":("HME onboarding " + $step + "\n\nYou are about to run the pipeline but changes have not been audited against the KB.\n\nAUTO-CHAIN: call mcp__HME__review(mode=\"forget\") first.\nWhen it reports zero warnings, onboarding advances to reviewed and your npm run main will go through.")}}'
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
if [ -f "$GUARD_CFG" ] && echo "$CMD" | grep -qE '\b(cat|head|tail|less|more|batcat|bat)\b'; then
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
READERS = {"cat", "less", "more", "bat", "batcat", "head", "tail"}
# Flags that take a numeric arg — skip both token and the next one.
FLAGS_WITH_VAL = {"-n", "-c", "-N"}
REDIRECTS = {"<", "<<", "<<<", ">", ">>", "|", "||", "&&", ";", "&"}
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
i = 0
while i < len(tokens):
    tok = tokens[i]
    # Peel off command-prefixing shell wrappers
    if tok in ("sudo", "env", "time", "nice"):
        i += 1
        continue
    # Take just the command name, ignoring path parts
    cmd_name = tok.split("/")[-1]
    if cmd_name in READERS:
        used_pagination = False
        # Walk subsequent tokens until we find the first real arg
        j = i + 1
        while j < len(tokens):
            t = tokens[j]
            if t in REDIRECTS:
                break
            if t.startswith("-"):
                if t in FLAGS_WITH_VAL:
                    used_pagination = True
                    j += 2
                    continue
                # -nN style
                if t[1:].isdigit():
                    used_pagination = True
                j += 1
                continue
            # First real path argument
            hit = check(t)
            if hit:
                print(hit); sys.exit(0)
            # Paginated path guard
            rel = t
            if proj and t.startswith(proj + "/"):
                rel = t[len(proj) + 1:]
            for entry in paginated:
                prefix = entry.get("prefix", "")
                if prefix and rel.startswith(prefix) and not used_pagination:
                    print(f"{prefix} (paginated-only; pass -n N)"); sys.exit(0)
            break
        i = j + 1
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
  _emit_block "BLOCKED: Checking run.lock is pipeline status polling. Call the check_pipeline MCP tool NOW for current status, then continue with other work."
  exit 2
fi

# Redirect: metric file timestamp polling → status tool
if echo "$CMD" | grep -qE '(stat|ls -l).*(pipeline-summary|trace-summary|run-history|perceptual-report)'; then
  REASON='Checking metric timestamps is indirect pipeline polling. Use mcp__HME__status(mode="pipeline") for current status, then continue with other work.'
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
  REASON='Polling pipeline logs is the antipattern. Use mcp__HME__status(mode="pipeline") for current status, then continue with other work.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

# Enrich: sleep+check pattern — allow but inject guidance
if echo "$CMD" | grep -qE 'sleep.*(tail|cat|head|grep|\.output)'; then
  REASON='sleep+check detected. Background tasks fire a completion notification — no need to poll. If you must wait, use run_in_background=true instead of sleep loops.'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$reason},"systemMessage":$reason}'
  exit 0
fi

# Suggest HME alternatives for shell commands
if echo "$CMD" | grep -qE '^grep '; then
  echo "PREFER: use the Grep tool — it is passthru-enriched with KB context." >&2
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
