#!/usr/bin/env python3
"""R22 #5+#6+#7: Cross-arc timeseries emitter.

Appends one row per pipeline round to metrics/hme-arc-timeseries.jsonl
summarizing all four arcs' headline numbers. Enables trend analysis without
needing to parse each arc's full output separately.

Each row captures:
  Arc I:   consensus_mean, consensus_stdev, divergence, active_voters
  Arc II:  matched_count, matched_ids[]
  Arc III: drift_score, envelope_n, outlier_count, top_outlier_field
  Arc IV:  counts_by_class, retirement_candidates[]
  Meta:    sha, ts, invariant_total, invariant_pass_rate

Also computes envelope-shift score: how much the legendary envelope's
center-of-mass has moved across the last N snapshots. Large envelope shift
means the "normal" state distribution itself is drifting — distinct from
single-round drift.

Writes:
  metrics/hme-arc-timeseries.jsonl  (append-only time series)
  metrics/hme-envelope-shift.json   (single-file latest envelope stats)
"""
from __future__ import annotations
import json
import math
import os
import subprocess
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TIMESERIES = os.path.join(PROJECT_ROOT, "metrics", "hme-arc-timeseries.jsonl")
ENVELOPE_SHIFT = os.path.join(PROJECT_ROOT, "metrics", "hme-envelope-shift.json")
SNAPSHOTS = os.path.join(PROJECT_ROOT, "metrics", "hme-legendary-states.jsonl")


def _load(p):
    try:
        with open(os.path.join(PROJECT_ROOT, p), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _load_jsonl(p):
    full = os.path.join(PROJECT_ROOT, p) if not os.path.isabs(p) else p
    if not os.path.isfile(full):
        return []
    out = []
    with open(full, encoding="utf-8") as f:
        for ln in f:
            s = ln.strip()
            if not s:
                continue
            try:
                out.append(json.loads(s))
            except Exception:
                continue
    return out


def _git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, timeout=5, text=True,
        ).strip()
    except Exception:
        return None


def _envelope_shift():
    """Envelope shift: compare median-of-first-half-snapshots vs median-of-second-half.
    Larger shift = the center of mass of the legendary distribution is moving."""
    snaps = _load_jsonl(SNAPSHOTS)
    # Only use confirmed-legendary snapshots (R22 #4 integration)
    snaps = [s for s in snaps if s.get("legendary_confirmed", True) is not False]
    if len(snaps) < 6:
        return {"status": "insufficient_history", "n": len(snaps)}
    mid = len(snaps) // 2
    first, second = snaps[:mid], snaps[mid:]

    def _median_by_field(rows):
        by_f = {}
        for s in rows:
            for k, v in s.items():
                if isinstance(v, (int, float)):
                    by_f.setdefault(k, []).append(float(v))
                elif isinstance(v, dict):
                    for sk, sv in v.items():
                        if isinstance(sv, (int, float)):
                            by_f.setdefault(f"{k}.{sk}", []).append(float(sv))
        return {k: sorted(vs)[len(vs) // 2] for k, vs in by_f.items() if len(vs) >= 2}

    m1 = _median_by_field(first)
    m2 = _median_by_field(second)
    shifts = []
    for k in m1:
        if k in m2 and m1[k] != 0:
            rel = abs(m2[k] - m1[k]) / (abs(m1[k]) + 1e-9)
            shifts.append((k, rel, m1[k], m2[k]))
    shifts.sort(key=lambda t: -t[1])
    top = [{"field": k, "relative_shift": round(r, 3),
            "median_first": round(a, 4), "median_second": round(b, 4)}
           for k, r, a, b in shifts[:5]]
    shift_avg = sum(t[1] for t in shifts) / len(shifts) if shifts else 0.0
    return {
        "status": "computed",
        "n_first": len(first),
        "n_second": len(second),
        "average_relative_shift": round(shift_avg, 3),
        "top_shifted_fields": top,
    }


def main() -> int:
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sha": _git_sha(),
    }

    # Arc I
    con = _load("metrics/hme-consensus.json") or {}
    row["arc_i"] = {
        "mean": con.get("mean"),
        "stdev": con.get("stdev"),
        "divergence": con.get("divergence"),
        "active_voters": con.get("active_count"),
        "outlier_voters": [o.get("voter") for o in (con.get("outliers") or [])],
    }

    # Arc II
    mat = _load("metrics/hme-pattern-matches.json") or {}
    row["arc_ii"] = {
        "total_patterns": mat.get("patterns_total"),
        "matched_count": mat.get("matches_count"),
        "matched_ids": [m.get("id") for m in (mat.get("matches") or [])],
    }

    # Arc III
    drift = _load("metrics/hme-legendary-drift.json") or {}
    row["arc_iii"] = {
        "drift_score": drift.get("drift_score"),
        "envelope_n": drift.get("envelope_n"),
        "status": drift.get("status"),
        "outlier_count": drift.get("outliers_count", 0),
        "top_outlier_field": (drift.get("outliers") or [{}])[0].get("field"),
    }

    # Arc IV
    eff = _load("metrics/hme-invariant-efficacy.json") or {}
    hist = _load("metrics/hme-invariant-history.json") or {}
    last = hist.get("last_result") or {}
    pass_count = sum(1 for v in last.values() if v == "pass")
    row["arc_iv"] = {
        "classes": eff.get("class_counts", {}),
        "retirement_candidates": eff.get("retirement_candidates", []),
        "invariant_total": eff.get("total_invariants"),
        "pass_rate": round(pass_count / max(len(last), 1), 4) if last else None,
    }

    # Envelope shift (meta)
    row["envelope_shift"] = _envelope_shift()

    os.makedirs(os.path.dirname(TIMESERIES), exist_ok=True)
    with open(TIMESERIES, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")

    # Also write envelope-shift standalone
    with open(ENVELOPE_SHIFT, "w", encoding="utf-8") as f:
        json.dump(row["envelope_shift"], f, indent=2)
        f.write("\n")

    es = row["envelope_shift"]
    print(f"emit-arc-timeseries: row appended  "
          f"[consensus={row['arc_i'].get('mean')} "
          f"patterns={row['arc_ii'].get('matched_count')} "
          f"drift={row['arc_iii'].get('drift_score')} "
          f"pass_rate={row['arc_iv'].get('pass_rate')} "
          f"env_shift={es.get('average_relative_shift', 'n/a')}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
