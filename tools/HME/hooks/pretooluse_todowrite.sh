#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: TodoWrite — redirect to mcp__HME__todo (supports subtodos).
# Denies TodoWrite and injects the original tasks formatted for the HME tool.
INPUT=$(cat)

# Extract todo texts from the TodoWrite input for the redirect message.
TODOS=$(_safe_jq "$INPUT" '[.tool_input.todos[]? | .content] | join("\n  - ")' '')
if [ -z "$TODOS" ]; then TODOS="(no items parsed)"; fi

jq -n --arg todos "$TODOS" \
  '{"hookSpecificOutput":{"permissionDecision":"deny"},"systemMessage":("Use mcp__HME__todo instead of TodoWrite — it supports hierarchical subtodos and auto-completion.\n\nYour tasks:\n  - " + $todos + "\n\nAPI: mcp__HME__todo(action=\"add\", text=\"task\") for main todos.\nmcp__HME__todo(action=\"add\", text=\"subtask\", parent_id=N) for subtodos.\nmcp__HME__todo(action=\"done\", todo_id=N) to complete. Main auto-completes when all subs done.\nmcp__HME__todo(action=\"list\") to view.")}'
exit 0
