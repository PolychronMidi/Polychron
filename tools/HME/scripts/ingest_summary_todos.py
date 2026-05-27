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
        wn = re.search(r"^\s*[-*]\s*what'?s?\s+next\s*:(.*)", story_text, re.IGNORECASE | re.MULTILINE)
        if wn:
            it = wn.group(1).strip()
            if it and it.lower() not in ("none", "nothing", "n/a"):
                for item in re.split(r"[;,]\s*|(?<!\w)\s*-\s+", it):
                    item = item.strip().rstrip(".,;")
                    if item and len(item) > 10:
                        all_items.append(("summary", item))

# Thinking-block bullets are stream-of-consciousness reasoning, not
# commitments. Earlier behavior captured fragments like "If size=0: OK"
# as todos. SUMMARY "what's next" remains the only auto-ingest surface.

if not all_items:
    sys.exit(0)

sys.path.insert(0, os.path.join(PROJECT, "tools", "HME", "service"))
from server.tools_analysis.todo_store import mutate_store, flat_entries, normalize_tier  # noqa: E402
import time

added: list[str] = []

def _ingest(meta: dict, todos: list, _raw: list):
    existing_texts = {t.get("text", "") for t in flat_entries(todos)}
    changed = False
    for source, item in all_items:
        if item in existing_texts:
            continue
        meta["max_id"] = int(meta.get("max_id", 0)) + 1
        todos.append({
            "id": meta["max_id"],
            "text": item,
            "activeForm": item,
            "status": "pending",
            "done": False,
            "critical": source == "summary",
            "source": "hme_todo",
            "on_done": "",
            "ts": time.time(),
            "parent_id": 0,
            "tier": normalize_tier(None),
            "subs": [],
        })
        existing_texts.add(item)
        added.append(item)
        changed = True
    return changed, len(added)

try:
    mutate_store(_ingest)
except Exception:
    pass  # silent-ok: ingest is opportunistic; failed writes must not break the Stop hook chain

# Write system-reminder for next-turn injection
if added:
    rp = os.path.join(PROJECT, "tmp", "hme-auto-todos.reminder")
    lines = ["", "[HME auto-todo ingest]",
             f"  {len(added)} commitment item(s) from your last turn added to todo list.",
             "  They will surface through native TodoWrite on the next todo update."]
    for i, item in enumerate(added, 1):
        lines.append(f"  {i}. {item[:120]}")
    try:
        with open(rp, "w") as f: f.write("\n".join(lines) + "\n")
    except Exception:  # silent-ok: reminder injection is opportunistic; todo store remains source of truth
        pass
