#!/usr/bin/env bash
# HME PreToolUse: Bash — block run.lock deletion + suggest HME alternatives
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Block run.lock deletion (hard rule)
if echo "$CMD" | grep -q 'run\.lock' && echo "$CMD" | grep -q 'rm'; then
  echo '{"decision":"block","reason":"BLOCKED: Never delete run.lock"}'
  exit 2
fi

# Suggest HME alternatives for shell commands
if echo "$CMD" | grep -qE '^(grep |cat |head |tail |wc -l)'; then
  TOOL=$(echo "$CMD" | cut -d' ' -f1)
  echo "PREFER HME: use grep(), file_lines(), or count_lines() MCP tools for KB-enriched results. Bash $TOOL is allowed but misses KB context." >&2
fi
exit 0
