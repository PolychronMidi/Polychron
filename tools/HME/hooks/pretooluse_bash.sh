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

# Block polling: task output files or pipeline log
if echo "$CMD" | grep -qE '(tail|cat|head|grep).*(/tasks/[a-z0-9]+\.output|r4[0-9]+_run|run\.log|pipeline\.log)'; then
  echo '{"decision":"block","reason":"BLOCKED: Polling task output or pipeline log is the antipattern. run_in_background fires a notification when done — continue with other work now."}'
  exit 2
fi

# Block sleep-then-check patterns (sleep N && tail/cat/grep)
if echo "$CMD" | grep -qE 'sleep.*(tail|cat|head|grep|\.output)'; then
  echo '{"decision":"block","reason":"BLOCKED: sleep+check is the polling antipattern. Do not sleep-poll background tasks — a notification fires when done. Continue with other work."}'
  exit 2
fi

# Suggest HME alternatives for shell commands
if echo "$CMD" | grep -qE '^(grep |cat |head |tail |wc -l)'; then
  TOOL=$(echo "$CMD" | cut -d' ' -f1)
  echo "PREFER HME: use grep(), file_lines(), or count_lines() MCP tools for KB-enriched results. Bash $TOOL is allowed but misses KB context." >&2
fi
exit 0
