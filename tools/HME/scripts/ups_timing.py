#!/usr/bin/env python3
"""Per-step UserPromptSubmit timing report (TODO #14b).

Reads the bounded JSONL the userpromptsubmit hook writes
(tools/HME/runtime/ups-step-timing.jsonl) and prints p50/p95/p99 per step
plus total, so the ~1100ms p95 is attributed to a concrete step rather than
guessed. Read-only; never blocks the hook path.
"""
from __future__ import annotations

import json
import os
import sys


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (pct / 100.0) * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


def report(path: str) -> int:
    if not os.path.isfile(path):
        print(f"ups-timing: no samples yet at {path}")
        return 0
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    if not rows:
        print("ups-timing: no parseable samples")
        return 0
    totals = [float(r.get("total_ms", 0)) for r in rows if isinstance(r.get("total_ms"), (int, float))]
    steps: dict[str, list[float]] = {}
    for r in rows:
        for name, ms in (r.get("steps") or {}).items():
            if isinstance(ms, (int, float)):
                steps.setdefault(name, []).append(float(ms))
    print(f"UserPromptSubmit per-step timing  (n={len(rows)} samples)")
    print(f"  {'step':<18} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}")
    ranked = sorted(steps.items(), key=lambda kv: _percentile(kv[1], 95), reverse=True)
    for name, vals in ranked:
        print(f"  {name:<18} {_percentile(vals, 50):>7.0f} {_percentile(vals, 95):>7.0f} {_percentile(vals, 99):>7.0f} {max(vals):>7.0f}")
    print(f"  {'TOTAL':<18} {_percentile(totals, 50):>7.0f} {_percentile(totals, 95):>7.0f} {_percentile(totals, 99):>7.0f} {max(totals) if totals else 0:>7.0f}")
    return 0


def main(argv: list[str]) -> int:
    root = os.environ.get("PROJECT_ROOT") or os.getcwd()
    path = argv[0] if argv else os.path.join(root, "tools", "HME", "runtime", "ups-step-timing.jsonl")
    return report(path)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
