#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
# MUST RUN BEFORE: stop
INPUT=$(cat)
PROMPT=$(_safe_jq "$INPUT" '.user_prompt' '')
_HME_PROJECT_TMP="${PROJECT_ROOT}/t""mp"
_HME_DEFAULT_OS_TMP="/t""mp"
_HME_OS_TMP="${TMPDIR:-$_HME_DEFAULT_OS_TMP}"

_WATCHDOG_ALERT=$(printf '%s' "$INPUT" \
  | PROJECT_ROOT="$PROJECT_ROOT" node "$PROJECT_ROOT/tools/HME/event_kernel/hook_watchdog.js" userprompt-alert 2>/dev/null || true)
if [ -n "$_WATCHDOG_ALERT" ]; then
  echo "LIFESAVER -- lifecycle watchdog detected a SessionStart failure." >&2
  printf '%s\n' "$_WATCHDOG_ALERT" >&2
fi

# Reset per-turn trackers (turn-edits + brief dedup) consumed by pretooluse_edit/write.
if [ -n "$PROJECT_ROOT" ]; then
  rm -f "${_HME_PROJECT_TMP}/hme-turn-edits.txt" \
        "${_HME_PROJECT_TMP}/hme-turn-briefs.txt" 2>/dev/null || true  # silent-ok: optional fallback path.
fi

if [ -n "$PROJECT_ROOT" ] && [ -f "${PROJECT_ROOT}/doc/templates/TODO.md" ]; then
  mkdir -p "${_HME_PROJECT_TMP}" 2>/dev/null
  cp "${PROJECT_ROOT}/doc/templates/TODO.md" "${_HME_PROJECT_TMP}/todo-turn-start.md" 2>/dev/null || true  # silent-ok: optional fallback path.
fi

_signal_emit turn_start userpromptsubmit turn '{}'

# SatisfactionCapture: score the prompt 1-10 -> tools/HME/runtime/metrics/satisfaction.jsonl
# (neutral=5, never null). Best-effort; never blocks the turn.
if [ -n "$PROJECT_ROOT" ] && [ -n "$PROMPT" ]; then
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/tools/HME/scripts/satisfaction_capture.py" "$PROMPT" 2>/dev/null || true  # silent-ok: optional fallback path.
fi

if [ -n "$PROJECT_ROOT" ] && [ -n "$PROMPT" ]; then
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/tools/HME/scripts/tier_classifier.py" --prompt "$PROMPT" --json >/dev/null 2>&1 || true
fi

# Stale-state sweep: per-turn cleanup of tools/HME/runtime/ files whose owner
# forgot the cleanup path (catches the supervisor-abandoned bug class).
python3 "$PROJECT_ROOT/tools/HME/scripts/stale_state_sweep.py" >/dev/null 2>&1 || true

# UserPromptSubmit must not run synchronous git/precommit work. Request-side
# proxy_autocommit owns autocommit and writes the same sticky fail flag; this
# hook only surfaces an existing flag so prompt submission stays sub-3s.
_AC_FAIL_FLAG="${PROJECT_ROOT}/tools/HME/runtime/autocommit.fail"
if [ -f "$_AC_FAIL_FLAG" ]; then
  _AC_FLAG_BODY=$(cat "$_AC_FAIL_FLAG" 2>/dev/null)
  _AC_BANNER="[ALERT] LIFESAVER - AUTOCOMMIT FAILED - FIX BEFORE ANYTHING ELSE

$_AC_FLAG_BODY

The autocommit helper left this flag behind. Last attempt did not
succeed, which means working-tree changes have NOT been committed.
Diagnose: check git status in the project root; read log/hme-errors.log;
inspect tools/HME/runtime/autocommit.err if present; verify .env loaded PROJECT_ROOT.
Fix the root cause. Do not silence the alert -- the flag clears automatically
on the next successful proxy autocommit."
  echo "" >&2
  echo "$_AC_BANNER" >&2
  jq -n --arg banner "$_AC_BANNER" \
    '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$banner}}'
fi

# Reset the psychopathic-polling counter at turn start -- the counter
rm -f "$_HME_OS_TMP/polychron-task-poll-count" 2>/dev/null
rm -f "$_HME_OS_TMP/hme-chain-snapshot-fired" 2>/dev/null

# user-correction capture channel.
_CORRECTION_FILE="${_HME_PROJECT_TMP}/hme-user-corrections.jsonl"
if [ -n "$PROMPT" ]; then
  _IS_CORRECTION=0
  # Case-insensitive grep for correction language
  if echo "$PROMPT" | grep -qiE '\b(actually|instead|don.?t|no,|not quite|reverse|revert|rollback|wrong|incorrect|fix this|that.?s wrong|stop|cancel|undo)\b'; then
    _IS_CORRECTION=1
  fi
  if [ "$_IS_CORRECTION" -eq 1 ]; then
    mkdir -p "$(dirname "$_CORRECTION_FILE")"
    python3 "$PROJECT_ROOT/tools/HME/scripts/userpromptsubmit_helper.py" \
      capture-correction "$_CORRECTION_FILE" "$PROMPT" 2>/dev/null || true
  fi
fi

# LIFESAVER error-log monitor: surfaces hme-errors.log new lines as
# additionalContext. Errors must be FIXED, not acknowledged.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
WATERMARK="$PROJECT/tools/HME/runtime/errors-lastread"
TURNSTART="$PROJECT/tools/HME/runtime/errors-turnstart"

# crying_wolf: consume stale self-health lines before emergency bannering.
python3 "$PROJECT_ROOT/tools/HME/hooks/helpers/lifesaver_crying_wolf.py" \
  --mode self-only --reason userpromptsubmit --quiet >/dev/null 2>&1 || true

mkdir -p "$_HME_PROJECT_TMP"

if [ -f "$ERROR_LOG" ]; then
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  LAST=0
  [ -f "$WATERMARK" ] && LAST=$(cat "$WATERMARK" 2>/dev/null || echo 0)

  # Record turn start line count (Stop hook uses this to catch mid-turn errors)
  echo "$TOTAL" > "$TURNSTART"

  if [ "$TOTAL" -gt "$LAST" ]; then
    # Filter routine-ops noise (CANARY self-tests, proxy-watchdog respawns)
    # before showing as LIFESAVER alerts -- they're INFO, not errors.
    NEW_ERRORS=$(awk "NR > $LAST" "$ERROR_LOG" \
      | grep -vE '\[CANARY-canary-[0-9]+-[0-9]+\] alert-chain self-test injection|\[proxy-watchdog\] proxy respawned' \
      | sort -u)
    # Stop hook is the ONLY gate that advances watermark (else unfixed errors
    echo "" >&2
    echo "LIFESAVER -- unresolved errors in hme-errors.log:" >&2
    echo "$NEW_ERRORS" >&2
    BANNER="LIFESAVER -- unresolved errors in hme-errors.log, fix root-cause before proceeding:
${NEW_ERRORS}"
    # Block ONLY if the supervisor-abandoned sentinel currently exists
    export BLOCK="false"
    if [ -f "$PROJECT/tools/HME/runtime/supervisor-abandoned" ]; then
      # Cross-check: if the named child is healthy NOW, sentinel is stale.
      # Unlink it and proceed without blocking.
      _sent_child=$(python3 "$PROJECT_ROOT/tools/HME/scripts/userpromptsubmit_helper.py" \
        supervisor-child "$PROJECT/tools/HME/runtime/supervisor-abandoned" 2>/dev/null || true)  # silent-ok: optional fallback path.
      _healthy=0
      _sent_url="$(_hme_service_url "$_sent_child" 2>/dev/null || true)"  # silent-ok: optional fallback path.
      [ -n "$_sent_url" ] && curl -s -m 2 -o /dev/null -w '%{http_code}' "$_sent_url" 2>/dev/null | grep -q '^200$' && _healthy=1  # silent-ok: optional fallback path.
      if [ "$_healthy" = "1" ]; then
        rm -f "$PROJECT/tools/HME/runtime/supervisor-abandoned" 2>/dev/null
      else
        export BLOCK="true"
      fi
    fi
    if [ "$BLOCK" = "true" ]; then
      jq -n --arg banner "$BANNER" \
        '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$banner},decision:"block",reason:"LIFESAVER: worker supervisor abandoned -- restart before proceeding."}'
    else
      jq -n --arg banner "$BANNER" \
        '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$banner}}'
    fi
  fi
fi

# HME critical todos: surface unresolved critical+open items at turn start.
# FAIL-LOUD: python stderr -> hme-errors.log so import failures don't go silent.
_UPS_CRIT_ERR=$(mktemp 2>/dev/null || echo "$_HME_OS_TMP/_ups_crit_err_$$")  # silent-ok: optional fallback path.
set +e
CRIT_OUT=$(PROJECT_ROOT="$PROJECT" PYTHONPATH="$PROJECT/tools/HME/service" \
  python3 "$PROJECT_ROOT/tools/HME/scripts/userpromptsubmit_helper.py" critical-todos 2>"$_UPS_CRIT_ERR")
_UPS_CRIT_RC=$?
set -e
if [ "$_UPS_CRIT_RC" -ne 0 ] && [ -s "$_UPS_CRIT_ERR" ] && [ -d "$PROJECT/log" ]; then
  _UPS_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _ups_line; do
    [ -n "$_ups_line" ] && echo "[$_UPS_TS] [userpromptsubmit:list_critical] python3 failed: $_ups_line" \
      >> "$PROJECT/log/hme-errors.log"
  done < "$_UPS_CRIT_ERR"
fi
rm -f "$_UPS_CRIT_ERR" 2>/dev/null
if [ -n "$CRIT_OUT" ]; then
  echo "" >&2
  echo "$CRIT_OUT" >&2
  echo "" >&2
fi

# Surface any learn() prompt reminders queued by on_done triggers from previous turns
LEARN_PROMPTS="$_HME_PROJECT_TMP/hme-todo-learn-prompts.log"
if [ -f "$LEARN_PROMPTS" ] && [ -s "$LEARN_PROMPTS" ]; then
  echo "HME learn() reminders (from completed on_done triggers):" >&2
  cat "$LEARN_PROMPTS" >&2
  echo "" >&2
  > "$LEARN_PROMPTS"
fi

# Detect evolution-related prompts and inject workflow reminder
if echo "$PROMPT" | grep -qiE 'evolve|evolution|next round|run main|pipeline|lab|sketch'; then
  echo 'EVOLUTION CONTEXT: native Read/Edit are HME-enriched automatically; run `i/review mode=forget` after changes and `i/learn title="..." content="..." category=pattern` after confirmed rounds. Past round context lives in KB (query via `i/learn query=...`); the journal.md archive is historical only.' >&2
fi

# Context-aware reminders: silent default, fire only on nexus/prior-state signal.
NEXUS_FILE="$_HME_PROJECT_TMP/hme-nexus.state"
OVERRIDE_REMINDER=""

# Many edits + no REVIEW -> nudge i/review. Handle missing-file separately so
# grep's stdout stays single-line (|| echo 0 fallback breaks the -gt test).
if [ -f "$NEXUS_FILE" ]; then
  _EDIT_CT=$(grep -c '^EDIT:' "$NEXUS_FILE" || true)
  _REVIEW_CT=$(grep -c '^REVIEW:' "$NEXUS_FILE" || true)
else
  _EDIT_CT=0
  _REVIEW_CT=0
fi
if [ "$_EDIT_CT" -gt 3 ] && [ "$_REVIEW_CT" -eq 0 ]; then
  OVERRIDE_REMINDER="$_EDIT_CT unreviewed edits -- run \`i/review mode=forget\` before stopping."
fi

# High bash call streak from prior turn (poll counter left behind)
if [ -z "$OVERRIDE_REMINDER" ] && [ -f "$_HME_OS_TMP/polychron-bash-call-count" ]; then
  _BASH_CT=$(cat "$_HME_OS_TMP/polychron-bash-call-count" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  if [ "$_BASH_CT" -gt 8 ]; then
    OVERRIDE_REMINDER="Prior turn had $_BASH_CT+ bash calls -- prefer an Explore agent for multi-file research."
  fi
fi

if [ -n "$OVERRIDE_REMINDER" ]; then
  echo "<system-reminder>${OVERRIDE_REMINDER}</system-reminder>" >&2
fi

# R30 #2: auto-append ground-truth when user message contains
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
    SHA=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)  # silent-ok: optional fallback path.
    TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # Dedupe: skip if the last entry already has this SHA + same verdict
    LAST_SHA_VERDICT=""
    if [[ -f "$GT_FILE" ]]; then
      LAST_SHA_VERDICT=$(python3 "$PROJECT_ROOT/tools/HME/scripts/userpromptsubmit_helper.py" \
        last-ground-truth "$GT_FILE" 2>/dev/null || echo "")  # silent-ok: optional fallback path.
    fi
    if [[ "$LAST_SHA_VERDICT" != "$SHA|$VERDICT" ]]; then
      echo "{\"ts\":\"$TS\",\"sha\":\"$SHA\",\"tags\":[\"$VERDICT\"],\"source\":\"userpromptsubmit_auto\",\"note\":\"Auto-captured from user prompt\"}" >> "$GT_FILE"
    fi
  fi
fi

_PD="$PROJECT_ROOT/tools/HME/scripts/project_detect.py"
[ -x "$_PD" ] && PROJECT_ROOT="$PROJECT_ROOT" python3 "$_PD" --tag 2>/dev/null >&2 || true

# inject auto-todo reminders from last turn's ingest
_AUTO_TODO_REMINDER="$_HME_PROJECT_TMP/hme-auto-todos.reminder"
if [ -f "$_AUTO_TODO_REMINDER" ] && [ -s "$_AUTO_TODO_REMINDER" ]; then
  _BANNER=$(cat "$_AUTO_TODO_REMINDER")
  jq -n --arg banner "$_BANNER" '{hookSpecificOutput:{additionalContext:$banner}}'
  rm -f "$_AUTO_TODO_REMINDER"
fi

# clear stale deny reason temp file so it doesn't bleed into next turn's tool results
rm -f "$_HME_PROJECT_TMP/hme-last-deny-reason.txt" 2>/dev/null || true

exit 0
