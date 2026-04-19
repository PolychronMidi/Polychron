#!/usr/bin/env python3
"""Archive stale activity events so downstream slicers stop tripping over
pre-pipeline-era chat-turn round_complete markers and other historical noise.

Strategy: events older than HME_ACTIVITY_KEEP_DAYS (default 14) go into
metrics/hme-activity-archive.jsonl. The live file keeps everything more
recent, ensuring sliders see clean boundaries without losing provenance.

Runs idempotently — on re-invocation, only events newer than the archive's
tail survive-check get moved. Never deletes events; moves them.
"""
from __future__ import annotations

import json
import os
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
ACTIVITY = os.path.join(PROJECT_ROOT, "metrics", "hme-activity.jsonl")
ARCHIVE = os.path.join(PROJECT_ROOT, "metrics", "hme-activity-archive.jsonl")
KEEP_DAYS = float(os.environ.get("HME_ACTIVITY_KEEP_DAYS", "14"))


def main() -> int:
    if not os.path.isfile(ACTIVITY):
        print("archive-activity: no activity log yet — nothing to archive")
        return 0
    cutoff = time.time() - (KEEP_DAYS * 86400)
    keep: list[str] = []
    archive: list[str] = []
    with open(ACTIVITY, encoding="utf-8") as f:
        for line in f:
            s = line.rstrip("\n")
            if not s.strip():
                continue
            try:
                e = json.loads(s)
            except ValueError:
                # Corrupt line — keep in live file so it's visible
                keep.append(s)
                continue
            ts = e.get("ts", 0)
            if ts and ts < cutoff:
                archive.append(s)
            else:
                keep.append(s)

    if not archive:
        print(
            f"archive-activity: no events older than {KEEP_DAYS:.0f}d "
            f"({len(keep)} events kept)"
        )
        return 0

    # Append to archive (preserves any prior archive generations)
    with open(ARCHIVE, "a", encoding="utf-8") as af:
        af.write("\n".join(archive) + "\n")

    # Atomic rewrite of live file
    tmp_path = ACTIVITY + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as kf:
        kf.write("\n".join(keep) + ("\n" if keep else ""))
    os.replace(tmp_path, ACTIVITY)

    print(
        f"archive-activity: moved {len(archive)} event(s) to "
        f"metrics/hme-activity-archive.jsonl ({len(keep)} kept)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
