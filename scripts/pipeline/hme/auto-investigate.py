#!/usr/bin/env python3
"""Sixth emergent behavior: auto-execute read-only diagnostic steps for
matched patterns.

When Arc II matches a pattern, its `action.steps` include read-only
diagnostics (inspect trajectory, compute deltas, name the driver) before
the agent-action steps (fix code, recalibrate, retire). Running those
diagnostics automatically produces findings the agent can review —
one level of cognitive work moved from the agent to the substrate.

For each matched pattern, this script runs a set of diagnostic probes
based on the pattern's category + trigger payload. Findings append to
metrics/hme-investigation-reports.jsonl. Agent then synthesizes from
findings instead of gathering data manually.

Currently supports:
  category=investigation, trigger=consensus_threshold → read arc-timeseries,
    extract outlier-voter trajectory, identify direction (rising/falling)
    and whether the issue is recent or systemic.
  category=investigation, trigger=legendary_drift_threshold → read legendary-
    states trajectory for outlier fields, compute the change from prior
    snapshot vs envelope drift.
  category=retirement → no auto-investigation needed (retirement actions
    are agent decisions on already-computed data).
"""
from __future__ import annotations
import json
import os
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MATCHES = os.path.join(PROJECT_ROOT, "metrics", "hme-pattern-matches.json")
TIMESERIES = os.path.join(PROJECT_ROOT, "metrics", "hme-arc-timeseries.jsonl")
SNAPSHOTS = os.path.join(PROJECT_ROOT, "metrics", "hme-legendary-states.jsonl")
REPORTS = os.path.join(PROJECT_ROOT, "metrics", "hme-investigation-reports.jsonl")
LOOKBACK_ROUNDS = 5


def _load_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _load_jsonl(p):
    if not os.path.isfile(p):
        return []
    out = []
    with open(p, encoding="utf-8") as f:
        for ln in f:
            s = ln.strip()
            if not s:
                continue
            try:
                out.append(json.loads(s))
            except Exception:
                continue
    return out


def _investigate_consensus(pattern: dict) -> dict:
    """Trajectory analysis for consensus divergence."""
    payload = pattern.get("payload", "")
    outlier_voters = [v.strip() for v in payload.split(",") if v.strip()]
    ts_rows = _load_jsonl(TIMESERIES)
    tail = ts_rows[-LOOKBACK_ROUNDS:] if ts_rows else []
    findings = {
        "kind": "consensus_divergence",
        "outlier_voters": outlier_voters,
        "rounds_analyzed": len(tail),
        "per_voter_trajectory": {},
        "verdict": None,
    }
    mean_trajectory = [r.get("arc_i", {}).get("mean") for r in tail]
    stdev_trajectory = [r.get("arc_i", {}).get("stdev") for r in tail]
    findings["consensus_mean_trajectory"] = mean_trajectory
    findings["consensus_stdev_trajectory"] = stdev_trajectory

    if len(mean_trajectory) >= 2 and all(
        isinstance(x, (int, float)) for x in mean_trajectory
    ):
        first, last = mean_trajectory[0], mean_trajectory[-1]
        delta = last - first
        findings["consensus_mean_delta"] = round(delta, 3)
        if abs(delta) < 0.05:
            findings["verdict"] = "blip — mean stable, single-round excursion"
        elif delta < -0.05:
            findings["verdict"] = "trending-down — consensus has degraded over recent rounds"
        else:
            findings["verdict"] = "recovering — consensus improved vs earlier rounds"
    return findings


def _investigate_drift(pattern: dict) -> dict:
    """Field-by-field trajectory for Arc III drift outliers."""
    drift = _load_json(os.path.join(PROJECT_ROOT, "metrics", "hme-legendary-drift.json")) or {}
    outliers = drift.get("outliers") or []
    snaps = _load_jsonl(SNAPSHOTS)
    tail = snaps[-LOOKBACK_ROUNDS:]
    findings = {
        "kind": "legendary_drift",
        "drift_score": drift.get("drift_score"),
        "outlier_fields": [],
    }
    for o in outliers[:5]:
        field = o.get("field", "")
        parent, _, child = field.partition(".")
        values = []
        for s in tail:
            v = s.get(parent, {}).get(child) if child else s.get(parent)
            if isinstance(v, (int, float)):
                values.append(v)
        traj_verdict = None
        if len(values) >= 2:
            first_half_avg = sum(values[:len(values) // 2]) / max(len(values) // 2, 1)
            second_half_avg = sum(values[len(values) // 2:]) / max(len(values) - len(values) // 2, 1)
            if abs(second_half_avg - first_half_avg) / max(abs(first_half_avg), 1e-6) < 0.10:
                traj_verdict = "blip — recent values stable, outlier is single-round"
            elif second_half_avg > first_half_avg:
                traj_verdict = "rising trend"
            else:
                traj_verdict = "falling trend"
        # R24 #7: propose a structural change class based on persistence +
        # HCI health. 3+ rounds of same outlier AND HCI stable → accept
        # (envelope update). 3+ rounds AND HCI dropping → correct (code change).
        hci_tail = [s.get("hci") for s in tail if isinstance(s.get("hci"), (int, float))]
        hci_healthy = hci_tail and all(h >= 95 for h in hci_tail[-3:])
        proposal = None
        if len(values) >= 3 and traj_verdict and "blip" not in traj_verdict:
            if hci_healthy:
                proposal = "accept_regime_shift"
            else:
                proposal = "correct_outlier_via_controller"
        findings["outlier_fields"].append({
            "field": field,
            "z_score": o.get("z_score"),
            "current": o.get("current"),
            "median": o.get("median"),
            "recent_trajectory": values,
            "trajectory_verdict": traj_verdict,
            "hci_healthy_last_3": hci_healthy,
            "proposed_action_class": proposal,
        })
    return findings


def _investigate(pattern: dict) -> dict:
    trig = pattern.get("pattern_file", "").lower()
    if "consensus" in trig:
        return _investigate_consensus(pattern)
    if "drift" in trig:
        return _investigate_drift(pattern)
    return {
        "kind": "no_auto_investigation",
        "reason": f"no diagnostic defined for pattern at {trig}",
    }


def main() -> int:
    matches = _load_json(MATCHES) or {}
    reports = []
    for m in matches.get("matches", []):
        category = m.get("category")
        if category == "retirement":
            continue  # retirement decisions are agent-authority, not auto-diagnosable
        findings = _investigate(m)
        reports.append({
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "pattern_id": m.get("id"),
            "category": category,
            "payload": m.get("payload"),
            "findings": findings,
        })

    if not reports:
        print("auto-investigate: no investigable matches — nothing to report")
        return 0

    os.makedirs(os.path.dirname(REPORTS), exist_ok=True)
    with open(REPORTS, "a", encoding="utf-8") as f:
        for r in reports:
            f.write(json.dumps(r) + "\n")

    for r in reports:
        verdict = r["findings"].get("verdict")
        traj_verdicts = [of.get("trajectory_verdict") for of in r["findings"].get("outlier_fields", [])]
        summary = verdict or (", ".join(v for v in traj_verdicts if v) or "findings written")
        print(f"auto-investigate: [{r['pattern_id']}] {summary}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
