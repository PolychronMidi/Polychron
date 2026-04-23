#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME UserPromptSubmit: inject context on evolution-related prompts
INPUT=$(cat)
PROMPT=$(_safe_jq "$INPUT" '.user_prompt' '')

# Auto-commit snapshot
# Commit any uncommitted changes before Claude processes the message.
# Timestamps only — no description. Runs unconditionally; pipeline state
# does not gate commits. Mid-pipeline file states get committed at
# whatever bytes are on disk; the next autocommit captures the final
# state. One extra "in-progress" commit is the cost; persistent
# uncommitted work during long pipeline runs is the bug we're avoiding.
# PROJECT_ROOT comes from .env via _safety.sh. Never fall back to stdin.cwd /
# $(pwd) — tool cwd may be a subtree and git -C would commit against the wrong
# root. If PROJECT_ROOT is invalid, skip.
_AC_PROJECT="${PROJECT_ROOT:-}"
if [ -n "$_AC_PROJECT" ] && [ -d "$_AC_PROJECT/.git" ] && [ -d "$_AC_PROJECT/src" ]; then
  _GIT_ERR="$_AC_PROJECT/tmp/hme-autocommit.err"
  mkdir -p "$(dirname "$_GIT_ERR")" 2>/dev/null
  git -C "$_AC_PROJECT" add -A 2>"$_GIT_ERR"
  # "nothing to commit" on a clean tree is expected; any other error is surfaced
  if ! git -C "$_AC_PROJECT" commit -m "$(date +%Y-%m-%dT%H:%M:%S)" --quiet 2>"$_GIT_ERR"; then
    if ! grep -q "nothing to commit" "$_GIT_ERR" 2>/dev/null; then
      # R46 LIFESAVER FIX: autocommit failures previously wrote only to
      # stderr (dropped by _proxy_bridge) and to tmp/hme-autocommit.err
      # (not monitored). LIFESAVER never saw them. Route the same failure
      # to hme-errors.log so the next userpromptsubmit LIFESAVER scan
      # surfaces it as a decision-blocking alert.
      _AC_ERR_SUMMARY=$(head -c 300 "$_GIT_ERR" 2>/dev/null | tr '\n' ' ')
      _AC_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "[$_AC_TS] [autocommit] userpromptsubmit git commit failed: $_AC_ERR_SUMMARY" >> "$_AC_PROJECT/log/hme-errors.log"
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
_CORRECTION_FILE="${PROJECT_ROOT}/tmp/hme-user-corrections.jsonl"
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

# LIFESAVER — HME Error Log Monitor
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
    # Emit to stderr (local proxy log) AND stdout as UserPromptSubmit additionalContext
    # so the proxy bridge relays it back into Claude's turn context. Stderr-only
    # was the old path; the proxy bridge drops stderr entirely (see _proxy_bridge.sh),
    # which meant every LIFESAVER alert since plugin mode was silently discarded.
    echo "" >&2
    echo "LIFESAVER - ERRORS DETECTED - FIX BEFORE ANYTHING ELSE" >&2
    echo "$NEW_ERRORS" >&2
    BANNER="LIFESAVER - ERRORS DETECTED - FIX BEFORE ANYTHING ELSE
Acknowledging an error without fixing it is a CRITICAL VIOLATION.
You MUST: 1) diagnose root cause  2) implement fix  3) verify fix

${NEW_ERRORS}

DO NOT proceed with any other task until every error above is FIXED."
    # Block ONLY if the supervisor-abandoned sentinel currently exists
    # (live catastrophic state, not historical log entry). Otherwise
    # allow-with-context so the LIFESAVER is surfaced without blocking
    # what may be a harmless continuation prompt.
    export BLOCK="false"
    [ -f "$PROJECT/tmp/hme-supervisor-abandoned" ] && export BLOCK="true"
    python3 -c "
import json, sys, os
banner = sys.stdin.read()
block = os.environ.get('BLOCK') == 'true'
payload = {
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': banner
    },
    'decision': 'block' if block else 'allow',
    'reason': 'LIFESAVER: worker supervisor abandoned — restart before proceeding.' if block else 'LIFESAVER: unresolved errors in hme-errors.log.'
}
print(json.dumps(payload))
" <<< "$BANNER"
  fi
fi

# HME critical todos — surface unresolved critical items at turn start
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

# Context-aware rotating reminders
# Normally cycles through reminders.txt. But if nexus signals specific behavior
# patterns this turn, override with the most relevant reminder instead.
REMINDERS_FILE="$(dirname "${BASH_SOURCE[0]}")/../reminders.txt"
if [ -f "$REMINDERS_FILE" ]; then
  TOTAL_REMINDERS=$(grep -c . "$REMINDERS_FILE" 2>/dev/null || echo 0)
  if [ "$TOTAL_REMINDERS" -gt 0 ]; then
    IDX_FILE="$PROJECT_ROOT/tmp/hme-reminder-idx"
    mkdir -p "$PROJECT_ROOT/tmp"

    # Behavior-specific override: check nexus + last turn signals
    OVERRIDE_REMINDER=""
    NEXUS_FILE="$PROJECT_ROOT/tmp/hme-nexus.state"

    # Many edits but no REVIEW marker → nudge toward i/review
    _EDIT_CT=$(grep -c '^EDIT:' "$NEXUS_FILE" 2>/dev/null || echo 0)
    _REVIEW_CT=$(grep -c '^REVIEW:' "$NEXUS_FILE" 2>/dev/null || echo 0)
    if [ "$_EDIT_CT" -gt 3 ] && [ "$_REVIEW_CT" -eq 0 ]; then
      OVERRIDE_REMINDER="Polite reminder: You have $_EDIT_CT unreviewed edits — run \`i/review mode=forget\` before stopping to catch KB constraint violations."
    fi

    # High bash call streak from prior turn (poll counter left behind) → agent reminder
    if [ -z "$OVERRIDE_REMINDER" ] && [ -f "/tmp/polychron-bash-call-count" ]; then
      _BASH_CT=$(cat /tmp/polychron-bash-call-count 2>/dev/null || echo 0)
      if [ "$_BASH_CT" -gt 8 ]; then
        OVERRIDE_REMINDER="Polite reminder: Explore agents are preferred over serial Bash chains — spawn one for multi-file research and get a concise report back."
      fi
    fi

    if [ -n "$OVERRIDE_REMINDER" ]; then
      echo "<system-reminder>${OVERRIDE_REMINDER}</system-reminder>" >&2
    else
      # Default: rotate through the list
      IDX=$(cat "$IDX_FILE" 2>/dev/null || echo 0)
      IDX=$((IDX % TOTAL_REMINDERS))
      REMINDER=$(sed -n "$((IDX + 1))p" "$REMINDERS_FILE")
      echo $((IDX + 1)) > "$IDX_FILE"
      if [ -n "$REMINDER" ]; then
        echo "<system-reminder>${REMINDER}</system-reminder>" >&2
      fi
    fi
  fi
fi

# R30 #2: auto-append ground-truth when user message contains
# "listening verdict: legendary/stable/drifted/broken". Stops manual
# jsonl appending for every legendary round.
PROMPT_BODY=$(_safe_jq "$INPUT" '.prompt' '')
if [[ -n "$PROMPT_BODY" ]]; then
  VERDICT=""
  if echo "$PROMPT_BODY" | grep -qiE 'listening verdict:\s*legendary'; then VERDICT=legendary
  elif echo "$PROMPT_BODY" | grep -qiE 'listening verdict:\s*stable'; then VERDICT=stable
  elif echo "$PROMPT_BODY" | grep -qiE 'listening verdict:\s*drifted'; then VERDICT=drifted
  elif echo "$PROMPT_BODY" | grep -qiE 'listening verdict:\s*broken'; then VERDICT=broken
  fi
  if [[ -n "$VERDICT" ]]; then
    GT_FILE="${METRICS_DIR}/hme-ground-truth.jsonl"
    SHA=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
    TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # Dedupe: skip if the last entry already has this SHA + same verdict
    LAST_SHA_VERDICT=""
    if [[ -f "$GT_FILE" ]]; then
      LAST_SHA_VERDICT=$(tail -1 "$GT_FILE" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(f\"{d.get('sha')}|{','.join(d.get('tags') or [])}\")
except Exception: pass" 2>/dev/null || echo "")
    fi
    if [[ "$LAST_SHA_VERDICT" != "$SHA|$VERDICT" ]]; then
      echo "{\"ts\":\"$TS\",\"sha\":\"$SHA\",\"tags\":[\"$VERDICT\"],\"source\":\"userpromptsubmit_auto\",\"note\":\"Auto-captured from user prompt\"}" >> "$GT_FILE"
    fi
  fi
fi

exit 0
