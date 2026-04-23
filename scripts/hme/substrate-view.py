#!/usr/bin/env python3
"""i/substrate — unified four-arc view.

Rolls in what compute-consensus.js / propose-next-actions.py / auto-investigate.py /
compute-legendary-drift.py produce, presented as the agent-facing surface.
This replaces the 20-line Python inline incantations with one call.

Modes:
  (default)         brief headline + action queue
  mode=detail       full four-arc dump
  mode=actions      just the harvester queue + steps
  mode=drift        Arc III outliers with trajectories
  mode=consensus    Arc I voter state
  mode=efficacy     Arc IV invariant classes
  mode=patterns     Arc II matched patterns
  mode=diff         delta vs previous round (requires hme-arc-timeseries.jsonl)
  mode=invariants   browse invariants.json registry (filter=<substring>)
"""
from __future__ import annotations
import json
import os
import sys

from _common import PROJECT_ROOT, METRICS_DIR, load_json as _load, load_jsonl_tail as _load_jsonl_tail


def brief():
    na = _load("output/metrics/hme-next-actions.json") or {}
    con = _load("output/metrics/hme-consensus.json") or {}
    dr = _load("output/metrics/hme-legendary-drift.json") or {}
    eff = _load("output/metrics/hme-invariant-efficacy.json") or {}
    ps = _load("output/metrics/pipeline-summary.json") or {}

    n_actions = na.get("total_actions", 0)
    div = con.get("divergence", "?")
    stdev = con.get("stdev", "?")
    drift = dr.get("drift_score", "?")
    outliers_n = dr.get("outliers_count", 0)
    hci = ps.get("hci")
    if hci is None:
        snap = _load("output/metrics/hci-verifier-snapshot.json") or {}
        hci = snap.get("hci", "?")
    classes = eff.get("class_counts", {})
    lb = classes.get("load-bearing", 0)
    historical = classes.get("load-bearing-historical", 0)
    flappy = classes.get("flappy", 0)
    lines = [
        f"HCI={hci}  consensus={stdev} ({div})  drift={drift} ({outliers_n} outliers)  "
        f"invariants: lb={lb} hist={historical} flappy={flappy}",
    ]
    if n_actions > 0:
        lines.append(f"{n_actions} action(s) queued:")
        for a in (na.get("actions") or [])[:5]:
            beyond = " DEFERRED_BEYOND_EXPECTED" if a.get("deferred_beyond_expected") else ""
            lines.append(f"  [p{a.get('priority')}] {a.get('id')}{beyond}")
    else:
        lines.append("substrate: quiescent (0 actions queued)")
    return "\n".join(lines)


def detail():
    bits = [brief(), ""]
    # Arc III outliers
    dr = _load("output/metrics/hme-legendary-drift.json") or {}
    if dr.get("outliers"):
        bits.append("Arc III outliers:")
        for o in dr["outliers"][:6]:
            bits.append(f"  {o['field']:35s} current={o['current']:.3f} median={o['median']:.3f} z={o['z_score']:+.2f}")
    # Arc I voter trajectories
    con = _load("output/metrics/hme-consensus.json") or {}
    vtr = con.get("voter_trajectories") or {}
    if vtr:
        bits.append("Voter trajectories:")
        for v, t in vtr.items():
            bits.append(f"  {v:22s} mean={t.get('mean'):+.2f} slope={t.get('slope'):+.2f} n={t.get('n')}")
    # Arc II patterns (top 3)
    pm = _load("output/metrics/hme-pattern-matches.json") or {}
    if pm.get("matches"):
        bits.append("Matched patterns:")
        for m in pm["matches"][:3]:
            bits.append(f"  [{m.get('category')}] {m.get('id')}: {m.get('action_summary','')[:80]}")
    # Arc IV retirement candidates
    eff = _load("output/metrics/hme-invariant-efficacy.json") or {}
    cands = eff.get("retirement_candidates", [])
    if cands:
        bits.append(f"Retirement candidates: {', '.join(cands)}")
    return "\n".join(bits)


def actions():
    na = _load("output/metrics/hme-next-actions.json") or {}
    lines = [f"Harvester: {na.get('total_actions', 0)} action(s)"]
    for a in (na.get("actions") or []):
        lines.append(f"\n[p{a.get('priority')}] {a.get('id')}")
        lines.append(f"  {a.get('summary', '')}")
        for s in (a.get("steps") or [])[:5]:
            lines.append(f"  · {s}")
    return "\n".join(lines)


def drift_view():
    dr = _load("output/metrics/hme-legendary-drift.json") or {}
    lines = [
        f"Drift score: {dr.get('drift_score')} "
        f"(threshold {dr.get('drift_threshold', 2.0)}) status={dr.get('status')}",
        f"Envelope: n={dr.get('envelope_n')} (post-R29: decay=0.85 weighted)",
        "",
    ]
    for o in (dr.get("outliers") or []):
        lines.append(f"  {o['field']:35s} current={o['current']:.3f} "
                     f"median={o['median']:.3f} stdev={o['stdev']:.4f} z={o['z_score']:+.2f}")
    return "\n".join(lines)


def consensus_view():
    con = _load("output/metrics/hme-consensus.json") or {}
    lines = [
        f"Consensus: mean={con.get('mean')} stdev={con.get('stdev')} "
        f"divergence={con.get('divergence')} n={con.get('active_count')}",
        f"Override: {con.get('divergence_override_applied', False)}",
        "",
        "Voters:",
    ]
    for v, s in (con.get("voters") or {}).items():
        marker = " OUTLIER" if any(
            o.get("voter") == v for o in (con.get("outliers") or [])
        ) else ""
        lines.append(f"  {v:22s} = {s}{marker}")
    return "\n".join(lines)


def efficacy_view():
    eff = _load("output/metrics/hme-invariant-efficacy.json") or {}
    classes = eff.get("class_counts", {})
    lines = [
        f"Invariants: total={eff.get('total_invariants')}  runs={eff.get('total_runs')}",
        f"  load-bearing: {classes.get('load-bearing', 0)}",
        f"  load-bearing-historical: {classes.get('load-bearing-historical', 0)}",
        f"  structural: {classes.get('structural', 0)}",
        f"  decorative: {classes.get('decorative', 0)}",
        f"  flappy: {classes.get('flappy', 0)}",
    ]
    cands = eff.get("retirement_candidates", [])
    if cands:
        lines.append(f"Retirement candidates: {', '.join(cands)}")
    top = eff.get("top_load_bearing", [])[:5]
    if top:
        lines.append("Top load-bearing (by commit citations):")
        for t in top:
            lines.append(f"  {t.get('id')} (cites={t.get('commits_citing')})")
    return "\n".join(lines)


def patterns_view():
    import glob
    pm = _load("output/metrics/hme-pattern-matches.json") or {}
    lines = [
        f"Pattern registry: {pm.get('patterns_total', 0)} patterns, "
        f"{pm.get('matches_count', 0)} matched this round",
        "",
    ]
    if pm.get("matches"):
        lines.append("Matched:")
        for m in pm["matches"]:
            lines.append(f"  [{m.get('category')}] {m.get('id')}")
            lines.append(f"    {m.get('action_summary', '')}")
    # Registry catalog
    registry = sorted(glob.glob(os.path.join(PROJECT_ROOT, "tools", "HME", "patterns", "*.json")))
    if registry:
        lines.append("")
        lines.append(f"Registry ({len(registry)} patterns):")
        for p in registry:
            try:
                with open(p) as f:
                    pat = json.load(f)
                lines.append(f"  [{pat.get('category')}] {pat.get('id')}")
            except Exception:
                continue
    return "\n".join(lines)


def diff_view():
    rows = _load_jsonl_tail("output/metrics/hme-arc-timeseries.jsonl", n=5)
    if len(rows) < 2:
        return f"diff: need ≥2 timeseries rows (have {len(rows)})"
    cur, prev = rows[-1], rows[-2]
    lines = ["Arc-over-arc delta vs previous round:"]
    for arc in ("arc_i", "arc_ii", "arc_iii", "arc_iv"):
        c, p = cur.get(arc, {}), prev.get(arc, {})
        for k, v in c.items():
            pv = p.get(k)
            if isinstance(v, (int, float)) and isinstance(pv, (int, float)) and v != pv:
                lines.append(f"  {arc}.{k}: {pv} → {v} (Δ={v - pv:+.3f})")
    return "\n".join(lines)


MODES = {
    "brief": brief,
    "detail": detail,
    "actions": actions,
    "drift": drift_view,
    "consensus": consensus_view,
    "efficacy": efficacy_view,
    "patterns": patterns_view,
    "diff": diff_view,
}


def main(argv):
    mode = "brief"
    for a in argv[1:]:
        if a.startswith("mode="):
            mode = a[5:]
        elif a in MODES:
            mode = a
    fn = MODES.get(mode)
    if not fn:
        print(f"Unknown mode '{mode}'. Available: {', '.join(sorted(MODES.keys()))}", file=sys.stderr)
        return 2
    print(fn())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
