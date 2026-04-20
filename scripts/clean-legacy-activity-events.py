#!/usr/bin/env python3
"""One-time cleanup: filter hme-activity.jsonl to remove legacy file_written
events missing the 'source' field AND older than 24h.

Rationale (R17 #5):
  The `source` field was added to file_written events in R09. Events predating
  that emit without it. The `file-written-has-source-majority` invariant checks
  recent (24h) events — legacy entries in that window cause it to fail despite
  the underlying emitters being correct.

Safe because:
  - Only touches events OLDER than 24h (recent events are authoritative)
  - Only removes file_written events (not other event types)
  - Only removes events LACKING the source field
  - Writes to a tmp file first, then atomically replaces

Usage:
  python3 scripts/clean-legacy-activity-events.py [--dry-run]
"""
from __future__ import annotations
import json
import os
import sys
import tempfile
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ACTIVITY = os.path.join(PROJECT_ROOT, "metrics", "hme-activity.jsonl")
CUTOFF_SECS = 86400  # events older than 24h lacking source are legacy


def main():
    dry_run = "--dry-run" in sys.argv
    if not os.path.isfile(ACTIVITY):
        print(f"clean-legacy-activity: {ACTIVITY} missing — nothing to do")
        return 0

    cutoff = time.time() - CUTOFF_SECS
    kept = []
    dropped = 0
    total = 0

    with open(ACTIVITY, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            total += 1
            try:
                e = json.loads(s)
            except Exception:
                kept.append(line)  # preserve malformed lines — not our job to delete
                continue
            is_legacy_fw = (
                e.get("event") == "file_written"
                and not e.get("source")
                and e.get("ts", 0) < cutoff
            )
            if is_legacy_fw:
                dropped += 1
                continue
            kept.append(line)

    print(f"clean-legacy-activity: {dropped}/{total} legacy file_written events would be removed")
    if dry_run:
        return 0
    if dropped == 0:
        print("clean-legacy-activity: nothing to clean")
        return 0

    # Atomic replace
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(ACTIVITY), prefix=".hme-activity-", suffix=".tmp"
    )
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as tf:
            tf.writelines(kept)
        os.replace(tmp_path, ACTIVITY)
    except Exception:
        if os.path.isfile(tmp_path):
            os.unlink(tmp_path)
        raise
    print(f"clean-legacy-activity: {dropped} events removed, {len(kept)} kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
