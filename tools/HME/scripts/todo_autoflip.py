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
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_SERVICE = _PROJECT / "tools" / "HME" / "service"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))
from server.tools_analysis.todo_md_sync import (  # noqa: E402
    ingest_open_items,
    mark_store_done_by_texts,
    open_task_pairs,
)

_TODO = _PROJECT / "doc" / "templates" / "TODO.md"

_FLIPPED_RE = re.compile(r"^\s*-\s+\[x\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                         re.IGNORECASE)
_OPEN_RE = re.compile(r"^\s*-\s+\[\s\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                      re.IGNORECASE)

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
    return open_task_pairs(_TODO.read_text(encoding="utf-8"))


def main() -> int:
    try:
        items = _newly_flipped()
        open_items = _open_items()
        changed = mark_store_done_by_texts(items)
        added = ingest_open_items(open_items)
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
