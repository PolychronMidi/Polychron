#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME SessionStart: orientation — surface previous session state + current project state
cat > /dev/null  # consume stdin

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOKS_DIR/_nexus.sh"

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"

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
source "$HOOKS_DIR/_onboarding.sh"
_onb_init

# Ensure HME HTTP shim is running. Port-based check is insufficient — a
# different process could hold port 7734 (not HME) and the health endpoint
# won't respond. Probe the /health endpoint explicitly; if it doesn't respond
# or returns non-200, start the HME shim even if the port appears taken
# (port-collision failure surfaces to hme_http.py which will log it).
# Pin the RAG stack to GPU0 (co-resident with the arbiter llama-server).
# Without this override the shim grabs whichever GPU happens to be freest at
# boot, which has historically been GPU1 — blocking the coder llama-server
# (qwen3-coder-30b needs ~18.5 GB and won't fit alongside a 7 GB RAG stack).
# Override with HME_RAG_GPU=-1 (CPU), "auto" (free-memory heuristic), or a
# different index in .env.
export HME_RAG_GPU="${HME_RAG_GPU:-0}"

SHIM_PORT=7734
SHIM_HEALTHY=0
if curl -sf --max-time 2 "http://127.0.0.1:${SHIM_PORT}/health" > /dev/null 2>&1; then
  SHIM_HEALTHY=1
fi
if [ "$SHIM_HEALTHY" -eq 0 ]; then
  # Check if port is held by something non-HME
  if ss -tlnp 2>/dev/null | grep -q ":${SHIM_PORT} "; then
    echo "WARN: port ${SHIM_PORT} is held but /health didn't respond — a non-HME process may be squatting the port" >&2
  fi
  SHIM="$PROJECT/tools/HME/mcp/hme_http.py"
  if [ -f "$SHIM" ]; then
    nohup python3 "$SHIM" --port "$SHIM_PORT" \
      > "$PROJECT/log/hme_http.out" 2>&1 &
    echo "HME shim started (pid $!)" >&2
  fi
fi

# Ensure llama-server instances are running (arbiter :8080, coder :8081).
# Same /health-probe-then-nohup pattern as the shim, applied to the local
# inference tier. HME's in-process supervisor (server/llamacpp_supervisor.py)
# handles hot supervision during a session — this block handles cold boot
# before Python is alive. Topology overrides come from env; defaults match
# the committed supervisor config.
LLAMA_BIN="${HME_LLAMA_SERVER_BIN:-/home/jah/tools/llama-cpp-vulkan/llama-b8797/llama-server}"
if [ -x "$LLAMA_BIN" ]; then
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
    "${HME_ARBITER_PORT:-8080}" \
    "${HME_ARBITER_GGUF:-/home/jah/models/phi-4-Q4_K_M.gguf}" \
    "${HME_ARBITER_VULKAN:-Vulkan1}" \
    "${HME_ARBITER_MODEL:-hme-arbiter-v6}" \
    "${HME_ARBITER_CTX:-4096}" \
    "${HME_ARBITER_LORA:-/home/jah/Polychron/metrics/hme-arbiter-v6-lora.gguf}"
  _start_llama coder \
    "${HME_CODER_PORT:-8081}" \
    "${HME_CODER_GGUF:-/home/jah/models/qwen3-coder-30b-Q4_K_M.gguf}" \
    "${HME_CODER_VULKAN:-Vulkan2}" \
    "${HME_CODER_ALIAS:-qwen3-coder:30b}" \
    "${HME_CODER_CTX:-8192}" \
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
