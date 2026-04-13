#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Agent — intercept research subagents and route to local Ollama + RAG.
# Only intercepts Explore-type agents. General-purpose and other types pass through.
# The local agentic loop has RAG context + KB that Claude agents lack.
INPUT=$(cat)

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
HME_LOG="$PROJECT/log/hme.log"

# Extract agent parameters
SUBAGENT_TYPE=$(_safe_jq "$INPUT" '.tool_input.subagent_type' 'general-purpose')
DESCRIPTION=$(_safe_jq "$INPUT" '.tool_input.description' '')
PROMPT=$(_safe_jq "$INPUT" '.tool_input.prompt' '')

# Only intercept Explore agents — other types (Plan, general-purpose) pass through
if [[ "$SUBAGENT_TYPE" != "Explore" ]]; then
  exit 0
fi

# Check if Ollama is reachable before committing to local agent
if ! curl -sf --max-time 2 "http://127.0.0.1:11435/api/tags" > /dev/null 2>&1; then
  printf '%s INFO hook: Agent PASSTHROUGH — Ollama unreachable, letting Claude handle it\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
  exit 0
fi

printf '%s INFO hook: Agent INTERCEPTED [%s] "%s" — routing to local agentic loop\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" "$SUBAGENT_TYPE" "$DESCRIPTION" >> "$HME_LOG" 2>/dev/null

# Run local agentic loop — timeout at 240s (hook timeout is 300s, need margin)
AGENT_SCRIPT="$PROJECT/tools/HME/mcp/agent_local.py"
if [[ ! -f "$AGENT_SCRIPT" ]]; then
  printf '%s WARNING hook: agent_local.py not found, passing through\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
  exit 0
fi

RESULT=$(echo "$PROMPT" | timeout 240 python3 "$AGENT_SCRIPT" \
  --stdin --json --project "$PROJECT" 2>/dev/null <<< "{\"prompt\": $(echo "$PROMPT" | jq -Rs .)}")

if [[ $? -ne 0 || -z "$RESULT" ]]; then
  printf '%s WARNING hook: local agent failed, passing through to Claude\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
  exit 0
fi

# Extract answer from JSON result
ANSWER=$(echo "$RESULT" | jq -r '.answer // empty' 2>/dev/null)
ELAPSED=$(echo "$RESULT" | jq -r '.elapsed_s // "?"' 2>/dev/null)
TOOLS_COUNT=$(echo "$RESULT" | jq -r '.tools_used | length // 0' 2>/dev/null)
ITERS=$(echo "$RESULT" | jq -r '.iterations // "?"' 2>/dev/null)
MODEL=$(echo "$RESULT" | jq -r '.model // "?"' 2>/dev/null)

if [[ -z "$ANSWER" || "$ANSWER" == "null" ]]; then
  printf '%s WARNING hook: local agent returned empty answer, passing through\n' \
    "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
  exit 0
fi

printf '%s INFO hook: Agent COMPLETED locally [%s iterations, %s tools, %ss]\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" "$ITERS" "$TOOLS_COUNT" "$ELAPSED" >> "$HME_LOG" 2>/dev/null

# Block the Claude agent and return local result
MSG="[HME Local Agent — $MODEL | ${ITERS} iterations | ${TOOLS_COUNT} tools | ${ELAPSED}s]

$ANSWER"

jq -n --arg reason "$MSG" '{"decision":"block","reason":$reason}'
exit 2
