#!/usr/bin/env bash
# HME PreToolUse: Read — block polling of background task output files.
# Reading /tmp/.../tasks/*.output while the pipeline runs is the same polling
# antipattern as tail/cat — a task-completion notification fires automatically,
# so there is no reason to read the file before then.
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Block reads to background task output files
if echo "$FILE_PATH" | grep -qE '/tasks/[a-z0-9]+\.output$'; then
  echo '{"decision":"block","reason":"ANTI-POLLING: Reading a background task output file is the polling antipattern. You will be automatically notified when the task completes — do NOT read the output file before then. Continue with other work now."}'
  exit 2
fi

exit 0
