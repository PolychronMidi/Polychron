#!/usr/bin/env python3
"""Emergent behavior harvester — the fifth behavior of the four arcs.

Reads outputs from all four observability arcs and synthesizes a prioritized
action queue. This is the data-driven replacement for "agent proposes 10
ad-hoc tactical suggestions each round." When the substrate has captured
enough signal, the action queue writes itself.

Sources:
  Arc I:    metrics/hme-consensus.json           (outlier voters)
  Arc II:   metrics/hme-pattern-matches.json     (matched patterns + actions)
  Arc III:  metrics/hme-legendary-drift.json     (drift outliers + z-scores)
  Arc IV:   metrics/hme-invariant-efficacy.json  (flappy + retirement candidates)

Priority ordering:
  1. Matched patterns   (Arc II — most actionable; each has prescribed steps)
  2. Drift outliers     (Arc III — preemptive state drift)
  3. Consensus outliers (Arc I — substrate disagreement)
  4. Retirement cands   (Arc IV — flappy invariant cleanup)

Writes metrics/hme-next-actions.json. Empty actions list means the substrate
reports "nothing to do" — a healthy quiescent state.

Non-fatal. Runs POST_COMPOSITION after all four arcs.
"""
from __future__ import annotations
import json
import os
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(PROJECT_ROOT, "metrics", "hme-next-actions.json")


def _load(p):
    try:
        with open(os.path.join(PROJECT_ROOT, p), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main() -> int:
    actions: list[dict] = []

    # Arc II: matched patterns (highest priority — each carries prescribed steps)
    matches = _load("metrics/hme-pattern-matches.json") or {}
    for m in matches.get("matches", []):
        actions.append({
            "priority": 1,
            "source": "arc_ii_pattern",
            "id": m.get("id"),
            "category": m.get("category"),
            "summary": m.get("action_summary"),
            "detail": f"trigger payload: {m.get('payload', '')[:200]}",
            "steps": m.get("action_steps", []),
        })

    # Arc III: drift outliers (preemptive — catches state drift before verdict fails)
    drift = _load("metrics/hme-legendary-drift.json") or {}
    if drift.get("status") == "drift_detected":
        for o in (drift.get("outliers") or [])[:5]:
            actions.append({
                "priority": 2,
                "source": "arc_iii_drift",
                "id": f"drift:{o.get('field')}",
                "category": "investigation",
                "summary": f"{o['field']} = {o['current']} (median {o['median']}, z={o['z_score']:+.2f})",
                "detail": "Legendary envelope deviation ≥2σ. Investigate trajectory vs single-round jump.",
                "steps": [
                    "Inspect historical trajectory via metrics/hme-legendary-states.jsonl",
                    "Categorize: sudden jump (anomaly) or slow drift (regime change)",
                    "If benign regime change: add precedent to pattern history",
                    "If degradation: identify compensating substrate OR add controller correction",
                ],
            })

    # Arc I: consensus outliers (substrates disagree)
    con = _load("metrics/hme-consensus.json") or {}
    if con.get("divergence") in ("moderate", "high"):
        for o in con.get("outliers", []):
            actions.append({
                "priority": 3,
                "source": "arc_i_consensus",
                "id": f"consensus:{o.get('voter')}",
                "category": "investigation",
                "summary": f"{o['voter']} voter = {o['score']:+.2f} (delta {o['delta_from_mean']:+.2f} from mean {con.get('mean')})",
                "detail": f"Consensus divergence={con.get('divergence')} stdev={con.get('stdev')}.",
                "steps": [
                    f"Read the {o['voter']} voter's source metric",
                    "Check 3-round trend vs single-round blip",
                    "Decide: outlier is right (and majority blind) OR outlier broken (and majority correct)",
                ],
            })

    # Arc IV: retirement candidates (flappy invariants accumulated without citation)
    eff = _load("metrics/hme-invariant-efficacy.json") or {}
    for cand in eff.get("retirement_candidates", []):
        actions.append({
            "priority": 4,
            "source": "arc_iv_retirement",
            "id": f"retire:{cand}",
            "category": "retirement",
            "summary": f"Retire or recalibrate invariant: {cand}",
            "detail": "Classified as flappy — fires without any fix commit citing it. Either the signal is noise, or the threshold is wrong, or we've tolerated it too long.",
            "steps": [
                "Check fail_streak + last 10 runs via metrics/hme-invariant-history.json",
                "Decide: remove from invariants.json OR recalibrate threshold to reflect actual tolerance",
                "If removed, document precedent in tools/HME/patterns/retire-flappy-invariant.json",
            ],
        })

    actions.sort(key=lambda a: a["priority"])

    # Build a terse one-line summary for console output.
    bucket_counts = {"arc_ii_pattern": 0, "arc_iii_drift": 0,
                     "arc_i_consensus": 0, "arc_iv_retirement": 0}
    for a in actions:
        bucket_counts[a["source"]] = bucket_counts.get(a["source"], 0) + 1

    result = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_actions": len(actions),
        "by_source": bucket_counts,
        "actions": actions,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    if actions:
        bits = [f"{k.split('_')[1]}={v}" for k, v in bucket_counts.items() if v > 0]
        print(f"propose-next-actions: {len(actions)} actions queued  [{' '.join(bits)}]")
    else:
        print("propose-next-actions: 0 actions — substrate reports healthy quiescent state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
