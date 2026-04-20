#!/usr/bin/env python3
"""One-shot: backfill metrics/hme-legendary-states.jsonl from existing
legacy-override-history.jsonl so Arc III's envelope is computable immediately
without waiting 4-5 pipeline rounds.

Each R11+ pipeline round already produced a legacy-override-history row with
per_axis_adj, smoothed_shares, fires, entries, beat_count, sha, ts. We lift
those into snapshot form (matching compute-legendary-drift.py schema) and
prepend to legendary-states.jsonl if we find no overlap.

Safe: only prepends (doesn't touch rows already in legendary-states.jsonl).
Idempotent: matches on (ts, sha) to skip duplicates.
"""
from __future__ import annotations
import json
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
HIST = os.path.join(PROJECT_ROOT, "metrics", "legacy-override-history.jsonl")
SNAPS = os.path.join(PROJECT_ROOT, "metrics", "hme-legendary-states.jsonl")


def _load_jsonl(path):
    if not os.path.isfile(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                out.append(json.loads(s))
            except Exception:
                continue
    return out


def main():
    hist = _load_jsonl(HIST)
    if not hist:
        print("backfill: legacy-override-history.jsonl missing or empty")
        return 0

    existing = _load_jsonl(SNAPS)
    existing_keys = {(s.get("ts"), s.get("sha")) for s in existing}

    added = []
    for row in hist:
        key = (row.get("ts"), row.get("sha"))
        if key in existing_keys:
            continue
        snap = {
            "ts": row.get("ts"),
            "sha": row.get("sha"),
            "tree_hash": None,
            "hci": None,
            "hci_delta": None,
            "consensus_mean": None,
            "consensus_stdev": None,
            "axis_rebalance_cost": None,
            "per_axis_adj": row.get("per_axis_adj") or {},
            "smoothed_shares": row.get("smoothed_shares") or {},
            "fires": row.get("fires") or {},
            "entries": row.get("entries") or {},
            "prediction_recall": None,
            "prediction_accuracy": None,
            "_source": "backfill_from_legacy_override_history",
        }
        added.append(snap)

    if not added:
        print("backfill: nothing to add (all history rows already snapshotted)")
        return 0

    # Prepend: read existing, write added + existing
    merged = added + existing
    # Sort by ts to keep chronological order
    merged.sort(key=lambda s: s.get("ts") or "")
    with open(SNAPS, "w", encoding="utf-8") as f:
        for s in merged:
            f.write(json.dumps(s) + "\n")
    print(f"backfill: added {len(added)} historical snapshots, "
          f"total now {len(merged)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
