"""Legacy compatibility shim — TODO.md is now the store, not a derived view.

The render/sync functions in this module are kept as thin wrappers so
existing imports keep working. New code should call `todo_store` directly.

The parsing utilities (TASK_RE, _read_section, task_items, normalize_for_match)
are still active and used by `todo_markdown_ingest` and `todo_close`.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from paths import todo_file as _todo_md_file  # noqa: E402
from .todo_store import (  # noqa: E402
    _render_md,
    flat_entries,
    load_store,
    mutate_store,
    normalize_tier,
    save_todos,
)

TASK_RE = re.compile(
    r"^(?P<indent>\s*)-\s+\[(?P<mark>[ xX])\]\s+\[(?P<tier>E[1-5]|easy|medium|hard)\]\s+"
    r"(?:#\d+\s+)?(?:\[[A-Za-z_]\w*\]\s+)?(?:!crit\s+)?"
    r"(?P<text>.+?)"
    r"(?:\s+→\s+[^<]+)?(?:\s+<!--[^>]*-->)?\s*$",
    re.IGNORECASE,
)
QUEUE_RE = re.compile(
    r"^\s*-\s+\[(?P<tier>E[1-5]|easy|medium|hard)\]\s+(?P<text>.+?)(?:\s+Reason:\s+(?P<reason>.+?))?\s*$",
    re.IGNORECASE,
)

SECTION_ALIASES = {
    "now": ("Now", "In flight"),
    "next": ("Next", "Next up", "Next up (queued for next cycle)"),
    "done": ("Done", "Just shipped", "Just shipped (last cycle)"),
    "later": ("Later", "Deferred to next cycle", "Deferred / out of scope"),
}

TODO_SECTIONS = ("Now", "Next", "Done", "Later")


def normalize_for_match(text: str) -> str:
    out = (text or "").lower()
    out = re.sub(r"[`*_'\"]+", "", out)
    out = re.sub(r"\s+\(from [^)]+\)\s*$", "", out)
    out = re.sub(r"\s+Reason:\s+.+$", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\s+--\s+by HME todo #\d+.*$", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\s+", " ", out).strip()
    return out[:-1] if out.endswith(".") else out


def common_prefix_len(a: str, b: str) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def _read_section(md_text: str, key: str) -> list[str]:
    aliases = SECTION_ALIASES.get(key, (key,))
    lines = md_text.splitlines()
    out: list[str] = []
    in_section = False
    for line in lines:
        if line.startswith("## "):
            if in_section:
                break
            if line.strip()[3:].strip() in aliases:
                in_section = True
                continue
        if in_section:
            if line.startswith("---"):
                break
            out.append(line)
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return out


def section_headers(md_text: str) -> list[str]:
    return [line.strip()[3:].strip() for line in md_text.splitlines() if line.startswith("## ")]


def matches_todo_text(left: str, right: str) -> bool:
    a = normalize_for_match(left)
    b = normalize_for_match(right)
    if not a or not b:
        return False
    if a == b or a.startswith(b) or b.startswith(a):
        return True
    return common_prefix_len(a, b) >= 30


def task_items(md_text: str, *, sections: tuple[str, ...] | None = None) -> list[dict]:
    lines: list[str] = []
    if sections:
        for key in sections:
            lines.extend(_read_section(md_text, key))
    else:
        lines = md_text.splitlines()
    out: list[dict] = []
    for raw in lines:
        m = TASK_RE.match(raw)
        if m:
            out.append({
                "line": raw,
                "tier": normalize_tier(m.group("tier")),
                "text": m.group("text").strip(),
                "done": m.group("mark").lower() == "x",
            })
            continue
        q = QUEUE_RE.match(raw)
        if q:
            text = q.group("text").strip()
            reason = (q.group("reason") or "").strip()
            out.append({
                "line": raw,
                "tier": normalize_tier(q.group("tier")),
                "text": text,
                "reason": reason,
                "done": False,
            })
    return out


def open_task_pairs(md_text: str) -> list[tuple[str, str]]:
    return [(it["tier"], it["text"]) for it in task_items(md_text, sections=("now", "next")) if not it["done"]]


def completion_state(md_text: str) -> dict:
    items = task_items(md_text)
    open_items = [it for it in items if not it["done"]]
    return {
        "complete": bool(items) and not open_items,
        "total": len(items),
        "open": len(open_items),
    }


def render_todo_md(todos: list, previous_md: str | None = None, done_limit: int = 10) -> str:
    """Render via the canonical todo_store renderer (legacy signature kept).

    The done_limit and previous_md args are accepted but ignored — the
    store is the markdown file, so rendering is idempotent over the full
    set rather than a windowed view.
    """
    meta = {"max_id": max((int(t.get("id", 0) or 0) for t in todos if isinstance(t, dict)), default=0)}
    return _render_md(meta, todos)


def sync_todo_md(todos: list, *, done_limit: int = 10) -> None:
    """No-op: TODO.md IS the store. Mutations already touched the file.

    Kept as a public symbol so legacy callers don't break.
    """


def repair_todo_md_from_store(*, done_limit: int = 10, write: bool = True) -> dict:
    raw, meta, todos = load_store()
    if write:
        save_todos(meta, todos)
    return {
        "changed": False,
        "path": _todo_md_file(),
        "sections": list(TODO_SECTIONS),
        "todo_count": len(todos),
    }


def write_blank_todo_md() -> None:
    save_todos({"max_id": 0}, [])


def mark_matching_done(entry: dict) -> tuple[str, str]:
    """Mark the first store entry whose text matches `entry['text']` as done.

    Returns (text_of_matched_entry, "") for back-compat with the previous
    (text, line) shape — the rendered line no longer round-trips meaningfully.
    """
    target = normalize_for_match(entry.get("text", ""))
    if not target:
        return "", ""
    matched: list[str] = []

    def _mark(_meta: dict, todos: list[dict], _raw: list[dict]) -> tuple[bool, bool]:
        for e in flat_entries(todos):
            if e.get("done") or e.get("status") == "completed":
                continue
            if matches_todo_text(target, e.get("text", "")):
                e["status"] = "completed"
                e["done"] = True
                matched.append(e.get("text", ""))
                return True, True
        return False, False

    mutate_store(_mark)
    if matched:
        return matched[0], ""
    return "", ""


def mark_store_done_by_texts(items: list[str], *, store_path: str | None = None) -> int:
    if not items:
        return 0

    def _mark(_meta: dict, todos: list[dict], _raw: list[dict]) -> tuple[bool, int]:
        changed = 0
        for entry in flat_entries(todos):
            if entry.get("done") or entry.get("status") == "completed":
                continue
            if any(matches_todo_text(item, entry.get("text", "")) for item in items):
                entry["status"] = "completed"
                entry["done"] = True
                changed += 1
        return bool(changed), changed

    return int(mutate_store(_mark, store_path))


def ingest_open_items(items: list[tuple[str, str]], *, store_path: str | None = None) -> int:
    """Promote a list of (tier, text) pairs into pending todos under source=todo_md."""
    if not items:
        return 0
    import time

    def _ingest(meta: dict, todos: list[dict], _raw: list[dict]) -> tuple[bool, int]:
        open_existing = [
            entry for entry in flat_entries(todos)
            if not entry.get("done") and entry.get("status") != "completed"
        ]
        added = 0
        for tier, text in items:
            if any(matches_todo_text(text, entry.get("text", "")) for entry in open_existing):
                continue
            meta["max_id"] = int(meta.get("max_id", 0)) + 1
            entry = {
                "id": meta["max_id"],
                "text": text,
                "activeForm": text,
                "status": "pending",
                "done": False,
                "critical": False,
                "source": "todo_md",
                "on_done": "",
                "ts": time.time(),
                "parent_id": 0,
                "subs": [],
                "tier": normalize_tier(tier),
            }
            todos.append(entry)
            open_existing.append(entry)
            added += 1
        return bool(added), added

    return int(mutate_store(_ingest, store_path))
