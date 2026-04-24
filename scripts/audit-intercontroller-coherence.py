#!/usr/bin/env python3
"""Inter-controller coherence — are hypermeta controllers reinforcing
or cancelling each other?

Reads `output/metrics/runtime-snapshots.json` for per-controller effects
on each of the 6 composition axes (trust, coupling, flicker, coherent,
entropy, progressive). Computes pairwise cancellation:

  cancellation_score(A, B) = Σ_axis |effect_A(axis) * effect_B(axis)
                              where sign(A) ≠ sign(B)|

Pairs with high cancellation are controllers working at cross-purposes.
Emits JSON with top-N cancelling pairs + recommendation (unified direction
or controller-specific axis exclusion).

This is the L∞∞∞ layer: observing the observation apparatus (controllers
are the apparatus; this audit observes THEIR mutual consistency).

MVP: if the runtime-snapshots file is absent or malformed, emit an empty
report with status=no_data and exit 0 — no false alarms on fresh setups.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent)
SNAPSHOTS = ROOT / "output" / "metrics" / "runtime-snapshots.json"
OUT = ROOT / "output" / "metrics" / "hme-intercontroller-coherence.json"


def _pairwise_cancellation(effects: dict) -> list[dict]:
    """effects = {controller_name: {axis: float}}."""
    names = list(effects.keys())
    pairs = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            ea = effects[a] or {}
            eb = effects[b] or {}
            axes = set(ea) | set(eb)
            score = 0.0
            opposing_axes = []
            for axis in axes:
                va, vb = ea.get(axis, 0.0), eb.get(axis, 0.0)
                if not isinstance(va, (int, float)) or not isinstance(vb, (int, float)):
                    continue
                if va == 0 or vb == 0:
                    continue
                if (va > 0) != (vb > 0):
                    magnitude = abs(va * vb)
                    score += magnitude
                    opposing_axes.append({"axis": axis, "a": va, "b": vb})
            if score > 0:
                pairs.append({
                    "controllers": [a, b],
                    "cancellation_score": round(score, 4),
                    "opposing_axes": opposing_axes,
                })
    pairs.sort(key=lambda p: -p["cancellation_score"])
    return pairs


def _load_effects() -> dict | None:
    if not SNAPSHOTS.is_file():
        return None
    try:
        d = json.loads(SNAPSHOTS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    # Expected path: d["controllers"][name]["effects"][axis] = float
    out: dict = {}
    controllers = d.get("controllers") if isinstance(d, dict) else None
    if not isinstance(controllers, dict):
        return None
    for cname, cdata in controllers.items():
        if not isinstance(cdata, dict):
            continue
        eff = cdata.get("effects") or cdata.get("axis_effects")
        if isinstance(eff, dict):
            out[cname] = eff
    return out or None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    effects = _load_effects()
    if not effects:
        report = {
            "status": "no_data",
            "note": "runtime-snapshots.json absent or lacks 'controllers[*].effects'. "
                    "This verifier requires per-controller per-axis effect magnitudes "
                    "to compute cancellation scores. Falls back to 'no signal' until "
                    "the snapshot pipeline populates those fields.",
        }
    else:
        pairs = _pairwise_cancellation(effects)
        report = {
            "status": "ok",
            "controllers_observed": len(effects),
            "cancelling_pairs": pairs[:10],
            "total_pairs_with_cancellation": len(pairs),
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        if report.get("status") == "no_data":
            print(f"inter-controller coherence: {report['status']}")
        else:
            print(f"inter-controller coherence: {report['controllers_observed']} controllers, "
                  f"{report['total_pairs_with_cancellation']} cancelling pair(s)")
            for p in report.get("cancelling_pairs", [])[:5]:
                a, b = p["controllers"]
                print(f"  {a} ↔ {b}: score={p['cancellation_score']} on {len(p['opposing_axes'])} axis/axes")

    return 0


if __name__ == "__main__":
    sys.exit(main())
