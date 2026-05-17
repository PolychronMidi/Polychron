"""Shared detector-stats emitter.

Single source of truth for HME detector-stats JSONL appends. Pre-extraction, 7 detector scripts duplicated this with subtle variance: psycho_stop carried fcntl.flock + 5000-line trim (concurrent-write safe), the other 6 used plain append (lossy under stop-chain parallelism). The shared version adopts the robust pattern so every detector inherits concurrent-safety.

Usage:
    from _detector_stats import emit_stats
    emit_stats("my_detector", "ok", "no_match")
"""
from __future__ import annotations

import fcntl
import json
import os
import sys
import time
from pathlib import Path


_MAX_LINES = 5000


def _resolve_project_root() -> str | None:
    root = os.environ.get("PROJECT_ROOT")
    if root:
        return root
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / "doc" / "templates" / "AGENTS.md").exists() and (parent / ".env").exists():
            return str(parent)
    return None


def emit_stats(detector: str, verdict: str, detail: str) -> None:
    """Append one line + LRU-trim to detector-stats.jsonl. Best-effort; failures log to stderr but never raise."""
    root = _resolve_project_root()
    if not root:
        return
    out_path = os.path.join(os.environ.get("HME_METRICS_DIR") or os.path.join(root, "tools", "HME", "runtime", "metrics"), "detector-stats.jsonl")
    try:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                f.write(json.dumps({
                    "ts": time.time(),
                    "detector": detector,
                    "verdict": verdict,
                    "detail": detail,
                }) + "\n")
                f.flush()
                try:
                    with open(out_path, "r", encoding="utf-8") as rf:
                        lines = rf.readlines()
                    if len(lines) > _MAX_LINES:
                        with open(out_path, "w", encoding="utf-8") as wf:
                            wf.writelines(lines[-_MAX_LINES:])
                except OSError as trim_err:
                    print(f"[detector_stats:{detector}] trim failed: "
                          f"{type(trim_err).__name__}: {trim_err}", file=sys.stderr)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except (OSError, TypeError, ValueError) as emit_err:
        print(f"[detector_stats:{detector}] emit failed: "
              f"{type(emit_err).__name__}: {emit_err}", file=sys.stderr)
