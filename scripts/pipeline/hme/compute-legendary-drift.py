#!/usr/bin/env python3
"""Arc III: Inverse Reasoning — outcome -> state.

Every pipeline round so far has carried `listening verdict: legendary`. That
makes every round a data point in the "legendary state distribution" — the
envelope of HME states that produced legendary output. This script:

1. Snapshots the current round's full HME state into
   metrics/hme-legendary-states.jsonl (append-only).
2. Computes per-field envelopes (median, stdev) across ALL accumulated
   legendary snapshots.
3. Measures the current round's distance from envelope as per-field z-score,
   overall drift = mean |z| across fields.
4. Writes metrics/hme-legendary-drift.json with drift score + per-field
   outliers.
5. Emits legendary_drift_preemptive activity event when drift exceeds
   threshold — PREEMPTIVE because it fires while substrates still say
   healthy, catching drift toward non-legendary territory before the
   listening verdict fails.

The inverse of the forward cascade: instead of "HME state -> predicted
outcome," this asks "legendary outcome -> what HME state distribution
produced it?" and flags deviation from that state distribution.

Non-fatal. Runs POST_COMPOSITION after other Arc scripts.

NOTE: The snapshot here is UNCONFIRMED-legendary — we assume any completed
pipeline was legendary unless later marked otherwise. The user can tag
rounds as non-legendary via metrics/hme-ground-truth.jsonl (already feeds
consensus voter). Future refinement: filter snapshots by ground-truth
confirmation when available.
"""
from __future__ import annotations
import json
import math
import os
import subprocess
import sys
import time
from typing import Any

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
SNAPSHOTS = os.path.join(METRICS_DIR, "hme-legendary-states.jsonl")
DRIFT_OUT = os.path.join(METRICS_DIR, "hme-legendary-drift.json")
DRIFT_THRESHOLD = 2.0  # mean |z-score| above this → drift alert
MIN_SNAPSHOTS_FOR_ENVELOPE = 5


def _load_json(p: str) -> Any:
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _git_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, timeout=5, text=True,
        ).strip()
    except Exception:
        return None


def _git_tree_hash() -> str | None:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD^{tree}"],
            cwd=PROJECT_ROOT, timeout=5, text=True,
        ).strip()
        return out[:12] if out else None
    except Exception:
        return None


def _capture_state() -> dict:
    """Snapshot fields that constitute HME state for inverse reasoning."""
    state = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sha": _git_sha(),
        "tree_hash": _git_tree_hash(),
        "hci": None,
        "hci_delta": None,
        "consensus_mean": None,
        "consensus_stdev": None,
        "axis_rebalance_cost": None,
        "per_axis_adj": {},
        "smoothed_shares": {},
        "fires": {},
        "entries": {},
        "prediction_recall": None,
        "prediction_accuracy": None,
    }

    # pipeline-summary for hci + cost
    ps = _load_json(os.path.join(METRICS_DIR, "pipeline-summary.json")) or {}
    if isinstance(ps.get("hci"), (int, float)):
        state["hci"] = ps["hci"]
    if isinstance(ps.get("axis_rebalance_cost_per_100_beats"), (int, float)):
        state["axis_rebalance_cost"] = ps["axis_rebalance_cost_per_100_beats"]

    # consensus
    con = _load_json(os.path.join(METRICS_DIR, "hme-consensus.json")) or {}
    if isinstance(con.get("mean"), (int, float)):
        state["consensus_mean"] = con["mean"]
    if isinstance(con.get("stdev"), (int, float)):
        state["consensus_stdev"] = con["stdev"]

    # trace summary axis data
    trace = _load_json(os.path.join(METRICS_DIR, "trace-summary.json")) or {}
    aee = trace.get("axisEnergyEquilibrator") or {}
    if isinstance(aee.get("perAxisAdj"), dict):
        state["per_axis_adj"] = {k: v for k, v in aee["perAxisAdj"].items()
                                  if isinstance(v, (int, float))}
    if isinstance(aee.get("smoothedShares"), dict):
        state["smoothed_shares"] = {k: v for k, v in aee["smoothedShares"].items()
                                     if isinstance(v, (int, float))}
    if isinstance(aee.get("perLegacyOverride"), dict):
        state["fires"] = dict(aee["perLegacyOverride"])
    if isinstance(aee.get("perLegacyOverrideEntries"), dict):
        state["entries"] = dict(aee["perLegacyOverrideEntries"])

    # musical correlation for hci_delta + prediction metrics
    mc = _load_json(os.path.join(METRICS_DIR, "hme-musical-correlation.json")) or {}
    hist = mc.get("history") or []
    if hist and isinstance(hist[-1], dict):
        last = hist[-1]
        if isinstance(last.get("hci_delta"), (int, float)):
            state["hci_delta"] = last["hci_delta"]

    pa = _load_json(os.path.join(METRICS_DIR, "hme-prediction-accuracy.json")) or {}
    rounds = pa.get("rounds") or []
    if rounds and isinstance(rounds[-1], dict) and not rounds[-1].get("skipped"):
        r = rounds[-1]
        if isinstance(r.get("accuracy"), (int, float)):
            state["prediction_accuracy"] = r["accuracy"]
        if isinstance(r.get("recall"), (int, float)):
            state["prediction_recall"] = r["recall"]

    return state


# R31: envelope math extracted to drift_envelope helper module.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drift_envelope import flatten as _flatten, compute_envelope as _compute_envelope, compute_drift as _compute_drift  # noqa: E402


def _load_snapshots() -> list[dict]:
    if not os.path.isfile(SNAPSHOTS):
        return []
    out = []
    with open(SNAPSHOTS, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                out.append(json.loads(s))
            except Exception:
                continue
    return out


def main() -> int:
    current = _capture_state()

    # R22 #4: ground-truth integration. Default assumption: legendary. If the
    # user tagged a recent round with a non-legendary sentiment in
    # hme-ground-truth.jsonl, mark the snapshot accordingly — envelope
    # computation excludes non-legendary snapshots from the baseline.
    gt_path = os.path.join(METRICS_DIR, "hme-ground-truth.jsonl")
    current["legendary_confirmed"] = True  # default
    try:
        if os.path.isfile(gt_path):
            with open(gt_path, encoding="utf-8") as gf:
                gt_lines = [ln.strip() for ln in gf if ln.strip()]
            if gt_lines:
                last_gt = json.loads(gt_lines[-1])
                tags = [str(t).lower() for t in (last_gt.get("tags") or [])]
                # Most recent ground truth is legendary-if-tagged-as-such
                current["legendary_confirmed"] = "legendary" in tags
    except Exception:
        pass

    os.makedirs(os.path.dirname(SNAPSHOTS), exist_ok=True)
    with open(SNAPSHOTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(current) + "\n")

    # Compute envelope from ALL snapshots including the one we just wrote.
    # We include current so drift naturally starts at 0 on first round (no
    # outlier vs a single-sample envelope). Real drift surfaces after 5+ rounds.
    snaps = _load_snapshots()
    if len(snaps) < MIN_SNAPSHOTS_FOR_ENVELOPE:
        result = {
            "generated_at": current["ts"],
            "snapshot_count": len(snaps),
            "min_for_envelope": MIN_SNAPSHOTS_FOR_ENVELOPE,
            "drift_score": None,
            "status": "insufficient_history",
            "current_state": current,
        }
        with open(DRIFT_OUT, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            f.write("\n")
        print(f"compute-legendary-drift: {len(snaps)}/{MIN_SNAPSHOTS_FOR_ENVELOPE} snapshots — "
              "envelope not yet computable")
        return 0

    # Exclude current snapshot from envelope so drift measures current against past.
    # R22 #4: also exclude any snapshot explicitly marked non-legendary
    # (legendary_confirmed=False). Default True for backfilled snapshots.
    # R24 #3: also exclude snapshots where HCI < 95 (when HCI is recorded).
    # Arc III's "legendary envelope" is specifically the TOP-TIER legendary
    # distribution — ramp-up rounds and rounds with verifier regressions
    # shouldn't pollute the baseline.
    HCI_MIN = 95
    def _include(s):
        if s.get("legendary_confirmed", True) is False:
            return False
        hci = s.get("hci")
        if isinstance(hci, (int, float)) and hci < HCI_MIN:
            return False
        return True
    history = [s for s in snaps[:-1] if _include(s)]
    envelope = _compute_envelope(history)
    current_flat = _flatten(current)
    drift, outliers = _compute_drift(current_flat, envelope)

    result = {
        "generated_at": current["ts"],
        "snapshot_count": len(snaps),
        "envelope_n": len(history),
        "drift_score": round(drift, 3),
        "drift_threshold": DRIFT_THRESHOLD,
        "status": "drift_detected" if drift > DRIFT_THRESHOLD else "within_envelope",
        "outliers_count": len(outliers),
        "outliers": outliers[:8],  # top 8 drifted fields
        "current_state": current,
    }

    with open(DRIFT_OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    msg = (f"compute-legendary-drift: drift={drift:.2f} (threshold={DRIFT_THRESHOLD}) "
           f"n={len(history)} outliers={len(outliers)} status={result['status']}")
    print(msg)

    # Preemptive alert: emit activity event when drift exceeds threshold.
    # R24 #9: epoch-transition detection. If drift stayed elevated for 3+
    # consecutive rounds while verdict remained legendary, log an epoch
    # transition. Marks a regime change — future drift measurements can
    # use per-epoch envelopes to avoid mixing fundamentally different
    # composition eras.
    try:
        ts_path = os.path.join(METRICS_DIR, "hme-arc-timeseries.jsonl")
        ep_path = os.path.join(METRICS_DIR, "hme-epoch-transitions.jsonl")
        if os.path.isfile(ts_path):
            rows = []
            with open(ts_path, encoding="utf-8") as tf:
                for ln in tf:
                    s = ln.strip()
                    if s:
                        try:
                            rows.append(json.loads(s))
                        except Exception:
                            pass
            tail_scores = [r.get("arc_iii", {}).get("drift_score") for r in rows[-3:]]
            tail_scores = [s for s in tail_scores if isinstance(s, (int, float))]
            if len(tail_scores) == 3 and all(s > 1.0 for s in tail_scores):
                # Check if we already logged this epoch (avoid dup entries)
                existing = []
                if os.path.isfile(ep_path):
                    with open(ep_path, encoding="utf-8") as ef:
                        existing = [json.loads(l) for l in ef if l.strip()]
                last_epoch_sha = existing[-1].get("sha") if existing else None
                if last_epoch_sha != current.get("sha"):
                    with open(ep_path, "a", encoding="utf-8") as ef:
                        ef.write(json.dumps({
                            "ts": current["ts"],
                            "sha": current.get("sha"),
                            "reason": "drift > 1.0 for 3+ consecutive rounds with legendary verdict",
                            "drift_trajectory": tail_scores,
                            "top_outlier": (outliers[0].get("field") if outliers else None),
                        }) + "\n")
    except Exception:
        pass

    if drift > DRIFT_THRESHOLD:
        emit = os.path.join(PROJECT_ROOT, "tools", "HME", "activity", "emit.py")
        if os.path.isfile(emit):
            top_field = outliers[0]["field"] if outliers else "?"
            top_z = outliers[0]["z_score"] if outliers else 0
            try:
                subprocess.Popen(
                    ["python3", emit,
                     "--event=legendary_drift_preemptive",
                     f"--drift_score={drift:.3f}",
                     f"--outliers_count={len(outliers)}",
                     f"--top_outlier_field={top_field}",
                     f"--top_outlier_z={top_z}",
                     "--session=pipeline"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env={**os.environ, "PROJECT_ROOT": PROJECT_ROOT},
                )
            except Exception:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
