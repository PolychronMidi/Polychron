#!/usr/bin/env python3
"""Audit: every strong-negative correlation in trace data must be accounted
for in metrics/hme-suspected-upstreams.json (candidates / confirmed / refuted).

If the detector finds a pair with r <= -0.4 that isn't in ANY bucket of the
registry, that's drift — the system is observing a tension it hasn't named.
Either:
  - Add it as a candidate (hypothesize the shared upstream)
  - Add it as refuted (document why it's coincidence)
  - Add it as confirmed if a bridge already exists

Exit 0 if clean. Exit 1 if unaccounted pairs found (lists them).

Invoked by the invariant battery; can also be run ad-hoc for review.
"""
from __future__ import annotations
import json
import math
import sys
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRACE_PATH = PROJECT_ROOT / "metrics" / "trace.jsonl"
REGISTRY_PATH = PROJECT_ROOT / "metrics" / "hme-suspected-upstreams.json"
THRESHOLD = -0.4
MAX_ROWS = 5000


def _canon_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return 0.0 if dx == 0 or dy == 0 else num / (dx * dy)


def main() -> None:
    if not TRACE_PATH.is_file():
        # No trace yet — skip (pre-first-run).
        sys.exit(0)
    if not REGISTRY_PATH.is_file():
        print(f"FAIL: registry missing at {REGISTRY_PATH}", file=sys.stderr)
        sys.exit(1)

    try:
        reg = json.load(open(REGISTRY_PATH))
    except Exception as e:
        print(f"FAIL: registry parse error: {e}", file=sys.stderr)
        sys.exit(1)

    registered = set()
    for bucket in ("candidates", "confirmed", "refuted"):
        for entry in reg.get(bucket, []):
            pair = entry.get("pair")
            if isinstance(pair, list) and len(pair) == 2:
                registered.add(_canon_pair(*pair))

    # Load trust series.
    series: dict[str, list[float]] = defaultdict(list)
    n_rows = 0
    with open(TRACE_PATH) as f:
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
                if isinstance(info, dict):
                    s = info.get("score")
                    if isinstance(s, (int, float)) and math.isfinite(s):
                        series[mod].append(float(s))
            n_rows += 1
            if n_rows >= MAX_ROWS:
                break

    max_len = max((len(v) for v in series.values()), default=0)
    series = {k: v for k, v in series.items() if len(v) == max_len and max_len > 0}

    unaccounted = []
    mods = sorted(series.keys())
    for i, a in enumerate(mods):
        for b in mods[i + 1:]:
            r = _pearson(series[a], series[b])
            if r <= THRESHOLD:
                pair = _canon_pair(a, b)
                if pair not in registered:
                    unaccounted.append((a, b, r))

    if not unaccounted:
        sys.exit(0)

    unaccounted.sort(key=lambda x: x[2])
    print(f"DRIFT: {len(unaccounted)} antagonism pair(s) observed in trace data but NOT in registry.", file=sys.stderr)
    print(f"Add each to metrics/hme-suspected-upstreams.json as candidate, confirmed, or refuted:", file=sys.stderr)
    for a, b, r in unaccounted[:10]:
        print(f"  - {a} <-> {b}  (r={r:.3f})", file=sys.stderr)
    if len(unaccounted) > 10:
        print(f"  ... and {len(unaccounted) - 10} more", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
