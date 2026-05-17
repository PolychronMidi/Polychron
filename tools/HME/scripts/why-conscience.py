#!/usr/bin/env python3
"""i/why mode=conscience -- Horizon VIII seed (architectural conscience).

The user's verdicts ("legendary", "compelling", "surprising", "moving",
"flat", "mechanical", ...) live in tools/HME/runtime/metrics/hme-ground-truth.jsonl.
This seed turns those verdicts into queryable patterns:
  - Which file paths were edited in approved rounds vs neutral ones?
  - Which verifier statuses were prevalent at the moment of approval?
  - What characterized the approved-move signature?

The first version is descriptive -- it surfaces the historical signature
of approved/rejected moves. The full vision (Horizon VIII) layers in:
move-similarity scoring of new edits against the ledger, soft warnings
when a new edit shape resembles a rejected pattern.

Honest scope: with only 17 verdicts (mostly legendary, no rejections),
this seed reports the legendary-move signature only. Once flat/
mechanical verdicts accumulate, the discriminative version follows.
"""
from __future__ import annotations
import json
import os
import sys
from collections import Counter

from _common import PROJECT_ROOT


_POSITIVE = {"legendary", "compelling", "surprising", "moving"}
_NEGATIVE = {"flat", "mechanical", "boring", "broken"}


def _load_verdicts():
    p = os.path.join(PROJECT_ROOT, "src", "output", "metrics", "hme-ground-truth.jsonl")
    if not os.path.isfile(p):
        return []
    out = []
    with open(p) as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(json.loads(ln))
            except ValueError:
                continue
    return out


def _files_in_window(activity_path: str, ts_lo: float, ts_hi: float) -> list[str]:
    if not os.path.isfile(activity_path):
        return []
    out = []
    with open(activity_path) as f:
        for ln in f:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if e.get("event") != "file_written":
                continue
            ts = e.get("ts", 0)
            if ts_lo <= ts <= ts_hi:
                file = e.get("file", "")
                if file:
                    out.append(file)
    return out


def main(argv):
    verdicts = _load_verdicts()
    if not verdicts:
        print("# Architectural conscience (0 verdicts)")
        print("No ground-truth verdicts at tools/HME/runtime/metrics/hme-ground-truth.jsonl")
        return 0

    # Bucket by sentiment
    pos_verdicts = [v for v in verdicts if v.get("sentiment") in _POSITIVE]
    neg_verdicts = [v for v in verdicts if v.get("sentiment") in _NEGATIVE]
    other = [v for v in verdicts
             if v.get("sentiment") not in _POSITIVE | _NEGATIVE]

    print(f"# Architectural conscience ({len(verdicts)} verdicts)")
    print()
    print(f"  positive (legendary/compelling/surprising/moving): {len(pos_verdicts)}")
    print(f"  negative (flat/mechanical/boring/broken):          {len(neg_verdicts)}")
    if other:
        s_counter = Counter(v.get("sentiment", "?") for v in other)
        print(f"  other ({len(other)}): {dict(s_counter)}")
    print()

    # For each positive verdict, gather the files edited in the round-window
    def _coerce_ts(v):
        ts = v.get("ts", 0)
        if isinstance(ts, (int, float)):
            return float(ts)
        if isinstance(ts, str):
            try:
                return float(ts)
            except ValueError:
                return 0.0
        return 0.0

    activity = os.path.join(PROJECT_ROOT, "src", "output", "metrics", "hme-activity.jsonl")
    pos_dirs: Counter = Counter()
    pos_files: Counter = Counter()
    matched_verdicts = 0
    for v in pos_verdicts:
        ts = _coerce_ts(v)
        if ts == 0:
            continue
        files = _files_in_window(activity, ts - 3600, ts)
        if files:
            matched_verdicts += 1
        for f in files:
            rel = f.replace(PROJECT_ROOT + "/", "")
            d = os.path.dirname(rel)
            if d:
                pos_dirs[d] += 1
                pos_files[rel] += 1

    if pos_dirs:
        print(f"## Approved-move directory signature (top 10)")
        print(f"  ({matched_verdicts}/{len(pos_verdicts)} positive verdicts had "
              f"activity-log overlap; each looks back 1h for edits)")
        for d, c in pos_dirs.most_common(10):
            print(f"  {d:40}  {c} edits within 1h of approved verdict")
        print()
    elif pos_verdicts:
        print(f"## Approved-move directory signature")
        print(f"  ({matched_verdicts}/{len(pos_verdicts)} positive verdicts had "
              f"activity-log overlap)")
        print(f"  No file_written events found in 1h windows before any positive")
        print(f"  verdict -- likely the activity log doesn't go back to when the")
        print(f"  verdicts were recorded. Verdicts are ~7-10 days old; the log's")
        print(f"  retention may be shorter.")
        print()

    # If we have negative verdicts too, contrast -- which dirs appear in
    # negatives that are absent or rare in positives.
    if neg_verdicts:
        neg_dirs: Counter = Counter()
        for v in neg_verdicts:
            ts = _coerce_ts(v)
            if ts == 0:
                continue
            files = _files_in_window(activity, ts - 3600, ts)
            for f in files:
                d = os.path.dirname(f.replace(PROJECT_ROOT + "/", ""))
                if d:
                    neg_dirs[d] += 1
        if neg_dirs:
            print(f"## Rejected-move directory signature")
            for d, c in neg_dirs.most_common(8):
                pos_share = pos_dirs.get(d, 0)
                marker = " " if pos_share > 0 else "!"
                print(f"  {marker} {d:38}  {c} neg-edits  "
                      f"(vs {pos_share} pos-edits)")
            print()

    # Latest verdict context
    if verdicts:
        latest = verdicts[-1]
        print(f"## Latest verdict ({latest.get('round_tag', '?')})")
        print(f"  sentiment: {latest.get('sentiment', '?')}")
        print(f"  comment:   {str(latest.get('comment', ''))[:120]}")
        print()

    # Move-similarity scoring (Horizon VIII expansion). Compare recent
    if pos_dirs:
        recent_files = _files_in_window(activity, _coerce_ts(verdicts[-1]) - 3600,
                                        _coerce_ts(verdicts[-1]) + 7200) \
            if verdicts and _coerce_ts(verdicts[-1]) > 0 else []
        # Recent-file dirs (last 1h of activity log)
        try:
            with open(activity) as _af:
                _all = _af.readlines()[-200:]
            now_ts = max(
                (json.loads(ln).get("ts", 0)
                 for ln in _all if ln.strip()),
                default=0,
            )
        except (OSError, ValueError):
            now_ts = 0
        recent = _files_in_window(activity, now_ts - 3600, now_ts) if now_ts else []
        recent_dirs: Counter = Counter()
        for f in recent:
            d = os.path.dirname(f.replace(PROJECT_ROOT + "/", ""))
            if d:
                recent_dirs[d] += 1

        if recent_dirs:
            # Cosine-ish similarity: dot-product of normalized vectors.
            # Use union of dirs as the keyspace.
            all_dirs = set(pos_dirs.keys()) | set(recent_dirs.keys())
            pos_norm = (sum(c*c for c in pos_dirs.values())) ** 0.5 or 1
            recent_norm = (sum(c*c for c in recent_dirs.values())) ** 0.5 or 1
            dot = sum(pos_dirs.get(d, 0) * recent_dirs.get(d, 0) for d in all_dirs)
            similarity = dot / (pos_norm * recent_norm)
            # Threshold-warning (Horizon VIII asymptote): when similarity
            if similarity < 0.30:
                marker = "!"
                warn = "  [!] low similarity -- recent edits diverge from approved-move signature"
            elif similarity < 0.60:
                marker = "."
                warn = "  . partial similarity -- review unique-to-recent dirs below"
            else:
                marker = " "
                warn = ""
            print()
            print(f"## Move similarity -- recent edits vs approved-move signature")
            print(f" {marker} similarity score: {similarity:.2f}  (1.0 = identical signature, 0.0 = orthogonal)")
            if warn:
                print(warn)
            shared = [d for d in recent_dirs if d in pos_dirs]
            unique = [d for d in recent_dirs if d not in pos_dirs]
            if shared:
                print(f"  shared dirs ({len(shared)}):  " + ", ".join(shared[:5]))
            if unique:
                print(f"  unique-to-recent ({len(unique)}):  " + ", ".join(unique[:5]))
            print()

    print("# Note:")
    print("  Descriptive version of approved-signature + move-similarity.")
    print("  Discriminative version (vs rejected) needs flat/mechanical")
    print("  verdicts to learn from. Tag negatives via `i/learn")
    print("  action=ground_truth tags=[flat]` to build it.")
    print()
    print("# Drill-in:")
    print("  i/status mode=band-tuning      band proposal from same data")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
