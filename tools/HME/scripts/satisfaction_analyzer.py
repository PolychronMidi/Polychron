#!/usr/bin/env python3
"""SatisfactionAnalyzer -- aggregator for satisfaction_capture.py output.

Reads src/output/metrics/satisfaction.jsonl (one entry per turn, never null
per the PAI rule) and reports rolling-window trends:

  - mean / median over recent N turns
  - bucket distribution (strong-pos / mild-pos / neutral / correction /
    strong-neg / explicit-numeric / empty)
  - drift: recent-window mean vs. all-time mean
  - flag turns with extreme scores (1-2 or 9-10) as notable

Pairs with audit_detectors.py's drift mode: same diagnostic posture, but
operates on user satisfaction signal rather than detector verdicts.

Usage:
    python3 tools/HME/scripts/satisfaction_analyzer.py
    python3 tools/HME/scripts/satisfaction_analyzer.py --window 50
    python3 tools/HME/scripts/satisfaction_analyzer.py --json
    python3 tools/HME/scripts/satisfaction_analyzer.py --notable-only
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from collections import Counter
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent)
_METRICS_DIR = Path(os.environ.get("METRICS_DIR") or (_PROJECT / "src" / "output" / "metrics"))
_IN_FILE = _METRICS_DIR / "satisfaction.jsonl"


def _load() -> list[dict]:
    if not _IN_FILE.is_file():
        return []
    out = []
    with open(_IN_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _bucket(signal: str) -> str:
    if signal.startswith("strong_pos"):
        return "strong_pos"
    if signal.startswith("mild_pos"):
        return "mild_pos"
    if signal.startswith("strong_neg"):
        return "strong_neg"
    if signal.startswith("correction"):
        return "correction"
    if signal == "explicit_numeric":
        return "explicit_numeric"
    if signal == "empty":
        return "empty"
    return "neutral"


def _summarize(events: list[dict], window: int) -> dict:
    if not events:
        return {"count": 0}
    scores_all = [e["score"] for e in events if isinstance(e.get("score"), int)]
    recent = events[-window:] if len(events) > window else events
    scores_rec = [e["score"] for e in recent if isinstance(e.get("score"), int)]
    buckets_all = Counter(_bucket(e.get("signal_type", "")) for e in events)
    buckets_rec = Counter(_bucket(e.get("signal_type", "")) for e in recent)
    notable = [
        e for e in events
        if isinstance(e.get("score"), int) and (e["score"] <= 2 or e["score"] >= 9)
    ]
    return {
        "count": len(events),
        "window_size": len(recent),
        "mean_all": round(statistics.mean(scores_all), 2) if scores_all else None,
        "mean_recent": round(statistics.mean(scores_rec), 2) if scores_rec else None,
        "median_all": statistics.median(scores_all) if scores_all else None,
        "median_recent": statistics.median(scores_rec) if scores_rec else None,
        "drift": (round(statistics.mean(scores_rec) - statistics.mean(scores_all), 2)
                  if scores_all and scores_rec else 0.0),
        "buckets_all": dict(buckets_all),
        "buckets_recent": dict(buckets_rec),
        "notable": [
            {"turn": e.get("turn_index"), "score": e.get("score"),
             "signal": e.get("signal_type"),
             "excerpt": (e.get("prompt_excerpt") or "")[:80]}
            for e in notable
        ],
    }


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--window", type=int, default=20,
                   help="recent-window size for drift comparison (default 20)")
    p.add_argument("--json", action="store_true")
    p.add_argument("--notable-only", action="store_true",
                   help="only print extreme-score turns (<=2 or >=9)")
    args = p.parse_args(argv)

    events = _load()
    if not events:
        if args.json:
            print(json.dumps({"file": str(_IN_FILE), "count": 0}))
        else:
            print(f"satisfaction_analyzer: no data in {_IN_FILE}")
        return 0

    s = _summarize(events, args.window)
    if args.json:
        print(json.dumps({"file": str(_IN_FILE), **s}, indent=2))
        return 0

    if args.notable_only:
        for n in s["notable"]:
            print(f"  turn {n['turn']}: {n['score']} ({n['signal']}) -- "
                  f"{n['excerpt']!r}")
        return 0

    print(f"satisfaction_analyzer: {s['count']} turn(s) recorded")
    print(f"  mean   recent={s['mean_recent']}  all-time={s['mean_all']}  "
          f"drift={s['drift']:+}")
    print(f"  median recent={s['median_recent']}  all-time={s['median_all']}")
    print()
    print("  bucket distribution (recent vs. all-time):")
    keys = ("strong_pos", "mild_pos", "neutral", "explicit_numeric",
            "correction", "strong_neg", "empty")
    for k in keys:
        rec = s["buckets_recent"].get(k, 0)
        allt = s["buckets_all"].get(k, 0)
        if rec or allt:
            print(f"    {k:<18} recent={rec:>4}  all-time={allt:>4}")
    if s["notable"]:
        print()
        print(f"  notable turns ({len(s['notable'])} extreme-score):")
        for n in s["notable"][-10:]:
            print(f"    turn {n['turn']}: {n['score']} ({n['signal']}) -- "
                  f"{n['excerpt']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
