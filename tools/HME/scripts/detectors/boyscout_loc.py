#!/usr/bin/env python3
"""Boyscout LOC enforcer (CLAUDE.md "Files MUST be <=350 LOC unless in
loc-ignore.txt"). Per-turn detector: any file Edited/Written this turn
must be <=350 LOC OR listed in config/loc-ignore.txt.

Verdicts:
  ok          all touched files within limit
  loc_bloat   at least one touched file >350 LOC and not exempt
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import _parse_all, event_content, is_assistant  # noqa: E402

LIMIT = 350


def _last_user_idx(events: list[dict]) -> int:
    last = -1
    for i, ev in enumerate(events):
        if ev.get("type") != "user":
            continue
        msg = ev.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            last = i
    return last


def _collect_edited_files(events: list[dict]) -> list[str]:
    out = []
    for ev in events:
        if not is_assistant(ev):
            continue
        for b in event_content(ev):
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            if b.get("name") not in ("Edit", "Write"):
                continue
            fp = (b.get("input") or {}).get("file_path")
            if isinstance(fp, str) and fp:
                out.append(fp)
    return out


def _load_ignore(project_root: str) -> set[str]:
    """Tiny loader; canonical loader lives in scripts/loc_ignore.py but
    is project-side. Inline here to avoid sys.path gymnastics."""
    ignore_path = os.path.join(project_root, "config", "loc-ignore.txt")
    if not os.path.isfile(ignore_path):
        return set()
    out = set()
    with open(ignore_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                out.add(line)
    return out


def _is_exempt(rel_path: str, patterns: set[str]) -> bool:
    import fnmatch
    for pat in patterns:
        if fnmatch.fnmatch(rel_path, pat):
            return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    project_root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_root:
        print("ok")
        return 0
    events = _parse_all(sys.argv[1])
    start = _last_user_idx(events)
    if start < 0:
        print("ok")
        return 0
    files = _collect_edited_files(events[start:])
    if not files:
        print("ok")
        return 0
    ignore = _load_ignore(project_root)
    for fp in files:
        full = fp if os.path.isabs(fp) else os.path.join(project_root, fp)
        rel = os.path.relpath(full, project_root) if full.startswith(project_root) else fp
        if _is_exempt(rel, ignore):
            continue
        try:
            with open(full) as f:
                n = sum(1 for _ in f)
        except OSError:
            continue
        if n > LIMIT:
            print("loc_bloat")
            return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
