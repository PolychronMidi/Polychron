#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME SessionStart orientation; MUST RUN BEFORE userpromptsubmit.
_SS_STDIN=$(cat)  # capture for subagent-flag detection
# Subagent / fork fast-path: bail before ANY orientation work runs in
# spawned-child sessions. Three detection paths, all advisory:
case "$_SS_STDIN" in
  *'"_hme_subagent":true'*|*'"_hme_subagent": true'*) exit 0 ;;
  *'"isSidechain":true'*|*'"isSidechain": true'*)     exit 0 ;;
  *'"parentSessionId":"'*)                            exit 0 ;;
esac
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOKS_DIR/../helpers/_nexus.sh"
PROJECT="$PROJECT_ROOT"

# Failfast: verify all hook scripts are executable before any run.
ERROR_LOG="${PROJECT}/log/hme-errors.log"
HOOKS_DIR_REL="${HOOKS_DIR#${PROJECT}/}"
BROKEN_HOOKS=()
for hook in "$HOOKS_DIR"/*.sh; do
  name="$(basename "$hook")"
  [[ "$name" == _* ]] && continue
  [[ -x "$hook" ]] || BROKEN_HOOKS+=("$name")
done
if [[ "${#BROKEN_HOOKS[@]}" -gt 0 ]]; then
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  mkdir -p "$(dirname "$ERROR_LOG")"
  for name in "${BROKEN_HOOKS[@]}"; do
    echo "[$TS] [hooks] FAIL: $name not executable -- run: chmod +x ${HOOKS_DIR_REL}/$name" >> "$ERROR_LOG"
  done
  echo "[ALERT] LIFESAVER: ${#BROKEN_HOOKS[@]} hook(s) not executable: ${BROKEN_HOOKS[*]} -- logged to hme-errors.log" >&2
fi

# Capture previous session's pending items before state reset.
PREV_PENDING=$(_nexus_pending)

# Reset session state for fresh session.
mkdir -p "${PROJECT}/tmp"
> "${PROJECT}/tmp/hme-tab.txt"
> "${PROJECT}/tmp/hme-nexus.state"
> "${PROJECT}/tmp/hme-primer-needed.flag"

# Refresh adaptive config and coherence health on every session start.
_hme_bg_timeout 20 adapt-from-activity "$PROJECT/log/hme-bg-adapt-from-activity.err" \
  python3 "${PROJECT}/tools/HME/scripts/adapt-from-activity.py"
_hme_bg_timeout 90 verify-coherence-registry "$PROJECT/log/hme-bg-verify-coherence-registry.err" \
  python3 "${PROJECT}/tools/HME/scripts/verify-coherence-registry.py"

_signal_emit session_start sessionstart session '{}'

# Subagent fast-path: ephemeral `claude -p` runs spawned with HME_SUBAGENT=1
# only need the essential safety + state reset above. The orientation message,
# holograph snapshot, HCI trajectory summary, todo/lance/learning surface, and
# fork-watchdog scans are all parent-session UX that costs ~10-15s of Python
# imports per spawn while the subagent's stderr is captured and discarded. Skip
# all of it. Stop chain still gets the subagent escape via lifecycle_payload.
if [ "${HME_SUBAGENT:-0}" = "1" ]; then
  exit 0
fi

# Initialize onboarding state machine -- every new session re-arms the walkthrough
source "$HOOKS_DIR/../helpers/_onboarding.sh"
_onb_init

# HME Proxy health check. Launchers (polychron-launch.sh / polychron-proxy-restart.sh)
# own the proxy lifecycle; SessionStart hooks fire too frequently (subagents,
# background tasks) to safely spawn. If proxy is down, surface a warning so
# the operator knows to run the launcher.
if [ "${HME_PROXY_ENABLED}" = "1" ]; then
  PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT}")"  # silent-ok: optional fallback path.
  if ! curl -sf --max-time 1 "http://127.0.0.1:${PROXY_PORT}/health" > /dev/null 2>&1; then
    echo "[ALERT] HME proxy not running on :${PROXY_PORT} -- run polychron-launch.sh or polychron-proxy-restart.sh to start it" >&2
    TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    mkdir -p "$(dirname "$ERROR_LOG")" 2>/dev/null
    echo "[$TS] [sessionstart] proxy not running on :${PROXY_PORT} — proxy lifecycle belongs to launchers, not session hooks" >> "$ERROR_LOG" 2>/dev/null
  fi
fi

# Persist HME env vars for the session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export HME_ACTIVE=1" >> "$CLAUDE_ENV_FILE"
fi

# Worker health: surface recent_errors without delaying SessionStart.
WORKER_PORT="$_HME_HTTP_PORT"
# Drop stale worker errors so resolved prior-session noise stays quiet.
curl -sf --max-time 2 -X POST "http://127.0.0.1:${WORKER_PORT}/clear-errors" \
  -H 'Content-Type: application/json' \
  -d '{"older_than_ms":1800000}' >/dev/null 2>&1 || true
# Log unexpected health-curl stderr; worker-start connection failures are normal.
_SS_CURL_ERR=$(mktemp "$PROJECT/tools/HME/runtime/_ss_curl_err_XXXXXX" 2>/dev/null || echo "$PROJECT/tools/HME/runtime/_ss_curl_err_$$")  # silent-ok: optional fallback path.
HEALTH_JSON=$(curl -sf --max-time 1 "http://127.0.0.1:${WORKER_PORT}/health" 2>"$_SS_CURL_ERR" || echo "")
if [ -s "$_SS_CURL_ERR" ] && ! grep -qiE 'connect|refused|timed out|timeout' "$_SS_CURL_ERR"; then
  _SS_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _ss_line; do
    [ -n "$_ss_line" ] && echo "[$_SS_TS] [sessionstart:health] curl unexpected error: $_ss_line" \
      >> "$PROJECT/log/hme-errors.log"
  done < "$_SS_CURL_ERR"
fi
rm -f "$_SS_CURL_ERR" 2>/dev/null
if [ -n "$HEALTH_JSON" ]; then
  # Temp file avoids heredoc/stdin ambiguity.
  _HEALTH_TMP=$(mktemp -t hme-health.XXXXXX)
  printf '%s' "$HEALTH_JSON" > "$_HEALTH_TMP"
  RECENT_ERRORS=$(HME_HEALTH_FILE="$_HEALTH_TMP" python3 -c "
import json, os, sys
try:
    with open(os.environ['HME_HEALTH_FILE']) as f:
        d = json.load(f)
except Exception:
    sys.exit(0)
errs = d.get('recent_errors') or []
if not errs:
    sys.exit(0)
print(f'HME worker has {len(errs)} recent error(s):')
for e in errs[:10]:
    if isinstance(e, dict):
        msg = e.get('message', '')
        src = e.get('source', '?')
    else:
        msg = str(e); src = '?'
    print(f'  - [{src}] {msg[:200]}')
if len(errs) > 10:
    print(f'  ... and {len(errs) - 10} more')
" 2>/dev/null || true)
  rm -f "$_HEALTH_TMP"
  if [ -n "$RECENT_ERRORS" ]; then
    # Also write to hme-errors.log so the userpromptsubmit banner picks them
    # up on the next turn -- SessionStart stderr alone can be missed.
    TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    mkdir -p "$(dirname "$ERROR_LOG")"
    echo "$RECENT_ERRORS" | sed "s|^|[$TS] [worker-health] |" >> "$ERROR_LOG"
    echo -e "\n[ALERT] $RECENT_ERRORS" >&2
  fi
fi

# Build orientation message
MSG=""
# Pipeline verdict + wall time
PS="${METRICS_DIR}/pipeline-summary.json"
if [ -f "$PS" ]; then
  # Single python startup parses both fields (was 2 invocations, ~1s combined).
  _PS_PARSE=$(PS="$PS" python3 -c "
import json, os
try:
    d=json.load(open(os.environ['PS']))
    v=d.get('verdict','') or ''
    w=d.get('wallTimeSeconds',0)
    ws=f'{w:.0f}s' if w else ''
    print(v); print(ws)
except Exception:
    print(); print()
" 2>/dev/null)
  VERDICT=$(printf '%s\n' "$_PS_PARSE" | sed -n '1p')
  WALL=$(printf '%s\n' "$_PS_PARSE" | sed -n '2p')
  [ -n "$VERDICT" ] && MSG="$MSG\nPipeline: $VERDICT${WALL:+ (${WALL})}"
fi

# Uncommitted changes (count + subsystems)
CHANGED_COUNT=$(_safe_int "$(git -C "$PROJECT" diff --name-only 2>/dev/null | wc -l)")
STAGED_COUNT=$(_safe_int "$(git -C "$PROJECT" diff --cached --name-only 2>/dev/null | wc -l)")
if [ "$CHANGED_COUNT" -gt 0 ] || [ "$STAGED_COUNT" -gt 0 ]; then
  SUBSYSTEMS=$(git -C "$PROJECT" diff --name-only 2>/dev/null | sed 's|/.*||' | sort -u | tr '\n' ',' | sed 's/,$//')
  MSG="$MSG\nUncommitted: $CHANGED_COUNT modified ($SUBSYSTEMS)"
  [ "$STAGED_COUNT" -gt 0 ] && MSG="$MSG + $STAGED_COUNT staged"
fi

# Most recent commit
LAST_COMMIT=$(git -C "$PROJECT" log --oneline -1 2>/dev/null)
[ -n "$LAST_COMMIT" ] && MSG="$MSG\nLast commit: $LAST_COMMIT"

ONB_STEP="$(_onb_step_label)"
echo -e "Onboarding: $ONB_STEP$MSG" >&2

# Surface carried-over todos from cached prior BG run; refresh in background.
# The inline heredoc with PYTHONPATH-loaded server imports was a ~500ms-1s
# hot-path tax on every SessionStart -- same BG+cache pattern as _TRAJ_CACHE
_CARRY_CACHE="$PROJECT/tmp/hme-carried-over.cache"
[ -s "$_CARRY_CACHE" ] && cat "$_CARRY_CACHE" >&2
export _CARRY_CACHE
_hme_bg_shell_timeout 20 list-carried-over "$PROJECT/log/hme-bg-list-carried-over.err" '
  tmp="${_CARRY_CACHE}.$$.tmp"
  PROJECT_ROOT="'"$PROJECT"'" PYTHONPATH="'"$PROJECT/tools/HME/service"'" \
    python3 -c "
from server.tools_analysis.todo import list_carried_over
items = list_carried_over()
if items:
    print(\"\nCarried-over HME todos (\" + str(len(items)) + \" open):\")
    crit = [i for i in items if i[\"critical\"]]
    normal = [i for i in items if not i[\"critical\"]]
    for i in crit:
        print(\"  !!! #\" + str(i[\"id\"]) + \" \" + i[\"text\"][:120] + \" [\" + i[\"source\"] + \"]\")
    for i in normal:
        tag = \" (\" + str(i[\"open_subs\"]) + \" open subs)\" if i[\"open_subs\"] else \"\"
        src = \" [\" + i[\"source\"] + \"]\" if i[\"source\"] else \"\"
        print(\"  [ ] #\" + str(i[\"id\"]) + \" \" + i[\"text\"][:100] + tag + src)
" >"$tmp" 2>>"'"$PROJECT/log/hme-bg-list-carried-over.err"'" \
    && mv "$tmp" "$_CARRY_CACHE" || rm -f "$tmp"
'

# Surface doc/templates/TODO.md in-flight continuity state.
_TODO_MD="$PROJECT/doc/templates/TODO.md"
if [ -f "$_TODO_MD" ]; then
  IN_FLIGHT=$(sed -n '/^## In flight/,/^## /p' "$_TODO_MD" | grep -E '^\s*-\s+\[' | head -10 || true)
  if [ -n "$IN_FLIGHT" ]; then
    echo "" >&2
    echo "doc/templates/TODO.md In flight:" >&2
    echo "$IN_FLIGHT" >&2
  fi
fi

# Compact large Lance deletion queues in the background.
_LANCE_DEL="$PROJECT/tools/HME/KB/code_chunks.lance/_deletions"
if [ -d "$_LANCE_DEL" ]; then
  _DEL_COUNT=$(ls -1 "$_LANCE_DEL" 2>/dev/null | wc -l)  # silent-ok: optional fallback path.
  if [ "$_DEL_COUNT" -gt 50 ]; then
    _hme_bg_timeout 60 compact-lance "$PROJECT/log/hme-lance-compact.log" \
      env PROJECT_ROOT="$PROJECT" python3 "$PROJECT/tools/HME/scripts/compact-lance-tables.py"
  fi
fi

# Capture session-start holograph; keep background stderr auditable.
mkdir -p "$PROJECT/log" 2>/dev/null
HOLO_SCRIPT="$PROJECT/tools/HME/scripts/snapshot-holograph.py"
if [ -f "$HOLO_SCRIPT" ]; then
  SESSION_HOLO="$PROJECT/tmp/hme-session-start.holograph.json"
  SNAP_LOG="$PROJECT/log/hme-bg-snapshot-holograph.err"
  : > "$SNAP_LOG"
  export PROJECT SESSION_HOLO HOLO_SCRIPT SNAP_LOG
  _hme_bg_shell_timeout 300 snapshot-holograph "$SNAP_LOG" '
    tmp="${SESSION_HOLO}.$$.tmp"
    PROJECT_ROOT="$PROJECT" python3 "$HOLO_SCRIPT" --stdout >"$tmp" 2>>"$SNAP_LOG" \
      && mv "$tmp" "$SESSION_HOLO" || rm -f "$tmp"
  '
fi

# Refresh tool-effectiveness analysis in the background.
EFF_SCRIPT="$PROJECT/tools/HME/scripts/analyze-tool-effectiveness.py"
if [ -f "$EFF_SCRIPT" ]; then
  _hme_bg_timeout 20 analyze-tool-effectiveness "$PROJECT/log/hme-bg-analyze-tool-effectiveness.err" \
    env PROJECT_ROOT="$PROJECT" python3 "$EFF_SCRIPT"
fi

# Update HCI trajectory in the background for time-series analysis.
TRAJ_SCRIPT="$PROJECT/tools/HME/scripts/analyze-hci-trajectory.py"
if [ -f "$TRAJ_SCRIPT" ]; then
  _hme_bg_timeout 20 analyze-hci-trajectory "$PROJECT/log/hme-bg-analyze-hci-trajectory.err" \
    env PROJECT_ROOT="$PROJECT" python3 "$TRAJ_SCRIPT"
fi

# Read cached HCI trajectory summary; the BG analyze-hci-trajectory invocation
# above writes ${METRICS_DIR}/hme-trajectory.json.summary. Reading the cache
# avoids a 1-2s python3 launch on the SessionStart hot path. Only fall back to
_TRAJ_CACHE="${METRICS_DIR}/hme-trajectory.json.summary"
if [ -s "$_TRAJ_CACHE" ]; then
  cat "$_TRAJ_CACHE" >&2
elif [ -f "$TRAJ_SCRIPT" ]; then
  _SS_TRAJ_ERR=$(mktemp "$PROJECT/tools/HME/runtime/_ss_traj_err_XXXXXX" 2>/dev/null || echo "$PROJECT/tools/HME/runtime/_ss_traj_err_$$")  # silent-ok: optional fallback path.
  set +e
  TRAJ_LINE=$(PROJECT_ROOT="$PROJECT" timeout 10s python3 "$TRAJ_SCRIPT" --summary 2>"$_SS_TRAJ_ERR")
  _SS_TRAJ_RC=$?
  set -e
  if [ "$_SS_TRAJ_RC" -ne 0 ] && [ -s "$_SS_TRAJ_ERR" ] && [ -d "$PROJECT/log" ]; then
    _SS_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _ss_line; do
      [ -n "$_ss_line" ] && echo "[$_SS_TS] [sessionstart:hci-trajectory] python3 failed: $_ss_line" \
        >> "$PROJECT/log/hme-errors.log"
    done < "$_SS_TRAJ_ERR"
  fi
  rm -f "$_SS_TRAJ_ERR" 2>/dev/null
  [ -n "$TRAJ_LINE" ] && echo "$TRAJ_LINE" >&2
fi

# Previous session pending items (surfaced as a warning after main message)
if [ -n "$PREV_PENDING" ]; then
  echo -e "\nPrevious session left unfinished:$PREV_PENDING" >&2
fi

# Substrate pre-turn briefing -- cached output now; refresh in background.
_SUBSTRATE_CACHE="$PROJECT/tmp/hme-substrate-brief.cache"
[ -s "$_SUBSTRATE_CACHE" ] && { echo "" >&2; cat "$_SUBSTRATE_CACHE" >&2; }
_hme_bg_timeout 15 substrate-brief "$PROJECT/log/hme-bg-substrate-brief.err" \
  bash -c "PROJECT_ROOT=\"$PROJECT\" METRICS_DIR=\"$METRICS_DIR\" python3 \"$PROJECT/tools/HME/scripts/substrate_brief.py\" > \"$_SUBSTRATE_CACHE.tmp\" 2>>\"$PROJECT/log/hme-bg-substrate-brief.err\" && mv \"$_SUBSTRATE_CACHE.tmp\" \"$_SUBSTRATE_CACHE\" || rm -f \"$_SUBSTRATE_CACHE.tmp\""

# Stale-soft-warn auditor: read cached output from prior BG run; refresh in
# background. Mirrors the _TRAJ_CACHE pattern (L247-249) -- the synchronous
# python3 invocation was a ~500ms hot-path tax that pushed SessionStart over
# its 5s warn budget. The conditional surface ("need review") still fires
# from the cache; freshness is one session behind, which is fine for a
# promotion-review hint.
_SOFT_AUDIT="$PROJECT_ROOT/tools/HME/scripts/detectors/audit_stale_soft_warns.py"
_SOFT_CACHE="$PROJECT/tmp/hme-stale-soft-warns.cache"
if [ -s "$_SOFT_CACHE" ]; then
  case "$(cat "$_SOFT_CACHE")" in
    *"need review"*) cat "$_SOFT_CACHE" >&2 ;;
  esac
fi
if [ -x "$_SOFT_AUDIT" ]; then
  export _SOFT_AUDIT _SOFT_CACHE
  _hme_bg_shell_timeout 20 audit-stale-soft-warns "$PROJECT/log/hme-bg-audit-stale-soft-warns.err" '
    tmp="${_SOFT_CACHE}.$$.tmp"
    PROJECT_ROOT="'"$PROJECT_ROOT"'" python3 "$_SOFT_AUDIT" >"$tmp" 2>>"'"$PROJECT/log/hme-bg-audit-stale-soft-warns.err"'" \
      && mv "$tmp" "$_SOFT_CACHE" || rm -f "$tmp"
  '
fi

# Fork-watchdog: same cache+bg pattern.
_FORK_WATCHDOG="$PROJECT_ROOT/tools/HME/scripts/fork_watchdog.py"
_FW_CACHE="$PROJECT/tmp/hme-fork-watchdog.cache"
if [ -s "$_FW_CACHE" ]; then
  case "$(cat "$_FW_CACHE")" in
    *"notification not delivered"*|*"may be stuck"*) cat "$_FW_CACHE" >&2 ;;
  esac
fi
if [ -x "$_FORK_WATCHDOG" ]; then
  export _FORK_WATCHDOG _FW_CACHE
  _hme_bg_shell_timeout 20 fork-watchdog "$PROJECT/log/hme-bg-fork-watchdog.err" '
    tmp="${_FW_CACHE}.$$.tmp"
    PROJECT_ROOT="'"$PROJECT_ROOT"'" python3 "$_FORK_WATCHDOG" >"$tmp" 2>>"'"$PROJECT/log/hme-bg-fork-watchdog.err"'" \
      && mv "$tmp" "$_FW_CACHE" || rm -f "$tmp"
  '
fi

# Learning-surface: same cache+bg pattern; the keyword (first TODO item) is
# captured at scheduling time so the BG worker has a stable input even if
# TODO.md changes mid-session.
_LE="$PROJECT_ROOT/tools/HME/scripts/learning_extract.py"
_TODO_FILE="$PROJECT_ROOT/doc/templates/TODO.md"
_LE_CACHE="$PROJECT/tmp/hme-learning-surface.cache"
[ -s "$_LE_CACHE" ] && cat "$_LE_CACHE" >&2
if [ -x "$_LE" ] && [ -f "$_TODO_FILE" ]; then
  _TODO_TITLE=$(grep -E "^[[:space:]]*-[[:space:]]+\\[[[:space:]]\\][[:space:]]+\\[(E[1-5]|easy|medium|hard)\\]" "$_TODO_FILE" | head -1 \
    | sed -E 's/^[[:space:]]*-[[:space:]]+\[[[:space:]]\][[:space:]]+\[(E[1-5]|easy|medium|hard)\][[:space:]]+//' | tr -d '[:cntrl:]' | xargs || true)
  if [ -n "$_TODO_TITLE" ]; then
    _FIRST_KW=$(echo "$_TODO_TITLE" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) if(length($i)>=4){print $i; exit}}')
    if [ -n "$_FIRST_KW" ]; then
      export _LE _LE_CACHE _FIRST_KW
      _hme_bg_shell_timeout 20 learning-surface "$PROJECT/log/hme-bg-learning-surface.err" '
        tmp="${_LE_CACHE}.$$.tmp"
        PROJECT_ROOT="'"$PROJECT_ROOT"'" python3 "$_LE" surface --keyword "$_FIRST_KW" --top 3 >"$tmp" 2>>"'"$PROJECT/log/hme-bg-learning-surface.err"'" \
          && mv "$tmp" "$_LE_CACHE" || rm -f "$tmp"
      '
    fi
  fi
fi
exit 0
