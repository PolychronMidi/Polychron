"""TODO.md sync for the HME todo store."""
from __future__ import annotations

import os
import re
import sys
import time

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from paths import todo_file as _todo_md_file  # noqa: E402
from .todo_store import flat_entries, load_store, save_store  # noqa: E402

TASK_RE = re.compile(
    r"^(?P<indent>\s*)-\s+\[(?P<mark>[ xX])\]\s+\[(?P<tier>E[1-5]|easy|medium|hard)\]\s+(?P<text>.+?)\s*$",
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

_LEGACY_TIER_MAP = {"easy": "E2", "medium": "E3", "hard": "E4"}
TODO_SECTIONS = ("Now", "Next", "Done", "Later")


def normalize_tier(tier: str | None) -> str:
    t = (tier or "").strip()
    if t.upper() in {"E1", "E2", "E3", "E4", "E5"}:
        return t.upper()
    return _LEGACY_TIER_MAP.get(t.lower(), "E3")


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


def _keep_manual_later(previous_md: str | None) -> list[str]:
    if not previous_md:
        return []
    return [ln for ln in _read_section(previous_md, "later") if ln.strip() and ln.strip() != "(empty)"]


def _entry_line(entry: dict, *, mark: str, indent: str = "") -> str:
    text = (entry.get("text") or "").strip()
    tier = normalize_tier(entry.get("tier"))
    return f"{indent}- [{mark}] [{tier}] {text}"


def _status(entry: dict) -> str:
    if entry.get("done") or entry.get("status") == "completed":
        return "completed"
    return entry.get("status") or "pending"


def _split_todo_lines(todos: list, done_limit: int) -> tuple[list[str], list[str], list[str]]:
    now: list[str] = []
    next_up: list[str] = []
    done: list[str] = []
    for entry in sorted([t for t in todos if isinstance(t, dict)], key=lambda t: int(t.get("id", 0))):
        status = _status(entry)
        if status == "completed":
            done.append(_entry_line(entry, mark="x"))
        elif status == "in_progress":
            now.append(_entry_line(entry, mark=" "))
        else:
            next_up.append(_entry_line(entry, mark=" "))
        for sub in sorted(entry.get("subs", []), key=lambda s: int(s.get("id", 0))):
            sub_status = _status(sub)
            if sub_status == "completed":
                done.append(_entry_line(sub, mark="x", indent="  "))
            elif sub_status == "in_progress":
                now.append(_entry_line(sub, mark=" ", indent="  "))
            else:
                next_up.append(_entry_line(sub, mark=" ", indent="  "))
    return now, next_up, done[:done_limit]


def _section(title: str, lines: list[str]) -> list[str]:
    body = lines if lines else ["(empty)"]
    return [f"## {title}", "", *body, ""]


def render_todo_md(todos: list, previous_md: str | None = None, done_limit: int = 10) -> str:
    now, next_up, done = _split_todo_lines(todos, done_limit)
    later = _keep_manual_later(previous_md)
    parts = [
        "# TODO",
        "",
        "> Pocket notepad. Native TodoWrite syncs this file. Use `[E1]`-`[E5]` on task lines.",
        "",
        *_section("Now", now),
        *_section("Next", next_up),
        *_section("Done", done),
        *_section("Later", later),
    ]
    return "\n".join(parts).rstrip() + "\n"


def sync_todo_md(todos: list, *, done_limit: int = 10) -> None:
    path = _todo_md_file()
    previous = ""
    try:
        with open(path, encoding="utf-8") as f:
            previous = f.read()
    except FileNotFoundError:
        pass
    rendered = render_todo_md(todos, previous_md=previous, done_limit=done_limit)
    if rendered == previous:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(rendered)
    os.replace(tmp, path)


def repair_todo_md_from_store(*, done_limit: int = 10, write: bool = True) -> dict:
    _raw, _meta, todos = load_store()
    path = _todo_md_file()
    previous = ""
    try:
        with open(path, encoding="utf-8") as f:
            previous = f.read()
    except FileNotFoundError:
        pass
    rendered = render_todo_md(todos, previous_md=previous, done_limit=done_limit)
    changed = rendered != previous
    if changed and write:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(rendered)
        os.replace(tmp, path)
    return {
        "changed": changed,
        "path": path,
        "sections": section_headers(rendered),
        "todo_count": len(todos),
    }


def write_blank_todo_md() -> None:
    path = _todo_md_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rendered = render_todo_md([])
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(rendered)
    os.replace(tmp, path)


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


def mark_matching_done(entry: dict) -> tuple[str, str]:
    path = _todo_md_file()
    if not os.path.exists(path):
        return "", ""
    with open(path, encoding="utf-8") as f:
        md = f.read()
    target = normalize_for_match(entry.get("text", ""))
    if not target:
        return "", ""
    lines = md.splitlines()
    candidates: list[tuple[int, int, re.Match]] = []
    for idx, line in enumerate(lines):
        m = TASK_RE.match(line)
        if not m or m.group("mark").lower() == "x":
            continue
        candidate = normalize_for_match(m.group("text"))
        score = common_prefix_len(candidate, target)
        if score >= 30 or candidate == target or candidate.startswith(target) or target.startswith(candidate):
            candidates.append((score, idx, m))
    if not candidates:
        return "", ""
    _score, idx, m = sorted(candidates, key=lambda item: -item[0])[0]
    lines[idx] = f"{m.group('indent')}- [x] [{normalize_tier(m.group('tier'))}] {m.group('text')}"
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + ("\n" if md.endswith("\n") else ""))
    return m.group("text").strip(), lines[idx]


def matches_todo_text(left: str, right: str) -> bool:
    a = normalize_for_match(left)
    b = normalize_for_match(right)
    if not a or not b:
        return False
    if a == b or a.startswith(b) or b.startswith(a):
        return True
    return common_prefix_len(a, b) >= 30


def mark_store_done_by_texts(items: list[str], *, store_path: str | None = None) -> int:
    if not items:
        return 0
    raw, meta, todos = load_store(store_path)
    changed = 0
    for entry in flat_entries(todos):
        if entry.get("done") or entry.get("status") == "completed":
            continue
        if any(matches_todo_text(item, entry.get("text", "")) for item in items):
            entry["status"] = "completed"
            entry["done"] = True
            changed += 1
    if changed:
        save_store(raw, meta, store_path)
    return changed


def ingest_open_items(items: list[tuple[str, str]], *, store_path: str | None = None) -> int:
    if not items:
        return 0
    raw, meta, todos = load_store(store_path)
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
        raw.append(entry)
        open_existing.append(entry)
        added += 1
    if added:
        save_store(raw, meta, store_path)
    return added
