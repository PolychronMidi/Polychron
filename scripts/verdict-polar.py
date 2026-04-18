#!/usr/bin/env python3
"""Reformulate the 4-bin verdict space {LEGENDARY, STABLE, EVOLVED, DRIFTED}
as polar coordinates on (distance, direction).

The antagonism-bridge insight: STABLE and LEGENDARY don't differ by "amount
of good" — they differ by DISTANCE from baseline at the same DIRECTION.
DRIFTED isn't "opposite of STABLE" — it's far from baseline in the UNAPPEALING
direction. EVOLVED is medium-distance, appealing. The 4 bins are a collapsed
polar grid.

Bin -> (distance, direction):
  STABLE:    (low,    +  )   — close to baseline, appealing
  EVOLVED:   (medium, +  )   — meaningful move, appealing
  LEGENDARY: (high,   + +)   — breakthrough, appealing
  DRIFTED:   (high,   -  )   — meaningful move, unappealing

Why this matters:
  - The evolution loop can now say "keep the direction, push the distance"
    (STABLE -> EVOLVED -> LEGENDARY) as a coherent trajectory instead of a
    discrete bin change.
  - "Near-DRIFTED" sessions (medium distance, negative direction) are
    early-warning signals that pure bin classification can't see.
  - Distance IS the exploration axis. Direction IS the appeal axis. The
    antagonism bridge view says these should be COUPLED via a shared
    "listener appetite" upstream, not independently optimized.

Usage:
  python3 scripts/verdict-polar.py [--history metrics/trace.jsonl]
  python3 scripts/verdict-polar.py --show-map
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Canonical mapping: each bin -> (distance, direction) tuple.
# distance in [0.0, 1.0]: 0 = baseline, 1 = maximally different.
# direction in [-1.0, 1.0]: -1 = very unappealing, +1 = very appealing.
VERDICT_POLAR = {
    "STABLE":    (0.2, 0.4),   # small movement, clearly appealing
    "EVOLVED":   (0.55, 0.7),  # meaningful move, strongly appealing
    "LEGENDARY": (0.9, 1.0),   # breakthrough distance, maximal appeal
    "DRIFTED":   (0.7, -0.8),  # meaningful distance, unappealing direction
    "UNKNOWN":   (0.0, 0.0),   # origin - no signal
}


def polar_for(verdict: str) -> tuple[float, float]:
    return VERDICT_POLAR.get(verdict.upper(), VERDICT_POLAR["UNKNOWN"])


def compute_appetite(recent_verdicts: list[str]) -> dict:
    """Estimate the shared upstream 'listener appetite' from a recent window.

    Appetite has two components that the antagonism bridge would use:
      distance_preference: rolling mean of distances in successful (direction>=0) verdicts
      direction_tolerance: willingness to accept distance at moderate direction

    When distance_preference is rising, the bridge should permit more
    exploration (EVOLVED / LEGENDARY attempts). When direction_tolerance
    is low, the system should pull back toward STABLE to re-ground.
    """
    if not recent_verdicts:
        return {"distance_preference": 0.5, "direction_tolerance": 0.5, "n": 0}
    positives = [(d, dr) for v in recent_verdicts
                 for (d, dr) in [polar_for(v)] if dr >= 0]
    negatives = [(d, dr) for v in recent_verdicts
                 for (d, dr) in [polar_for(v)] if dr < 0]
    if not positives:
        return {"distance_preference": 0.3, "direction_tolerance": 0.3,
                "n": len(recent_verdicts), "alert": "no appealing verdicts in window"}
    dist_pref = sum(d for d, _ in positives) / len(positives)
    dir_tol = 1.0 - (len(negatives) / len(recent_verdicts))
    return {
        "distance_preference": round(dist_pref, 3),
        "direction_tolerance": round(dir_tol, 3),
        "n": len(recent_verdicts),
        "positives": len(positives),
        "negatives": len(negatives),
    }


def trajectory_vector(prev: tuple[float, float], curr: tuple[float, float]) -> dict:
    """Direction of motion in verdict space. Returns delta_distance and
    delta_direction — the per-round move that the evolution loop could
    target as a trajectory rather than a bin transition."""
    return {
        "delta_distance": round(curr[0] - prev[0], 3),
        "delta_direction": round(curr[1] - prev[1], 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--show-map", action="store_true",
                    help="Print the verdict->polar mapping and exit")
    ap.add_argument("--verdicts", type=str, default="",
                    help="Comma-separated verdict sequence (for appetite + trajectory demo)")
    args = ap.parse_args()

    if args.show_map:
        print("Verdict -> (distance, direction)")
        print("  distance:  0=baseline, 1=maximally different")
        print("  direction: -1=unappealing, +1=appealing")
        print()
        for v, (d, dr) in VERDICT_POLAR.items():
            bar_dist = "█" * int(d * 20)
            bar_dir = ("█" * int(abs(dr) * 10)).rjust(10) if dr >= 0 else ("█" * int(abs(dr) * 10)).ljust(10)
            print(f"  {v:<10} ({d:.2f}, {dr:+.2f})  dist {bar_dist:<20} dir {bar_dir}")
        return

    if args.verdicts:
        seq = [v.strip().upper() for v in args.verdicts.split(",") if v.strip()]
        print("Trajectory through polar verdict space:")
        print(f"{'#':>3}  {'verdict':<12} {'(distance, direction)':<25} {'delta vs prev'}")
        prev = None
        for i, v in enumerate(seq, 1):
            cur = polar_for(v)
            delta = trajectory_vector(prev, cur) if prev else None
            delta_s = f"d_dist={delta['delta_distance']:+.2f} d_dir={delta['delta_direction']:+.2f}" if delta else "(start)"
            print(f"{i:>3}  {v:<12} ({cur[0]:.2f}, {cur[1]:+.2f}) {delta_s}")
            prev = cur
        appetite = compute_appetite(seq)
        print()
        print("Estimated listener appetite (shared upstream for the bridge):")
        for k, v in appetite.items():
            print(f"  {k}: {v}")
        return

    # Default: just show the map.
    print("Usage: --show-map | --verdicts STABLE,EVOLVED,LEGENDARY,...")


if __name__ == "__main__":
    main()
