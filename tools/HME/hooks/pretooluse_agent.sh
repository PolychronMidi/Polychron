#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Agent — intercept Explore subagents → local Ollama + RAG.
# Async pattern: creates placeholder file, launches agent in background, returns
# immediately with file reference — mirrors Claude subagent behavior.
INPUT=$(cat)

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
HME_LOG="$PROJECT/log/hme.log"

SUBAGENT_TYPE=$(_safe_jq "$INPUT" '.tool_input.subagent_type' 'general-purpose')
DESCRIPTION=$(_safe_jq "$INPUT" '.tool_input.description' '')
PROMPT=$(_safe_jq "$INPUT" '.tool_input.prompt' '')

# Only intercept Explore agents — other types pass through
if [[ "$SUBAGENT_TYPE" != "Explore" ]]; then
  exit 0
fi

# Check Ollama reachable
if ! curl -sf --max-time 2 "http://127.0.0.1:11435/api/tags" > /dev/null 2>&1; then
  printf '%s INFO hook: Agent PASSTHROUGH — Ollama unreachable\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
  exit 0
fi

AGENT_SCRIPT="$PROJECT/tools/HME/mcp/agent_local.py"
if [[ ! -f "$AGENT_SCRIPT" ]]; then
  exit 0
fi

# Generate agent ID and create placeholder (mirrors Claude subagent file pattern)
AGENT_ID=$(head -c 4 /dev/urandom | xxd -p)
RESULT_FILE="/tmp/hme-agent-${AGENT_ID}.md"
echo "subagent still working" > "$RESULT_FILE"

printf '%s INFO hook: Agent INTERCEPTED [%s] "%s" → %s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" "$SUBAGENT_TYPE" "$DESCRIPTION" "$RESULT_FILE" \
  >> "$HME_LOG" 2>/dev/null

# Launch agent in background — writes result to file when done
PROMPT_JSON=$(echo "$PROMPT" | jq -Rs '{"prompt": .}')
(
  RESULT=$(echo "$PROMPT_JSON" | timeout 240 python3 "$AGENT_SCRIPT" \
    --stdin --json --project "$PROJECT" 2>/dev/null)

  if [[ -n "$RESULT" ]]; then
    ANSWER=$(echo "$RESULT" | jq -r '.answer // empty' 2>/dev/null)
    ELAPSED=$(echo "$RESULT" | jq -r '.elapsed_s // "?"' 2>/dev/null)
    TOOLS_COUNT=$(echo "$RESULT" | jq -r '.tools_used | length // 0' 2>/dev/null)
    ITERS=$(echo "$RESULT" | jq -r '.iterations // "?"' 2>/dev/null)
    MODEL=$(echo "$RESULT" | jq -r '.model // "?"' 2>/dev/null)

    if [[ -n "$ANSWER" && "$ANSWER" != "null" ]]; then
      printf '[HME Local Agent — %s | %s iterations | %s tools | %ss]\n\n%s' \
        "$MODEL" "$ITERS" "$TOOLS_COUNT" "$ELAPSED" "$ANSWER" > "$RESULT_FILE"
    else
      echo "[HME Local Agent] empty answer — raw result preserved below" > "$RESULT_FILE"
      echo "$RESULT" >> "$RESULT_FILE"
    fi
  else
    echo "[HME Local Agent] failed or timed out" > "$RESULT_FILE"
  fi

  printf '%s INFO hook: Agent %s COMPLETED → %s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" "$AGENT_ID" "$RESULT_FILE" \
    >> "$HME_LOG" 2>/dev/null
) &

# Return immediately — results will appear in the file
_emit_block "The results will be available at ${RESULT_FILE}"
exit 2
