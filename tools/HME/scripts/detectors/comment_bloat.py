#!/usr/bin/env python3
"""Per-turn wrapper around the existing tools/HME/scripts/audit-comment-bloat.py.

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
    # Pre-existing blocks aren't churn-worthy: pre-write hook already blocks new
    # bloat at COMMENT_BLOAT_WARN+. Only fire if HEAD has fewer FAIL blocks than now.
    baseline_fail_paths = _baseline_fail_paths(project_root, files, audit)
    current_fail_paths = {
        os.path.realpath(os.path.join(project_root, e.get("path") or ""))
        for e in fails
        if (e.get("path") or "")
    }
    new_fail_paths = current_fail_paths - baseline_fail_paths
    for full in new_fail_paths:
        if full in edited_set:
            print("comment_bloat")
            return 0
    print("ok")
    return 0


def _baseline_fail_paths(project_root: str, files: list[str], audit: str) -> set[str]:
    """Return realpaths whose HEAD version already has FAIL-level blocks.
    Lets the Stop-level detector ignore pre-existing bloat in edited files."""
    out: set[str] = set()
    import tempfile
    for f in files:
        rel = f if not os.path.isabs(f) else os.path.relpath(f, project_root)
        try:
            head_blob = subprocess.run(
                ["git", "-C", project_root, "show", f"HEAD:{rel}"],
                capture_output=True, text=True, timeout=5,
            )
            if head_blob.returncode != 0:
                continue
            with tempfile.NamedTemporaryFile("w", suffix=os.path.splitext(rel)[1], delete=False) as tmp:
                tmp.write(head_blob.stdout)
                tmp_path = tmp.name
            try:
                proc = subprocess.run(
                    ["python3", audit, "--json", "--files", tmp_path],
                    capture_output=True, text=True, timeout=10,
                )
                data = json.loads(proc.stdout or "{}")
                if data.get("fail"):
                    out.add(os.path.realpath(os.path.join(project_root, rel)))
            finally:
                try: os.unlink(tmp_path)
                except OSError: pass
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            continue
    return out


if __name__ == "__main__":
    sys.exit(main())
