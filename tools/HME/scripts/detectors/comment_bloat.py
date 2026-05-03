#!/usr/bin/env python3
"""Per-turn wrapper around the existing scripts/audit-comment-bloat.py.

The project-level auditor scans all files and reports backlog. For Stop
hook gating we only care about THIS TURN's Edit/Write targets -- collect
those file paths, invoke the existing auditor with --files, fail if any
reach FAIL threshold (5+ contiguous comment lines).

Verdicts:
  ok            no fails introduced by this turn's edits
  comment_bloat at least one edited file has a 5+ line comment block
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import _parse_all, event_content, is_assistant  # noqa: E402


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
        for block in event_content(ev):
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("name") not in ("Edit", "Write"):
                continue
            inp = block.get("input") or {}
            fp = inp.get("file_path")
            if isinstance(fp, str) and fp:
                out.append(fp)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    project_root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_root:
        print("ok")
        return 0
    audit = os.path.join(project_root, "scripts", "audit-comment-bloat.py")
    if not os.path.isfile(audit):
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
    try:
        proc = subprocess.run(
            ["python3", audit, "--json", "--files", *files],
            capture_output=True, text=True, timeout=10,
        )
        data = json.loads(proc.stdout or "{}")
    except Exception:
        print("ok")
        return 0
    fails = data.get("fail") or []
    edited_set = {os.path.realpath(os.path.join(project_root, f)) if not os.path.isabs(f) else os.path.realpath(f) for f in files}
    for entry in fails:
        p = entry.get("path") or ""
        full = os.path.realpath(os.path.join(project_root, p)) if not os.path.isabs(p) else os.path.realpath(p)
        if full in edited_set:
            print("comment_bloat")
            return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
