#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME UserPromptSubmit: inject context on evolution-related prompts
INPUT=$(cat)
PROMPT=$(_safe_jq "$INPUT" '.user_prompt' '')

# ── Auto-commit snapshot ──────────────────────────────────────────────────────
# Commit any uncommitted changes before Claude processes the message.
# Timestamps only — no description. Skipped during pipeline runs (run.lock present).
# Same PROJECT_ROOT-fallback pattern as stop.sh: plugin-hook invocations
# may not set PROJECT_ROOT in the env, so fall through to stdin.cwd → $PWD.
_HOOK_CWD=$(_safe_jq "$INPUT" '.cwd' '')
_AC_PROJECT="${PROJECT_ROOT:-${_HOOK_CWD:-$(pwd)}}"
if [ -n "$_AC_PROJECT" ] && [ -d "$_AC_PROJECT/.git" ] && [ ! -f "$_AC_PROJECT/tmp/run.lock" ]; then
  _GIT_ERR="$_AC_PROJECT/tmp/hme-autocommit.err"
  mkdir -p "$(dirname "$_GIT_ERR")" 2>/dev/null
  git -C "$_AC_PROJECT" add -A 2>"$_GIT_ERR"
  # "nothing to commit" on a clean tree is expected; any other error is surfaced
  if ! git -C "$_AC_PROJECT" commit -m "$(date +%Y-%m-%dT%H:%M:%S)" --quiet 2>"$_GIT_ERR"; then
    if ! grep -q "nothing to commit" "$_GIT_ERR" 2>/dev/null; then
      echo "WARNING: userpromptsubmit auto-commit failed — see $_GIT_ERR" >&2
    fi
  else
    rm -f "$_GIT_ERR" 2>/dev/null
  fi
fi

# Reset the psychopathic-polling counter at turn start — the counter
# accumulates within a turn and would never reset without this. The
# pretooluse_bash hook reads and increments it; this hook resets it.
rm -f /tmp/polychron-task-poll-count 2>/dev/null
rm -f /tmp/hme-chain-snapshot-fired 2>/dev/null

# H-compact optimization #6: user-correction capture channel.
# The user's corrections carry the deepest signal in a session. Grep the
# prompt for correction phrases and persist to hme-user-corrections.jsonl so
# chain-snapshot can preserve them verbatim across compaction.
_CORRECTION_FILE="${PROJECT}/tmp/hme-user-corrections.jsonl"
if [ -n "$PROMPT" ]; then
  _IS_CORRECTION=0
  # Case-insensitive grep for correction language
  if echo "$PROMPT" | grep -qiE '\b(actually|instead|don.?t|no,|not quite|reverse|revert|rollback|wrong|incorrect|fix this|that.?s wrong|stop|cancel|undo)\b'; then
    _IS_CORRECTION=1
  fi
  if [ "$_IS_CORRECTION" -eq 1 ]; then
    mkdir -p "$(dirname "$_CORRECTION_FILE")"
    python3 -c "
import json, sys, time
entry = {
    'ts': int(time.time()),
    'ts_human': time.strftime('%Y-%m-%d %H:%M:%S'),
    'prompt_preview': sys.argv[1][:500],
}
with open('$_CORRECTION_FILE', 'a') as f:
    f.write(json.dumps(entry) + '\n')
" "$PROMPT" 2>/dev/null || true
  fi
fi

# ── LIFESAVER — HME Error Log Monitor ───────────────────────────────────────
# LIFE-OR-DEATH: The HME Chat panel writes errors to log/hme-errors.log.
# THIS is the ONLY mechanism that makes those errors visible to this agent.
# Every error, everywhere, MUST be diagnosed and FIXED. Not acknowledged — FIXED.
# An error that is seen and not fixed is WORSE than an unseen error.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"

mkdir -p "$PROJECT/tmp"

if [ -f "$ERROR_LOG" ]; then
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0)
  LAST=0
  [ -f "$WATERMARK" ] && LAST=$(cat "$WATERMARK" 2>/dev/null || echo 0)

  # Record turn start line count (Stop hook uses this to catch mid-turn errors)
  echo "$TOTAL" > "$TURNSTART"

  if [ "$TOTAL" -gt "$LAST" ]; then
    NEW_ERRORS=$(awk "NR > $LAST" "$ERROR_LOG" | sort -u)
    # DO NOT advance watermark here — Stop hook is the only gate that advances it.
    # If watermark advanced here, unfixed errors vanish when Stop sees TOTAL==TURNSTART.
    echo "" >&2
    echo "╔════════════════════════════════════════════════════════════════════════╗" >&2
    echo "║  🚨 LIFESAVER — ERRORS DETECTED — FIX BEFORE ANYTHING ELSE 🚨         ║" >&2
    echo "║  Acknowledging an error without fixing it is a CRITICAL VIOLATION.     ║" >&2
    echo "║  You MUST: 1) diagnose root cause  2) implement fix  3) verify fix     ║" >&2
    echo "╚════════════════════════════════════════════════════════════════════════╝" >&2
    echo "$NEW_ERRORS" >&2
    echo "" >&2
    echo "DO NOT proceed with any other task until every error above is FIXED." >&2
    echo "" >&2
  fi
fi

# ── HME critical todos — surface unresolved critical items at turn start ────
# Reads the HME store, filters critical+open items, emits them so the agent
# cannot miss LIFESAVER alerts, high-priority work, or unresolved trigger notes.
CRIT_OUT=$(PROJECT_ROOT="$PROJECT" PYTHONPATH="$PROJECT/tools/HME/mcp" python3 <<'PYEOF' 2>/dev/null
try:
    from server.tools_analysis.todo import list_critical
    items = list_critical()
    if items:
        print("HME CRITICAL TODOS (unresolved):")
        for i in items:
            src = f" [{i['source']}]" if i.get('source') else ""
            print(f"  !!! #{i['id']} {i['text']}{src}")
except Exception:
    pass
PYEOF
)
if [ -n "$CRIT_OUT" ]; then
  echo "" >&2
  echo "$CRIT_OUT" >&2
  echo "" >&2
fi

# Surface any learn() prompt reminders queued by on_done triggers from previous turns
LEARN_PROMPTS="$PROJECT/tmp/hme-todo-learn-prompts.log"
if [ -f "$LEARN_PROMPTS" ] && [ -s "$LEARN_PROMPTS" ]; then
  echo "HME learn() reminders (from completed on_done triggers):" >&2
  cat "$LEARN_PROMPTS" >&2
  echo "" >&2
  > "$LEARN_PROMPTS"
fi

# Detect evolution-related prompts and inject Evolver awareness
if echo "$PROMPT" | grep -qiE 'evolve|evolution|next round|run main|pipeline|lab|sketch'; then
  echo 'EVOLVER CONTEXT: Remember to use before_editing before modifying files, what_did_i_forget after changes, and add_knowledge after confirmed rounds. Check metrics/journal.md for the latest round context.' >&2
fi

# Always: anti-abandonment reminder
echo 'PLAN DISCIPLINE: Finish the current atomic unit before pivoting. Clarify BEFORE starting, not after. Never leave code/tools in a broken intermediate state while switching approach. If user feedback changes direction: finish current unit, explicitly name what was left undone, get confirmation.' >&2

exit 0
