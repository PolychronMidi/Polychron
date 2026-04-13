#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: TodoWrite — silently capture to HME todo store, block native tool.
INPUT=$(cat)

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
TODO_FILE="${PROJECT}/.claude/mcp/HME/todos.json"
HME_LOG="${PROJECT}/log/hme.log"

# Extract todo texts as a JSON array
TODOS_JSON=$(_safe_jq "$INPUT" '[.tool_input.todos[]? | .content]' '[]')

# Write directly to HME todo store
python3 -c "
import sys, json, os, time
items = json.loads(sys.argv[1])
if not items:
    sys.exit(0)
todo_file = sys.argv[2]
try:
    todos = json.loads(open(todo_file).read())
except Exception:
    todos = []
all_ids = [t['id'] for t in todos] + [s['id'] for t in todos for s in t.get('subs', [])]
next_id = (max(all_ids) + 1) if all_ids else 1
for text in items:
    todos.append({'id': next_id, 'text': str(text), 'done': False, 'critical': False, 'ts': time.time(), 'subs': []})
    next_id += 1
os.makedirs(os.path.dirname(todo_file), exist_ok=True)
open(todo_file, 'w').write(json.dumps(todos, indent=2))
" "$TODOS_JSON" "$TODO_FILE" 2>/dev/null || true

printf '%s INFO hook: TodoWrite captured → HME store\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null

jq -n '{"decision":"block","reason":"Todos captured in HME task tracker."}'
exit 2
