#!/usr/bin/env python3
"""i/why mode=predict <file_path> — Horizon I seed.

Given a file path the agent is about to edit, predict which verifiers
have historically flipped when files in similar paths were edited.
First version: directory-level correlation over the last 200 timeseries
rows. Joins:
  - timeseries (per-row verifier statuses, ~544 rows)
  - activity log file_written events (~6792 events with timestamps)

Algorithm:
  1. Walk timeseries, detect status flips per verifier per row.
  2. For each flip event, look back N seconds in the activity log,
     collect the directories of file_written events.
  3. Aggregate: directory → verifier → flip-correlation count.
  4. Given a query path, look up its directory and report:
     "verifiers that have flipped within 1h of edits to this dir"

Honest about limitations:
  - Correlation ≠ causation; many verifiers have very few flips.
  - The activity log's tool_call instrumentation is degraded
    (a known regression); fs_watcher file_written carries us.
  - First version is path-prefix only; richer features (file-shape
    similarity, AST diff signatures) come later.
"""
from __future__ import annotations
import json
import os
import sys
import time
from collections import defaultdict

from _common import PROJECT_ROOT


def _load_timeseries():
    p = os.path.join(PROJECT_ROOT, "output", "metrics",
                     "hme-coherence-timeseries.jsonl")
    if not os.path.isfile(p):
        return []
    rows = []
    with open(p) as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                rows.append(json.loads(ln))
            except ValueError:
                continue
    return rows


def _load_activity_files(window_back: int = 3600):
    """Returns list of (ts, dir) tuples for file_written events."""
    p = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if not os.path.isfile(p):
        return []
    out = []
    with open(p) as f:
        for ln in f:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if e.get("event") != "file_written":
                continue
            file = e.get("file", "")
            ts = e.get("ts", 0)
            if not file or not ts:
                continue
            d = os.path.dirname(file).replace(PROJECT_ROOT + "/", "")
            if d:
                out.append((ts, d))
    return out


def _build_correlation(rows, file_events):
    """For each verifier flip in the timeseries, attribute the
    directories most-recently edited in the prior 1h window. Returns
    {dir: {verifier: count}}."""
    correlation: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    prev_status: dict[str, str] = {}
    file_events.sort(key=lambda e: e[0])
    for row in rows[-200:]:
        row_ts = row.get("ts", 0)
        if not row_ts:
            continue
        # Find dirs edited in the 1h window before this row
        cutoff = row_ts - 3600
        recent_dirs = set()
        # Linear scan; could binary-search but inputs are small
        for ts, d in file_events:
            if cutoff <= ts <= row_ts:
                recent_dirs.add(d)
            elif ts > row_ts:
                break
        for name, info in row.get("probes", {}).items():
            if not isinstance(info, dict):
                continue
            cur = info.get("status", "?")
            prev = prev_status.get(name)
            if prev is not None and prev != cur:
                # Status flipped — credit each recent dir
                for d in recent_dirs:
                    correlation[d][name] += 1
            prev_status[name] = cur
    return correlation


def main(argv):
    query_path = ""
    for a in argv[1:]:
        if a.startswith("file=") or a.startswith("path="):
            query_path = a.split("=", 1)[1]
        elif not a.startswith("mode=") and not a.startswith("--"):
            query_path = a
    if not query_path:
        print("# i/why mode=predict <file_path>")
        print("Predicts which verifiers have flipped when files in")
        print("the same directory were edited recently.")
        print()
        print("Usage: i/why mode=predict src/conductor/foo.js")
        return 2

    rows = _load_timeseries()
    if not rows:
        print(f"# i/why mode=predict {query_path}")
        print("No timeseries data — predictions need history to learn from.")
        return 1
    file_events = _load_activity_files()
    correlation = _build_correlation(rows, file_events)

    # Look up the query path's directory; also walk parent dirs for fallback
    rel = query_path.replace(PROJECT_ROOT + "/", "")
    qd = os.path.dirname(rel)
    parents = [qd]
    while qd:
        qd = os.path.dirname(qd)
        if qd:
            parents.append(qd)

    print(f"# i/why mode=predict — {rel}")
    print(f"  query dir: {parents[0] or '(root)'}")
    print()

    # Find best matching directory in correlation table
    matched_dir = None
    matched_verifiers: dict[str, int] = {}
    for p in parents:
        if p in correlation:
            matched_dir = p
            matched_verifiers = dict(correlation[p])
            break

    if matched_dir is None:
        # Show what dirs DO have correlation data, as a fallback
        print(f"  No historical flips correlated with {parents[0] or 'this path'} or its parents.")
        if correlation:
            print()
            print("## Directories with historical flip-correlation:")
            ranked = sorted(correlation.items(),
                            key=lambda kv: -sum(kv[1].values()))
            for d, vmap in ranked[:8]:
                top_v = sorted(vmap.items(), key=lambda kv: -kv[1])[:2]
                top_s = ", ".join(f"{v}({c})" for v, c in top_v)
                print(f"  {d:32}  total flips correlated: {sum(vmap.values())}  · top: {top_s}")
        return 0

    print(f"## Verifiers correlated with edits to '{matched_dir}':")
    ranked = sorted(matched_verifiers.items(), key=lambda kv: -kv[1])
    for v, c in ranked[:10]:
        print(f"  {v:36}  {c} flip(s) within 1h of edits to this dir")
    print()
    print("# Note:")
    print("  Correlation, not causation. A verifier appearing here means")
    print("  it has flipped status during a 1h window after edits to this")
    print("  directory — could be coincidence, especially with low counts.")
    print("  Useful as a heads-up: 'when I edit here, verifier X tends to")
    print("  move' — verify the actual run() to know what it checks.")
    print()
    print("# Drill-in:")
    print("  i/why mode=verifier <name>     what does this verifier check?")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
