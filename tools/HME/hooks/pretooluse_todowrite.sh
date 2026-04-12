#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: TodoWrite — redirect to mcp__HME__todo (supports subtodos).
# Denies TodoWrite and injects the original tasks formatted for the HME tool.
INPUT=$(cat)

# Extract todo texts from the TodoWrite input for the redirect message.
TODOS=$(_safe_jq "$INPUT" '[.tool_input.todos[]? | .content] | join("\n  - ")' '')
if [ -z "$TODOS" ]; then TODOS="(no items parsed)"; fi

HME_LOG="${CLAUDE_PROJECT_DIR:-$(pwd)}/log/hme.log"
printf '%s INFO hook: TodoWrite REDIRECTED → mcp__HME__todo (%s)\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" "$TODOS" >> "$HME_LOG" 2>/dev/null

MSG="BLOCKED: Use mcp__HME__todo instead of TodoWrite — subtodo support + auto-completion.\n\nYour tasks:\n  - ${TODOS}\n\nAPI: mcp__HME__todo(action=\"add\", text=\"task\") | mcp__HME__todo(action=\"done\", todo_id=N) | mcp__HME__todo(action=\"list\")"
jq -n --arg msg "$MSG" '{"decision":"block","reason":$msg}'
exit 2
