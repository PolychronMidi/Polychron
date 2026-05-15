#!/usr/bin/env python3
"""Detects deletion-without-cleanup. Walks this turn's bash `rm` calls; for
each deleted file, greps the codebase for remaining import/require/source
references. Prevents the bug class where a file is deleted but other code
still refers to it (broken import, dead require path, stale doc link).

Verdicts:
  ok                no orphaned refs OR no deletions this turn
  orphan_reference  >=1 deleted file still referenced in source
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import _parse_all, event_content, is_assistant  # noqa: E402

_RM_RE = re.compile(r"\brm\s+(?:-\w+\s+)*([^\s|;&]+(?:\s+[^\s|;&-]+)*)")
_REF_EXTENSIONS = ('.js', '.ts', '.py', '.sh', '.json', '.md')


def _last_user_idx(events: list[dict]) -> int:
    last = -1
    for i, ev in enumerate(events):
        if ev.get("type") != "user":
            continue
        msg = ev.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            last = i
    return last


def _collect_deleted_files(events: list[dict], project_root: str) -> list[str]:
    skip_prefixes = (
        "/tmp/", "/var/tmp/",
        os.path.join(project_root, "tmp") + os.sep,
        os.path.join(project_root, "runtime") + os.sep,
        os.path.join(project_root, "output", "metrics") + os.sep,
    )
    out = []
    for ev in events:
        if not is_assistant(ev):
            continue
        for block in event_content(ev):
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("name") != "Bash":
                continue
            cmd = (block.get("input") or {}).get("command", "") or ""
            for m in _RM_RE.finditer(cmd):
                for tok in m.group(1).split():
                    if not tok or tok.startswith('-'):
                        continue
                    if tok.endswith(_REF_EXTENSIONS):
                        full = tok if os.path.isabs(tok) else os.path.join(project_root, tok)
                        if any(full.startswith(p) for p in skip_prefixes):
                            continue
                        if not os.path.exists(full):
                            out.append(full)
    return out


def _refs_remaining(project_root: str, deleted_path: str) -> list[str]:
    base = os.path.basename(deleted_path)
    stem = os.path.splitext(base)[0]
    bare = stem.lstrip("_")
    if not bare or len(bare) < 6:
        return []
    proc = subprocess.run(
        ["grep", "-rln", "--include=*.js", "--include=*.ts", "--include=*.py",
         "--include=*.sh", "--include=*.json", "--include=*.md", stem,
         os.path.join(project_root, "tools"),
         os.path.join(project_root, "scripts"),
         os.path.join(project_root, "src"),
         os.path.join(project_root, "doc")],
        capture_output=True, text=True, timeout=10,
    )
    hits = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]
    skip = ('/polychron-references/', '/tmp/', '/runtime/', '/output/metrics/',
            '/.git/', '/__pycache__/', '/node_modules/')
    return [h for h in hits if not any(s in h for s in skip)]


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
    deleted = _collect_deleted_files(events[start:], project_root)
    if not deleted:
        print("ok")
        return 0
    for fp in deleted:
        refs = _refs_remaining(project_root, fp)
        if refs:
            print("orphan_reference")
            return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
