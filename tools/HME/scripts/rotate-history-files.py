#!/usr/bin/env python3
"""Rotate high-volume HME history files to keep them tractable.

Without rotation, `tools/HME/runtime/metrics/hme-activity.jsonl` and similar
append-only JSONL grow unbounded. Every scan over them slows linearly.
This script rotates files exceeding a size or line-count cap by:

  1. Moving the head (oldest entries) into src/output/metrics/archive/.
  2. Keeping the most recent N entries in the live file.
  3. Atomic via temp-file + os.replace (project's data-integrity
     invariant -- `atomic-state-writes` verifier enforces this for
     state files; we follow the same pattern here).

Default policy:
  - hme-activity.jsonl: keep last 5000 lines (currently grows to
    10k+ lines per active week)
  - hme-coherence-timeseries.jsonl: keep last 500 (~=30 days at
    typical pipeline cadence)
  - hme-fractal-history.jsonl: keep last 200
  - hme-holograph-history.jsonl: keep last 200

Invocation:
  python3 tools/HME/scripts/rotate-history-files.py            # default policy
  python3 tools/HME/scripts/rotate-history-files.py --dry-run  # report only
"""
from __future__ import annotations
import os
import sys
import time
from datetime import datetime

from _common import PROJECT_ROOT


POLICY = {
    "tools/HME/runtime/metrics/hme-activity.jsonl":            5000,
    "tools/HME/runtime/metrics/hme-coherence-timeseries.jsonl": 500,
    "tools/HME/runtime/metrics/hme-fractal-history.jsonl":      200,
    "tools/HME/runtime/metrics/hme-holograph-history.jsonl":    200,
}


def _rotate(rel_path: str, keep: int, dry_run: bool) -> dict:
    abs_path = os.path.join(PROJECT_ROOT, rel_path)
    if not os.path.isfile(abs_path):
        return {"path": rel_path, "status": "missing", "lines_before": 0,
                "lines_after": 0, "archived": 0}
    try:
        with open(abs_path) as f:
            lines = f.readlines()
    except OSError as e:
        return {"path": rel_path, "status": f"read failed: {e}",
                "lines_before": 0, "lines_after": 0, "archived": 0}
    n = len(lines)
    if n <= keep:
        return {"path": rel_path, "status": "under cap",
                "lines_before": n, "lines_after": n, "archived": 0}
    head = lines[:n - keep]
    tail = lines[n - keep:]
    if dry_run:
        return {"path": rel_path, "status": "would-rotate",
                "lines_before": n, "lines_after": keep, "archived": len(head)}
    # Archive the head
    archive_dir = os.path.join(PROJECT_ROOT, "src", "output", "metrics", "archive")
    try:
        os.makedirs(archive_dir, exist_ok=True)
    except OSError as e:
        return {"path": rel_path, "status": f"archive mkdir failed: {e}",
                "lines_before": n, "lines_after": n, "archived": 0}
    base = os.path.basename(rel_path)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_path = os.path.join(archive_dir, f"{base}.{stamp}.archive")
    archive_tmp = archive_path + ".tmp"
    try:
        with open(archive_tmp, "w") as af:
            af.writelines(head)
        os.replace(archive_tmp, archive_path)
    except OSError as e:
        return {"path": rel_path, "status": f"archive write failed: {e}",
                "lines_before": n, "lines_after": n, "archived": 0}
    # Atomically replace live file with the tail
    live_tmp = abs_path + ".tmp"
    try:
        with open(live_tmp, "w") as lf:
            lf.writelines(tail)
        os.replace(live_tmp, abs_path)
    except OSError as e:
        return {"path": rel_path, "status": f"live rewrite failed: {e}",
                "lines_before": n, "lines_after": n, "archived": 0}
    return {"path": rel_path, "status": "rotated",
            "lines_before": n, "lines_after": keep,
            "archived": len(head),
            "archive_file": os.path.relpath(archive_path, PROJECT_ROOT)}


def main(argv):
    dry_run = any(a in ("--dry-run", "dry_run=true") for a in argv[1:])
    print("# HME history rotation" + ("  (dry-run)" if dry_run else ""))
    print()
    print(f"  {'file':50}  {'before':>8}  {'after':>8}  {'archived':>9}  status")
    total_archived = 0
    for rel_path, keep in POLICY.items():
        result = _rotate(rel_path, keep, dry_run)
        before = result["lines_before"]
        after = result["lines_after"]
        archived = result["archived"]
        total_archived += archived
        print(f"  {rel_path:50}  {before:>8}  {after:>8}  {archived:>9}  {result['status']}")
    print()
    if total_archived > 0 and not dry_run:
        print(f"  Total {total_archived} line(s) archived to src/output/metrics/archive/")
    elif total_archived > 0 and dry_run:
        print(f"  Would archive {total_archived} line(s) (no changes made -- dry run)")
    else:
        print(f"  All files under cap; nothing rotated.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
