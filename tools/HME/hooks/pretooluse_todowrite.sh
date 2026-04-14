#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: TodoWrite — mirror to HME store as a side effect, then ALLOW
# native TodoWrite to run normally. The HME store adds persistence, richer
# metadata (critical flag, subs, timestamps), and cross-session history on top
# of what native TodoWrite provides. From the agent's perspective, TodoWrite
# behaves exactly like the native tool — only the side effect is added.
INPUT=$(cat)

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
TODO_FILE="${PROJECT}/.claude/mcp/HME/todos.json"
HME_LOG="${PROJECT}/log/hme.log"

# Mirror the full current list to the HME store. TodoWrite sends the entire
# list on every call, so we REPLACE the HME store contents rather than append —
# keeps the two in sync instead of growing a duplicate-bloated history.
# Native tool metadata (status, activeForm) is preserved alongside HME extras.
python3 -c "
import sys, json, os, time
try:
    payload = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
todo_file = sys.argv[1]
items = payload.get('tool_input', {}).get('todos', []) or []
# Preserve existing HME extras (critical flag, subs) by matching on content
try:
    prior = json.loads(open(todo_file).read())
except Exception:
    prior = []
prior_by_text = {}
for t in prior:
    if isinstance(t, dict) and 'text' in t:
        prior_by_text[t['text']] = t
out = []
next_id = 1
for item in items:
    if not isinstance(item, dict):
        continue
    text = item.get('content', '')
    status = item.get('status', 'pending')
    activeForm = item.get('activeForm', '')
    existing = prior_by_text.get(text, {})
    entry = {
        'id': existing.get('id', next_id),
        'text': text,
        'activeForm': activeForm,
        'status': status,
        'done': status == 'completed',
        'critical': existing.get('critical', False),
        'ts': existing.get('ts', time.time()),
        'subs': existing.get('subs', []),
    }
    out.append(entry)
    next_id += 1
os.makedirs(os.path.dirname(todo_file), exist_ok=True)
open(todo_file, 'w').write(json.dumps(out, indent=2))
" "$TODO_FILE" <<<"$INPUT" 2>/dev/null || true

printf '%s INFO hook: TodoWrite mirrored → HME store\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null

# Allow native TodoWrite to run — agent's session-visible list stays accurate
exit 0
