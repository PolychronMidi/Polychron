#!/usr/bin/env python3
"""Sync direct TODO.md edits into the HME todo store.

Idempotent + safe-on-error: any exception falls through to no-op.

Usage: todo_autoflip.py  (reads PROJECT_ROOT from env)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path
import json

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_TODO = _PROJECT / "doc" / "templates" / "TODO.md"
_TODO_STORE = _PROJECT / "tools" / "HME" / "KB" / "todos.json"

_FLIPPED_RE = re.compile(r"^\s*-\s+\[x\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                         re.IGNORECASE)
_OPEN_RE = re.compile(r"^\s*-\s+\[\s\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                      re.IGNORECASE)
_LEGACY_TIER = {"EASY": "E2", "MEDIUM": "E3", "HARD": "E4"}


def _read_todo_at(ref: str) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(_PROJECT), "show", f"{ref}:doc/templates/TODO.md"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            return proc.stdout
    except (OSError, subprocess.SubprocessError):
        pass  # silent-ok: best-effort fs op
    return ""


def _read_head_todo() -> str:
    try:
        cur = _TODO.read_text(encoding="utf-8")
    except OSError:
        return _read_todo_at("HEAD")
    head = _read_todo_at("HEAD")
    if head and head == cur:
        prev = _read_todo_at("HEAD~1")
        if prev:
            return prev
    return head


def _items(text: str, regex: re.Pattern) -> set[str]:
    out = set()
    for line in text.splitlines():
        m = regex.match(line)
        if m:
            out.add(f"[{m.group(1)}] {m.group(2).strip()}")
    return out


def _newly_flipped() -> list[str]:
    if not _TODO.is_file():
        return []
    head = _read_head_todo()
    cur_text = _TODO.read_text(encoding="utf-8")
    cur_flipped = _items(cur_text, _FLIPPED_RE)
    if not head:
        return sorted(cur_flipped)
    head_open = _items(head, _OPEN_RE)
    head_flipped = _items(head, _FLIPPED_RE)
    transitioned = head_open & cur_flipped
    birth_as_shipped = cur_flipped - head_open - head_flipped
    return sorted(transitioned | birth_as_shipped)


def _open_items() -> list[tuple[str, str]]:
    if not _TODO.is_file():
        return []
    out = []
    for line in _TODO.read_text(encoding="utf-8").splitlines():
        m = _OPEN_RE.match(line)
        if m:
            out.append((m.group(1).upper(), m.group(2).strip()))
    return out


def _normalize(text: str) -> str:
    out = text.lower()
    out = re.sub(r"^\[(?:E[1-5]|easy|medium|hard)\]\s+", "", out, flags=re.IGNORECASE)
    out = re.sub(r"[`*_'\"]+", "", out)
    out = re.sub(r"\s+\(from spec.*?\)\s*$", "", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out[:-1] if out.endswith(".") else out


def _matches(a: str, b: str) -> bool:
    left = _normalize(a)
    right = _normalize(b)
    if not left or not right:
        return False
    if left == right or left.startswith(right) or right.startswith(left):
        return True
    n = min(len(left), len(right))
    i = 0
    while i < n and left[i] == right[i]:
        i += 1
    return i >= 30


def _mark_store_done(items: list[str]) -> int:
    if not items or not _TODO_STORE.is_file():
        return 0
    try:
        raw = json.loads(_TODO_STORE.read_text(encoding="utf-8"))
    except Exception as e:
        sys.stderr.write(f"[todo_autoflip] skipped done-sync; todo store read failed: {e}\n")
        return 0
    changed = 0
    todos = raw[1:] if raw and isinstance(raw[0], dict) and "_meta" in raw[0] else raw
    for entry in todos:
        stack = [entry] + list(entry.get("subs", []))
        for item in stack:
            if item.get("done") or item.get("status") == "completed":
                continue
            if any(_matches(todo_item, item.get("text", "")) for todo_item in items):
                item["status"] = "completed"
                item["done"] = True
                changed += 1
    if changed:
        _TODO_STORE.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
    return changed


def _default_store() -> list[dict]:
    return [{"id": 0, "_meta": {"max_id": 0, "updated_ts": time.time()}}]


def _store_parts() -> tuple[list[dict], dict, list[dict]]:
    if not _TODO_STORE.is_file():
        raw = _default_store()
    else:
        try:
            raw = json.loads(_TODO_STORE.read_text(encoding="utf-8"))
        except Exception as e:
            sys.stderr.write(f"[todo_autoflip] rebuilding unreadable todo store: {e}\n")
            raw = _default_store()
    if raw and isinstance(raw[0], dict) and raw[0].get("id") == 0 and "_meta" in raw[0]:
        return raw, raw[0]["_meta"], raw[1:]
    meta = {"max_id": max([int(t.get("id", 0)) for t in raw if isinstance(t, dict)] or [0]),
            "updated_ts": time.time()}
    header = {"id": 0, "_meta": meta}
    return [header] + raw, meta, raw


def _flat_entries(todos: list[dict]) -> list[dict]:
    out = []
    for entry in todos:
        out.append(entry)
        out.extend(entry.get("subs", []))
    return out


def _ingest_open_items(items: list[tuple[str, str]]) -> int:
    if not items:
        return 0
    raw, meta, todos = _store_parts()
    open_existing = [
        item for item in _flat_entries(todos)
        if not item.get("done") and item.get("status") != "completed"
    ]
    added = 0
    for tier, text in items:
        if any(_matches(text, item.get("text", "")) for item in open_existing):
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
            "tier": tier if re.match(r"^E[1-5]$", tier) else _LEGACY_TIER.get(tier, "E3"),
        }
        raw.append(entry)
        open_existing.append(entry)
        added += 1
    if added:
        meta["updated_ts"] = time.time()
        _TODO_STORE.parent.mkdir(parents=True, exist_ok=True)
        _TODO_STORE.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
    return added


def main() -> int:
    try:
        items = _newly_flipped()
        open_items = _open_items()
        changed = _mark_store_done(items)
        added = _ingest_open_items(open_items)
        if changed:
            sys.stderr.write(
                f"[todo_autoflip] marked {changed} HME todo item(s) done from TODO.md flips\n"
            )
        if added:
            sys.stderr.write(
                f"[todo_autoflip] added {added} TODO.md item(s) to HME todo store\n"
            )
    except Exception as e:
        sys.stderr.write(f"[todo_autoflip] silent-ok: {type(e).__name__}: {e}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
