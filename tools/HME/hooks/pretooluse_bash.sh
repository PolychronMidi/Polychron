#!/usr/bin/env bash
# HME PreToolUse: Bash — block run.lock deletion + suggest HME alternatives + anti-wait injection
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Block run.lock deletion (hard rule)
if echo "$CMD" | grep -q 'run\.lock' && echo "$CMD" | grep -q 'rm'; then
  echo '{"decision":"block","reason":"BLOCKED: Never delete run.lock"}'
  exit 2
fi

# Anti-wait injection: long-running pipeline commands run in background.
# Claude MUST continue working — NOT stop and wait for completion.
if echo "$CMD" | grep -qE '(npm run main|npm run snapshot|node lab/run)'; then
  cat >&2 <<'MSG'
ANTI-WAIT ENFORCEMENT: This command runs in background. Do NOT stop and wait for it.
Continue immediately with parallel work: HME break-point scanning, src/ evolution,
doc improvements, or any other pending tasks. The posttooluse hook will inject
Evolver phase steps when the command completes. Stopping to wait is the antipattern.
MSG
fi

# Suggest HME alternatives for shell commands
if echo "$CMD" | grep -qE '^(grep |cat |head |tail |wc -l)'; then
  TOOL=$(echo "$CMD" | cut -d' ' -f1)
  echo "PREFER HME: use grep(), file_lines(), or count_lines() MCP tools for KB-enriched results. Bash $TOOL is allowed but misses KB context." >&2
fi
exit 0
