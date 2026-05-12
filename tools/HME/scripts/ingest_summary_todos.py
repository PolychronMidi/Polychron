#!/usr/bin/env python3
# Auto-ingest "what's next" items from E5 SUMMARY blocks into the HME todo system.
import json, os, re, sys
from datetime import datetime, timezone

PROJECT = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
if not PROJECT:
    sys.exit(0)

transcript_path = os.path.join(PROJECT, "log", "session-transcript.jsonl")
last_text = ""
try:
    with open(transcript_path) as f:
        for line in f:
            if not line.strip(): continue
            ev = json.loads(line)
            if ev.get("type") == "assistant" or ev.get("role") == "assistant":
                content = (ev.get("message") or {}).get("content") or ev.get("content", "")
                if isinstance(content, list):
                    last_text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
                elif isinstance(content, str):
                    last_text = content
except Exception:  # silent-ok: best-effort, transcript may not exist
    sys.exit(0)

if not last_text:
    sys.exit(0)

banner_m = re.search(r"={3,}\s*SUMMARY\s*={3,}", last_text, re.IGNORECASE)
if not banner_m:
    sys.exit(0)
summary_text = last_text[banner_m.end():]
story_m = re.search(r"\[STORY\]\s*:", summary_text, re.IGNORECASE)
if not story_m:
    sys.exit(0)
story_start = story_m.end()
next_section = re.search(r"\n\s*\[[A-Z]", summary_text[story_start:])
story_text = summary_text[story_start:story_start + next_section.start()] if next_section else summary_text[story_start:]

wn_re = re.compile(r"^\s*[-*]\s*what(?:'|’)?s?\s+next\s*:(.*)", re.IGNORECASE | re.MULTILINE)
wn_m = wn_re.search(story_text)
if not wn_m:
    sys.exit(0)

items_text = wn_m.group(1).strip()
if not items_text or items_text.lower() in ("none", "nothing", "n/a"):
    sys.exit(0)

items = [i.strip().rstrip(".,;") for i in re.split(r"[;,]\s*|(?<!\w)\s*-\s+", items_text) if i.strip()]
if not items:
    sys.exit(0)

todos_path = os.path.join(PROJECT, "tools", "HME", "KB", "todos.json")
todos = []
try:
    with open(todos_path) as f:
        todos = json.load(f)
    if not isinstance(todos, list):
        todos = []
except Exception:  # silent-ok: file may not exist
    pass

max_id = max((t.get("id", 0) for t in todos if isinstance(t, dict)), default=0)
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
for item in items:
    max_id += 1
    todos.append({"id": max_id, "text": item, "status": "pending", "critical": True, "source": "summary_whats_next", "created": now})

tmp = todos_path + ".tmp"
try:
    with open(tmp, "w") as f:
        json.dump(todos, f, indent=2)
    os.replace(tmp, todos_path)
except Exception:  # silent-ok: best-effort persistence
    pass
