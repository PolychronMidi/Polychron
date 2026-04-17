#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME SessionStart: orientation — surface previous session state + current project state
cat > /dev/null  # consume stdin

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOKS_DIR/../helpers/_nexus.sh"

PROJECT="$PROJECT_ROOT"

# Failfast: verify all hook scripts are executable before any run
ERROR_LOG="${PROJECT}/log/hme-errors.log"
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
    echo "[$TS] [hooks] FAIL: $name not executable — run: chmod +x tools/HME/hooks/$name" >> "$ERROR_LOG"
  done
  echo "🚨 LIFESAVER: ${#BROKEN_HOOKS[@]} hook(s) not executable: ${BROKEN_HOOKS[*]} — logged to hme-errors.log" >&2
fi

# Capture previous session's pending items BEFORE state reset
PREV_PENDING=$(_nexus_pending)

# Reset session state for fresh session
mkdir -p "${PROJECT}/tmp"
> "${PROJECT}/tmp/hme-tab.txt"
> "${PROJECT}/tmp/hme-nexus.state"
> "${PROJECT}/tmp/hme-primer-needed.flag"

# Initialize onboarding state machine — every new session re-arms the walkthrough
source "$HOOKS_DIR/../helpers/_onboarding.sh"
_onb_init

# ── HME Proxy + Supervisor (:9099) ───────────────────────────────────────────
# Proxy owns shim + MCP as supervised children. Starting the proxy is all
# that's needed — it spawns the shim (7734) and MCP (9098) automatically.
# Claude Code connects via SSE: url = http://127.0.0.1:9099/mcp
PROXY_PORT="${HME_PROXY_PORT:-9099}"
if [ "${HME_PROXY_ENABLED:-0}" = "1" ]; then
  if ! curl -sf --max-time 1 "http://127.0.0.1:${PROXY_PORT}/health" > /dev/null 2>&1; then
    PROXY_SCRIPT="$PROJECT_ROOT/tools/HME/proxy/hme_proxy.js"
    if [ -f "$PROXY_SCRIPT" ]; then
      HME_PROXY_PORT="$PROXY_PORT" nohup node "$PROXY_SCRIPT" \
        > "$PROJECT_ROOT/log/hme-proxy.out" 2>&1 &
      echo "HME proxy+supervisor started on :${PROXY_PORT} (pid $!) — shim and MCP will spawn as children" >&2
    fi
  else
    echo "HME proxy already running on :${PROXY_PORT}" >&2
  fi
fi

# Ensure llama-server instances are running (arbiter :8080, coder :8081).
# Same /health-probe-then-nohup pattern as the shim, applied to the local
# inference tier. HME's in-process supervisor (server/llamacpp_supervisor.py)
# handles hot supervision during a session — this block handles cold boot
# before Python is alive. Topology overrides come from env; defaults match
# the committed supervisor config.
LLAMA_BIN="$HME_LLAMA_SERVER_BIN"
# DISABLED — user explicitly cancelled all auto-launch. Set HME_AUTOLAUNCH_LLAMA=1 to re-enable.
if [ "${HME_AUTOLAUNCH_LLAMA:-0}" = "1" ] && [ -x "$LLAMA_BIN" ]; then
  _start_llama() {
    local name="$1" port="$2" model="$3" device="$4" alias="$5" ctx="$6" lora="$7"
    if curl -sf --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    if [ ! -f "$model" ]; then
      echo "WARN: llama-server ${name} model missing: $model" >&2
      return 1
    fi
    local args=("--model" "$model" "--host" "127.0.0.1" "--port" "$port"
                "--ctx-size" "$ctx" "--n-gpu-layers" "999" "--device" "$device"
                "--alias" "$alias" "--timeout" "30" "--jinja")
    if [ -n "$lora" ] && [ -f "$lora" ]; then
      args+=("--lora" "$lora")
    fi
    local log="$PROJECT/tools/HME/mcp/log/llama-server-${name}.log"
    mkdir -p "$(dirname "$log")"
    nohup "$LLAMA_BIN" "${args[@]}" >> "$log" 2>&1 &
    disown $! 2>/dev/null || true
    echo "llama-server ${name} started (pid $!) on :${port} ${device}" >&2
  }
  _start_llama arbiter \
    "${HME_ARBITER_PORT:?HME_ARBITER_PORT not in .env}" \
    "${HME_ARBITER:?HME_ARBITER not in .env}" \
    "${HME_ARBITER_VULKAN:?HME_ARBITER_VULKAN not in .env}" \
    "${HME_ARBITER_MODEL:?HME_ARBITER_MODEL not in .env}" \
    "${HME_ARBITER_CTX:?HME_ARBITER_CTX not in .env}" \
    ""
  _start_llama coder \
    "${HME_CODER_PORT:?HME_CODER_PORT not in .env}" \
    "${HME_CODER:?HME_CODER not in .env}" \
    "${HME_CODER_VULKAN:?HME_CODER_VULKAN not in .env}" \
    "${HME_CODER_ALIAS:?HME_CODER_ALIAS not in .env}" \
    "${HME_CODER_CTX:?HME_CODER_CTX not in .env}" \
    ""
else
  echo "WARN: llama-server binary missing at $LLAMA_BIN — skipping local inference launch" >&2
fi

# Persist HME env vars for the session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export HME_ACTIVE=1" >> "$CLAUDE_ENV_FILE"
fi

# Build orientation message
MSG=""

# Pipeline verdict + wall time
PS="$PROJECT/metrics/pipeline-summary.json"
if [ -f "$PS" ]; then
  VERDICT=$(_safe_py3 "import json; print(json.load(open('$PS')).get('verdict',''))" '')
  WALL=$(_safe_py3 "import json; d=json.load(open('$PS')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
  [ -n "$VERDICT" ] && MSG="$MSG\nPipeline: $VERDICT${WALL:+ (${WALL})}"
fi

# Last journal round
JOURNAL="$PROJECT/metrics/journal.md"
if [ -f "$JOURNAL" ]; then
  LAST_ROUND=$(grep -m1 '^## R' "$JOURNAL" | head -1)
  [ -n "$LAST_ROUND" ] && MSG="$MSG\n$LAST_ROUND"
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
echo -e "HyperMeta Ecstasy active. Load skill: /HME\nOnboarding: $ONB_STEP$MSG" >&2

# Surface carried-over open todos from previous session — so the agent resumes
# with full visibility into unfinished work. LIFESAVER criticals surface first,
# then everything else. The TodoWrite hook will re-merge these into native view
# on the next TodoWrite call.
CARRIED=$(PROJECT_ROOT="$PROJECT" PYTHONPATH="$PROJECT/tools/HME/mcp" python3 <<'PYEOF' 2>/dev/null
try:
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
except Exception:
    pass
PYEOF
)
[ -n "$CARRIED" ] && echo "$CARRIED" >&2

# Capture a session-start holograph so the stop hook can diff against it and
# surface drift that happened during the session. The holograph is the
# substrate for self-coherence time-series analysis — every session adds a
# data point. Run in background so SessionStart stays fast.
HOLO_SCRIPT="$PROJECT/tools/HME/scripts/snapshot-holograph.py"
if [ -f "$HOLO_SCRIPT" ]; then
  SESSION_HOLO="$PROJECT/tmp/hme-session-start.holograph.json"
  PROJECT_ROOT="$PROJECT" python3 "$HOLO_SCRIPT" --stdout > "$SESSION_HOLO" 2>/dev/null &
fi

# Refresh the tool-effectiveness analysis in the background. Reads log/hme.log
# and writes metrics/hme-tool-effectiveness.json, which the LifesaverRate
# and MetaObserverCoherence verifiers consume to compute the HCI.
EFF_SCRIPT="$PROJECT/tools/HME/scripts/analyze-tool-effectiveness.py"
[ -f "$EFF_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$EFF_SCRIPT" > /dev/null 2>&1 &

# Update HCI trajectory in the background for time-series analysis
TRAJ_SCRIPT="$PROJECT/tools/HME/scripts/analyze-hci-trajectory.py"
[ -f "$TRAJ_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$TRAJ_SCRIPT" > /dev/null 2>&1 &

# Surface the current HCI trajectory summary so agents see the health arc
if [ -f "$TRAJ_SCRIPT" ]; then
  TRAJ_LINE=$(PROJECT_ROOT="$PROJECT" python3 "$TRAJ_SCRIPT" --summary 2>/dev/null)
  [ -n "$TRAJ_LINE" ] && echo "$TRAJ_LINE" >&2
fi

# Previous session pending items (surfaced as a warning after main message)
if [ -n "$PREV_PENDING" ]; then
  echo -e "\nPrevious session left unfinished:$PREV_PENDING" >&2
fi

exit 0
