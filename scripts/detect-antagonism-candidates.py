#!/usr/bin/env python3
"""Detect candidate antagonism bridges from trace data.

The antagonism bridge principle: strong negative correlation between two
modules is evidence they're measuring the same underlying axis from opposite
sides. Coupling both to a shared upstream signal with opposing responses
converts destructive interference into productive tension.

Currently ONE bridge exists in the codebase:
  convergenceHarmonicTrigger <-> verticalIntervalMonitor  (r=-0.626 per comment)
  coupled to densitySurprise, opposing effects on rarity/penalty.

This script scans metrics/trace.jsonl for other strong negative correlations
between trust-system scores. Each strong negative correlation is a CANDIDATE
bridge — a pair that may be measuring the same axis antagonistically but
hasn't been identified yet.

Output: candidates ranked by |r|, with the strongest shown. The existing
bridge (convergenceHarmonicTrigger <-> verticalIntervalMonitor) should
appear in the results as ground truth — if it doesn't, the detector or
the data is wrong.

Usage:
  python3 scripts/detect-antagonism-candidates.py [--threshold 0.4] [--json OUT]
"""
from __future__ import annotations
import argparse
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRACE_PATH = PROJECT_ROOT / "output" / "metrics" / "trace.jsonl"
REGISTRY_PATH = PROJECT_ROOT / "output" / "metrics" / "hme-suspected-upstreams.json"


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Pearson correlation coefficient. Returns 0.0 for degenerate inputs."""
    n = len(xs)
    if n < 3:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)


def load_trust_series(path: Path, max_rows: int = 5000) -> dict[str, list[float]]:
    """Load per-module trust scores across trace rows. Returns {module: [scores...]}."""
    series: dict[str, list[float]] = defaultdict(list)
    n_rows = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            trust = d.get("trust") or {}
            if not isinstance(trust, dict):
                continue
            for mod, info in trust.items():
                if not isinstance(info, dict):
                    continue
                s = info.get("score")
                if isinstance(s, (int, float)) and math.isfinite(s):
                    series[mod].append(float(s))
            n_rows += 1
            if n_rows >= max_rows:
                break
    # Align: keep only modules with same length as max (drop sparse series).
    max_len = max((len(v) for v in series.values()), default=0)
    aligned = {k: v for k, v in series.items() if len(v) == max_len and max_len > 0}
    return aligned


def load_known_bridges() -> list[tuple[str, str]]:
    """Modules that already have a declared antagonism bridge."""
    # Currently only one, documented in lab/sketches.js and cross-layer code.
    return [("convergenceHarmonicTrigger", "verticalIntervalMonitor")]


def _canon_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def load_registry() -> dict:
    if REGISTRY_PATH.is_file():
        try:
            return json.load(open(REGISTRY_PATH))
        except Exception:
            pass
    return {"candidates": [], "confirmed": [], "refuted": []}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.4,
                    help="Minimum |r| to report (default 0.4)")
    ap.add_argument("--top", type=int, default=15, help="Show top N pairs")
    ap.add_argument("--json", type=str, default="", help="Write full JSON output to this path")
    ap.add_argument("--max-rows", type=int, default=5000)
    args = ap.parse_args()

    if not TRACE_PATH.is_file():
        print(f"No trace at {TRACE_PATH} — run a pipeline first.", file=sys.stderr)
        sys.exit(1)

    series = load_trust_series(TRACE_PATH, args.max_rows)
    mods = sorted(series.keys())
    n_rows = len(next(iter(series.values()))) if series else 0
    print(f"Loaded {len(mods)} trust modules × {n_rows} rows")

    known = set(_canon_pair(*p) for p in load_known_bridges())
    registry = load_registry()
    registered = set()
    for bucket in ("candidates", "confirmed", "refuted"):
        for entry in registry.get(bucket, []):
            pair = entry.get("pair")
            if isinstance(pair, list) and len(pair) == 2:
                registered.add(_canon_pair(*pair))

    # Compute all pairwise correlations.
    pairs = []
    for i, a in enumerate(mods):
        for b in mods[i + 1:]:
            r = _pearson(series[a], series[b])
            pairs.append((a, b, r))

    # Separate strong-negative (candidates) from strong-positive (co-moving).
    strong_neg = [p for p in pairs if p[2] <= -args.threshold]
    strong_pos = [p for p in pairs if p[2] >= args.threshold]
    strong_neg.sort(key=lambda p: p[2])  # most negative first

    print(f"\n{len(strong_neg)} pair(s) with r <= -{args.threshold}:")
    print(f"{'#':>3}  {'module A':<35} {'module B':<35} {'r':>7}  status")
    for i, (a, b, r) in enumerate(strong_neg[: args.top], 1):
        pair = _canon_pair(a, b)
        if pair in known:
            status = "KNOWN BRIDGE"
        elif pair in registered:
            status = "in registry"
        else:
            status = "*** candidate ***"
        print(f"{i:>3}  {a:<35} {b:<35} {r:>7.3f}  {status}")

    # Strong positive = likely measuring same axis, same side — less interesting
    # but worth noting for the "is this pair redundant" question.
    strong_pos.sort(key=lambda p: -p[2])
    print(f"\n{len(strong_pos)} pair(s) with r >= {args.threshold} (co-moving, informational):")
    for i, (a, b, r) in enumerate(strong_pos[:5], 1):
        print(f"{i:>3}  {a:<35} {b:<35} {r:>7.3f}")

    if args.json:
        out = {
            "n_rows": n_rows,
            "n_modules": len(mods),
            "threshold": args.threshold,
            "known_bridges": [list(p) for p in known],
            "candidates": [
                {"pair": [a, b], "r": r, "status": (
                    "known_bridge" if _canon_pair(a, b) in known
                    else "registered" if _canon_pair(a, b) in registered
                    else "candidate"
                )}
                for a, b, r in strong_neg
            ],
            "co_moving": [{"pair": [a, b], "r": r} for a, b, r in strong_pos],
        }
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
