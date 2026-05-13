#!/usr/bin/env python3
# Auto-ingest commitment items from SUMMARY and thinking blocks into HME todos.
import json, os, re, sys
from datetime import datetime, timezone

PROJECT = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
if not PROJECT:
    sys.exit(0)

transcript_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJECT, "log", "session-transcript.jsonl")

assistant_texts = []
last_text = ""
try:
    with open(transcript_path) as f:
        for line in f:
            if not line.strip(): continue
            ev = json.loads(line)
            if ev.get("type") != "assistant": continue
            msg = ev.get("message", {})
            for b in (msg.get("content") or []):
                btype = b.get("type", "")
                t = b.get("text", "")
                if btype == "text" and isinstance(t, str):
                    assistant_texts.append(("text", t)); last_text = t
                elif btype == "thinking" and isinstance(b.get("thinking", ""), str):
                    t = b["thinking"]
                    assistant_texts.append(("thinking", t))
except Exception:  # silent-ok: transcript may not exist
    sys.exit(0)

# Commitment language indicating enumerable work items
_COMMIT = re.compile(
    r"(?:still\s+need\s+to|must\s+(?:fix|address|do)|haven'?t\s+(?:yet|done)|"
    r"should\s+(?:also\s+)?(?:fix|add|implement|wire|update|remove|clean|"
    r"centralize|consolidate|align|extend|build|create|write|register|test|"
    r"verify|check|run|address|do|make|handle|resolve|finish|complete))",
    re.IGNORECASE
)
_BULLET = re.compile(r"^\s*[-*]\s+(.+)$", re.MULTILINE)

all_items = []

# 1. SUMMARY "what's next"
banner_m = re.search(r"={3,}\s*SUMMARY\s*={3,}", last_text, re.IGNORECASE)
if banner_m:
    st = last_text[banner_m.end():]
    sm = re.search(r"\[STORY\]\s*:", st, re.IGNORECASE)
    if sm:
        ss = sm.end()
        nx = re.search(r"\n\s*\[[A-Z]", st[ss:])
        story_text = st[ss:ss + nx.start()] if nx else st[ss:]
        wn = re.search(r"^\s*[-*]\s*what(?:'|’)?s?\s+next\s*:(.*)", story_text, re.IGNORECASE | re.MULTILINE)
        if wn:
            it = wn.group(1).strip()
            if it and it.lower() not in ("none", "nothing", "n/a"):
                for item in re.split(r"[;,]\s*|(?<!\w)\s*-\s+", it):
                    item = item.strip().rstrip(".,;")
                    if item and len(item) > 10:
                        all_items.append(("summary", item))

# 2. thinking block bulleted commitments
for btype, text in assistant_texts:
    if btype != "thinking": continue
    for m in _BULLET.finditer(text):
        c = m.group(1).strip().rstrip(".,;")
        if len(c) < 10: continue
        if c.lower().startswith(("i ", "we ", "the ", "this ", "that ", "it ", "if ", "but ", "and ", "or ")):
            all_items.append(("thinking", c))

if not all_items:
    sys.exit(0)

# Write to todos.json
todos_path = os.path.join(PROJECT, "tools", "HME", "KB", "todos.json")
todos = []
try:
    with open(todos_path) as f:
        todos = json.load(f)
    if not isinstance(todos, list): todos = []
except Exception:  # silent-ok
    pass

max_id = max((t.get("id", 0) for t in todos if isinstance(t, dict)), default=0)
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
added = []
for source, item in all_items:
    if any(t.get("text") == item for t in todos if isinstance(t, dict)): continue
    max_id += 1; added.append(item)
    todos.append({"id": max_id, "text": item, "status": "pending",
                   "critical": source == "summary", "source": f"auto_{source}", "created": now})

tmp = todos_path + ".tmp"
try:
    with open(tmp, "w") as f: json.dump(todos, f, indent=2)
    os.replace(tmp, todos_path)
except Exception:  # silent-ok
    pass

# Write system-reminder for next-turn injection
if added:
    rp = os.path.join(PROJECT, "tmp", "hme-auto-todos.reminder")
    lines = ["", "[HME auto-todo ingest]",
             f"  {len(added)} commitment item(s) from your last turn added to todo list.",
             "  Run `i/todo list source=auto_*` to review, `i/todo cancel <id>` to dismiss."]
    for i, item in enumerate(added, 1):
        lines.append(f"  {i}. {item[:120]}")
    try:
        with open(rp, "w") as f: f.write("\n".join(lines) + "\n")
    except Exception:  # silent-ok
        pass
