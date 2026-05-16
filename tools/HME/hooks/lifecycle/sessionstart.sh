#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME SessionStart orientation; MUST RUN BEFORE userpromptsubmit.
cat > /dev/null  # consume stdin
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
_hme_bg_timeout 30 verify-coherence-registry "$PROJECT/log/hme-bg-verify-coherence-registry.err" \
  python3 "${PROJECT}/tools/HME/scripts/verify-coherence-registry.py"

_signal_emit session_start sessionstart session '{}'

# Initialize onboarding state machine -- every new session re-arms the walkthrough
source "$HOOKS_DIR/../helpers/_onboarding.sh"
_onb_init

# HME Proxy + Supervisor. Ports come from services.json through _safety.sh.
PROXY_PORT="$(_hme_service_port proxy 2>/dev/null || printf '%s' "${HME_PROXY_PORT:-9099}")"  # silent-ok: optional fallback path.
if [ "${HME_PROXY_ENABLED:-0}" = "1" ]; then
  if ! curl -sf --max-time 1 "http://127.0.0.1:${PROXY_PORT}/health" > /dev/null 2>&1; then
    PROXY_SCRIPT="$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js"
    if [ -f "$PROXY_SCRIPT" ]; then
      HME_PROXY_PORT="$PROXY_PORT" nohup node "$PROXY_SCRIPT" \
        > "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 &
      echo "HME proxy+supervisor started on :${PROXY_PORT} (pid $!) -- worker will spawn as a child" >&2
    fi
  else
    echo "HME proxy already running on :${PROXY_PORT}" >&2
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
_SS_CURL_ERR=$(mktemp 2>/dev/null || echo "/tmp/_ss_curl_err_$$")  # silent-ok: optional fallback path.
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
PS="${METRICS_DIR:-$PROJECT/output/metrics}/pipeline-summary.json"
if [ -f "$PS" ]; then
  VERDICT=$(_safe_py3 "import json; print(json.load(open('$PS')).get('verdict',''))" '')
  WALL=$(_safe_py3 "import json; d=json.load(open('$PS')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
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

# Surface carried-over todos; log carry-over loader failures loudly.
_SS_CARRY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_ss_carry_err_$$")
set +e
CARRIED=$(PROJECT_ROOT="$PROJECT" PYTHONPATH="$PROJECT/tools/HME/service" python3 <<'PYEOF' 2>"$_SS_CARRY_ERR"
from server.tools_analysis.todo import list_carried_over
items = list_carried_over()
if items:
    print("\nCarried-over HME todos (" + str(len(items)) + " open):")
    crit = [i for i in items if i['critical']]
    normal = [i for i in items if not i['critical']]
    for i in crit:
        print("  !!! #" + str(i['id']) + " " + i['text'][:120] + " [" + i['source'] + "]")
    for i in normal:
        tag = " (" + str(i['open_subs']) + " open subs)" if i['open_subs'] else ""
        src = " [" + i['source'] + "]" if i['source'] else ""
        print("  [ ] #" + str(i['id']) + " " + i['text'][:100] + tag + src)
PYEOF
)
_SS_CARRY_RC=$?
set -e
if [ "$_SS_CARRY_RC" -ne 0 ] && [ -s "$_SS_CARRY_ERR" ] && [ -d "$PROJECT/log" ]; then
  _SS_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _ss_line; do
    [ -n "$_ss_line" ] && echo "[$_SS_TS] [sessionstart:list_carried_over] python3 failed: $_ss_line" \
      >> "$PROJECT/log/hme-errors.log"
  done < "$_SS_CARRY_ERR"
fi
rm -f "$_SS_CARRY_ERR" 2>/dev/null
[ -n "$CARRIED" ] && echo "$CARRIED" >&2

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
  _hme_bg_shell_timeout 25 snapshot-holograph "$SNAP_LOG" '
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

# Surface the current HCI trajectory summary so agents see the health arc.
if [ -f "$TRAJ_SCRIPT" ]; then
  _SS_TRAJ_ERR=$(mktemp 2>/dev/null || echo "/tmp/_ss_traj_err_$$")  # silent-ok: optional fallback path.
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

# Antagonism bridge: surface observe-only streak threshold recommendations.
CALIB_SCRIPT="$PROJECT/tools/HME/activity/streak_calibrator.py"
if [ -f "$CALIB_SCRIPT" ]; then
  _SS_CALIB_ERR=$(mktemp 2>/dev/null || echo "/tmp/_ss_calib_err_$$")  # silent-ok: optional fallback path.
  set +e
  CALIB_JSON=$(PROJECT_ROOT="$PROJECT" python3 "$CALIB_SCRIPT" 2>"$_SS_CALIB_ERR")
  _SS_CALIB_RC=$?
  set -e
  if [ "$_SS_CALIB_RC" -ne 0 ] && [ -s "$_SS_CALIB_ERR" ] && [ -d "$PROJECT/log" ]; then
    _SS_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _ss_line; do
      [ -n "$_ss_line" ] && echo "[$_SS_TS] [sessionstart:streak_calibrator] python3 failed: $_ss_line" \
        >> "$PROJECT/log/hme-errors.log"
    done < "$_SS_CALIB_ERR"
  fi
  rm -f "$_SS_CALIB_ERR" 2>/dev/null
  if [ -n "$CALIB_JSON" ]; then
    CALIB_LINE=$(echo "$CALIB_JSON" | python3 -c "
import json, os, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
cur = int(os.environ.get('HME_STREAK_WARN', 5))
rec = d.get('recommended_streak_warn')
vel = d.get('resolution_velocity', 0.5)
n   = d.get('history_samples', 0)
if rec is not None and rec != cur and n >= 5:
    print(f\"Streak calibrator: recommends HME_STREAK_WARN={rec} (current={cur}, resolution_velocity={vel:.2f}, n={n})\")
" 2>/dev/null || true)  # silent-ok: optional fallback path.
    [ -n "$CALIB_LINE" ] && echo "$CALIB_LINE" >&2
  fi
fi

# Previous session pending items (surfaced as a warning after main message)
if [ -n "$PREV_PENDING" ]; then
  echo -e "\nPrevious session left unfinished:$PREV_PENDING" >&2
fi

# Substrate pre-turn briefing from precomputed metrics only.
SUBSTRATE_BRIEF=$(python3 - <<'PY' 2>/dev/null || true  # silent-ok: optional fallback path.
import json, os
root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR") or "."
metrics_dir = os.environ.get("METRICS_DIR", os.path.join(root, "output", "metrics"))
def _j(name):
    try:
        with open(os.path.join(metrics_dir, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}
na = _j("hme-next-actions.json")
con = _j("hme-consensus.json")
dr = _j("hme-legendary-drift.json")
n_act = na.get("total_actions", 0)
bits = [f'substrate: consensus={con.get("mean","?")} stdev={con.get("stdev","?")} drift={dr.get("drift_score","?")} actions={n_act}']
if n_act > 0:
    for a in (na.get("actions") or [])[:3]:
        bits.append(f'  -> [{a.get("source","?")}] {a.get("id","?")}')
print("\n".join(bits))
PY
)
[ -n "$SUBSTRATE_BRIEF" ] && echo -e "\n$SUBSTRATE_BRIEF" >&2

# Stale-soft-warn auditor: surface promotion-review candidates.
_SOFT_AUDIT="$PROJECT_ROOT/tools/HME/scripts/detectors/audit_stale_soft_warns.py"
if [ -x "$_SOFT_AUDIT" ]; then
  _SOFT_OUT=$(PROJECT_ROOT="$PROJECT_ROOT" python3 "$_SOFT_AUDIT" 2>/dev/null || true)  # silent-ok: optional fallback path.
  case "$_SOFT_OUT" in
    *"need review"*) echo "$_SOFT_OUT" >&2 ;;
  esac
fi

# Fork-watchdog: surface silently-dropped completion notifications (recent only).
_FORK_WATCHDOG="$PROJECT_ROOT/tools/HME/scripts/fork_watchdog.py"
if [ -x "$_FORK_WATCHDOG" ]; then
  _FW_OUT=$(PROJECT_ROOT="$PROJECT_ROOT" python3 "$_FORK_WATCHDOG" 2>/dev/null || true)  # silent-ok: optional fallback path.
  case "$_FW_OUT" in
    *"notification not delivered"*|*"may be stuck"*) echo "$_FW_OUT" >&2 ;;
  esac
fi

# Learning-surface: prime patterns for the first active TODO item.
_LE="$PROJECT_ROOT/tools/HME/scripts/learning_extract.py"
_TODO_FILE="$PROJECT_ROOT/doc/templates/TODO.md"
if [ -x "$_LE" ] && [ -f "$_TODO_FILE" ]; then
  _TODO_TITLE=$(grep -E "^[[:space:]]*-[[:space:]]+\\[[[:space:]]\\][[:space:]]+\\[(E[1-5]|easy|medium|hard)\\]" "$_TODO_FILE" | head -1 \
    | sed -E 's/^[[:space:]]*-[[:space:]]+\[[[:space:]]\][[:space:]]+\[(E[1-5]|easy|medium|hard)\][[:space:]]+//' | tr -d '[:cntrl:]' | xargs || true)
  if [ -n "$_TODO_TITLE" ]; then
    _FIRST_KW=$(echo "$_TODO_TITLE" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) if(length($i)>=4){print $i; exit}}')
    if [ -n "$_FIRST_KW" ]; then
      PROJECT_ROOT="$PROJECT_ROOT" python3 "$_LE" surface --keyword "$_FIRST_KW" --top 3 2>/dev/null >&2 || true  # silent-ok: optional fallback path.
    fi
  fi
fi
exit 0
