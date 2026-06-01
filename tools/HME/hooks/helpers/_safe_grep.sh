#!/usr/bin/env bash
set -euo pipefail

# Safe recursive grep wrapper for HME-generated volatile state.
MAX_BYTES=${HME_SAFE_GREP_MAX_BYTES:-1048576}
MAX_LINE=${HME_SAFE_GREP_MAX_LINE:-4096}
VOLATILE_RE='(^|/)(tools/HME/(runtime|logs?|service/before-editing-cache\.json|session-state\.json)|log/|\.git/|node_modules/|__pycache__/|.*\.(jsonl|log|sqlite|db))($|/)'

args=("$@")
recursive=0
for arg in "${args[@]}"; do
  [[ "$arg" == -R || "$arg" == -r || "$arg" == --recursive || "$arg" == *R* ]] && recursive=1
done

if [[ $recursive -eq 1 ]]; then
  for arg in "${args[@]}"; do
    [[ "$arg" =~ $VOLATILE_RE ]] && { echo "safe_grep: blocked volatile recursive search: $arg" >&2; exit 2; }
  done
fi

exec grep --binary-files=without-match --exclude-dir=.git --exclude-dir=node_modules   --exclude='*.jsonl' --exclude='*.log' --exclude='*.sqlite' --exclude='*.db' "$@"   | awk -v max_line="$MAX_LINE" '{ if (length($0) > max_line) print substr($0,1,max_line) "...[truncated]"; else print }'   | head -c "$MAX_BYTES"
