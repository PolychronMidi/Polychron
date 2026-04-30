#!/usr/bin/env python3
"""i/why mode=verifier-utility — Horizon VI seed (meta-meta verifiers).

Reads the per-verifier status history from
output/metrics/hme-coherence-timeseries.jsonl and computes
signal-to-noise per verifier:
  - always-PASS (no information ever)
  - always-FAIL (broken or alarmist)
  - flip count (how often did status change)
  - score variance (how noisy is the score)
  - last-status (what is it now)

Surfaces verifiers that are likely candidates for pruning, retuning,
or attention. The full Horizon VI vision adds: incident-correlation
("did this verifier's FAIL catch a real bug, or did the agent ignore
it?"), coverage gaps, drift detection ("a verifier that passed for
100 runs may no longer be checking what it used to"). Today this
ships the cheapest of those four — and demonstrates the horizon is
actually within reach.
"""
from __future__ import annotations
import json
import os
import sys
from collections import defaultdict

from _common import PROJECT_ROOT


def main(argv):
    ts_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                           "hme-coherence-timeseries.jsonl")
    if not os.path.isfile(ts_path):
        print("# i/why mode=verifier-utility")
        print(f"No timeseries at {ts_path}")
        return 1

    try:
        with open(ts_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, ValueError) as e:
        print(f"Failed to read timeseries: {e}")
        return 1

    # Per-verifier history: name → list of (status, score)
    history: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for row in rows:
        for name, info in row.get("probes", {}).items():
            if isinstance(info, dict):
                history[name].append(
                    (info.get("status", "?"), info.get("score", 0.0))
                )

    if not history:
        print("# i/why mode=verifier-utility")
        print(f"No per-verifier data in {len(rows)} timeseries rows.")
        return 0

    # Compute utility metrics per verifier
    metrics = []
    for name, runs in history.items():
        n = len(runs)
        statuses = [s for s, _ in runs]
        scores = [v for _, v in runs]
        n_pass = statuses.count("PASS")
        n_fail = statuses.count("FAIL")
        # Flip count: status transitions
        flips = sum(
            1 for i in range(1, n) if statuses[i] != statuses[i - 1]
        )
        # Score variance (population)
        if scores:
            mean = sum(scores) / len(scores)
            var = sum((s - mean) ** 2 for s in scores) / len(scores)
        else:
            var = 0.0
        last = statuses[-1] if statuses else "?"
        metrics.append({
            "name": name, "n": n, "pass": n_pass, "fail": n_fail,
            "flips": flips, "var": var, "last": last,
        })

    print(f"# i/why mode=verifier-utility ({len(rows)} runs analyzed)")
    print()

    # Bucket 1: always-PASS verifiers (zero information ever)
    always_pass = [m for m in metrics if m["pass"] == m["n"] and m["n"] >= 10]
    if always_pass:
        always_pass.sort(key=lambda m: -m["n"])
        print(f"## Always-PASS ({len(always_pass)}) — zero information ever; candidates for downweighting")
        for m in always_pass[:8]:
            print(f"  {m['name']:36}  {m['n']} runs, never flipped")
        if len(always_pass) > 8:
            print(f"  (+{len(always_pass) - 8} more)")
        print()

    # Bucket 2: always-FAIL (broken or signal we ignore)
    always_fail = [m for m in metrics if m["fail"] == m["n"] and m["n"] >= 10]
    if always_fail:
        print(f"## Always-FAIL ({len(always_fail)}) — broken, alarmist, or chronically ignored")
        for m in always_fail[:8]:
            print(f"  {m['name']:36}  {m['n']} runs, all FAIL")
        if len(always_fail) > 8:
            print(f"  (+{len(always_fail) - 8} more)")
        print()

    # Bucket 3: flapping — high flip rate signals noise or genuine instability
    flappers = [
        m for m in metrics
        if m["n"] >= 10 and m["flips"] >= max(3, m["n"] * 0.15)
    ]
    flappers.sort(key=lambda m: -m["flips"])
    if flappers:
        print(f"## Flapping ({len(flappers)}) — flips ≥15% of runs; either noisy or catching real instability")
        for m in flappers[:8]:
            rate = m["flips"] / m["n"] * 100
            print(f"  {m['name']:36}  {m['flips']}/{m['n']} flips ({rate:.0f}%) · last={m['last']}")
        if len(flappers) > 8:
            print(f"  (+{len(flappers) - 8} more)")
        print()

    # Bucket 4: high score variance (mode oscillating even when status stable)
    variant = [m for m in metrics if m["n"] >= 10 and m["var"] > 0.02]
    variant.sort(key=lambda m: -m["var"])
    if variant:
        print(f"## High score variance ({len(variant)}) — score oscillates even when status doesn't")
        for m in variant[:5]:
            print(f"  {m['name']:36}  var={m['var']:.3f} · last={m['last']}")
        print()

    # Summary
    total = len(metrics)
    silent = len(always_pass) + len(always_fail)
    active = total - silent - len(flappers)
    print(f"## Summary")
    print(f"  total verifiers tracked: {total}")
    print(f"  silent (always same status): {silent}")
    print(f"  flapping: {len(flappers)}")
    print(f"  active stable: {active}")
    print()
    print("# Next:")
    print("  i/why mode=verifier <name>     drill into one verifier (status + history + source)")
    print("  i/status mode=hci-by-subtag    aggregate by category")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
