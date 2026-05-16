"""Mode handlers -- extracted from mode_handlers.py.
mode_handlers.py imports back and registers in _STATUS_MODES.
"""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import (
    _track, get_session_intent, _budget_gate, _budget_section, _git_run,
    BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION,
)
from ..synthesis_session import (
    append_session_narrative, get_session_narrative, get_think_history_context,
)

logger = logging.getLogger("HME")


def _mode_multi_axis_band():
    """Horizon II expansion -- multi-axis bands.

    Today's chaordic band is [55, 85] for the aggregate HCI score, one
    homeostat across all dimensions. The chaordic edge is N-dimensional;
    a system can be over-ordered along structural-integrity AND
    under-ordered along freshness simultaneously, and the aggregate
    band hides both.

    This view computes the per-subtag HCI sub-score (sum of weighted
    PASS/FAIL/WARN scores within each subtag) and reports each axis's
    position relative to a default [0.55, 0.85] band. Turns the single
    homeostat into N independent ones -- agent reads which axes are
    saturated, which are starving, which are healthy.
    """
    import os as _os
    import json as _json
    import sys as _sys
    from collections import defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    snap_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    if not _os.path.isfile(snap_path):
        return ("# i/status mode=multi-axis-band\n"
                "No snapshot -- run `python3 tools/HME/scripts/verify-coherence.py` first.")
    try:
        with open(snap_path) as _f:
            snap = _json.load(_f)
    except (OSError, ValueError) as e:
        return f"# i/status mode=multi-axis-band\nFailed to read snapshot: {e}"

    _scripts = _os.path.join(_root, "tools", "HME", "scripts")
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception as e:
        return f"# i/status mode=multi-axis-band\nFailed to import REGISTRY: {e}"

    # Index verifiers by name for subtag + weight lookup
    name_to_meta: dict[str, tuple[str, float]] = {}
    for v in REGISTRY:
        name_to_meta[v.name] = (
            getattr(v, "subtag", "(none)"),
            float(getattr(v, "weight", 1.0)),
        )

    # Aggregate per subtag: weighted-score sum / weighted-max sum.
    by_subtag: dict[str, list[tuple[float, float]]] = defaultdict(list)
    raw_scores_by_subtag: dict[str, list[float]] = defaultdict(list)
    for name, info in snap.get("verifiers", {}).items():
        meta = name_to_meta.get(name)
        if meta is None:
            continue
        subtag, weight = meta
        score = float(info.get("score", 0.0))
        by_subtag[subtag].append((score * weight, weight))
        raw_scores_by_subtag[subtag].append(score)

    LO, HI = 0.55, 0.85

    # Read persisted band proposal (Horizon IX * II compounding) -- if a
    proposal_path = _os.path.join(_root, "tmp", "hme-band-proposal.json")
    per_axis_bands: dict[str, list[float]] = {}
    proposed_aggregate = None
    if _os.path.isfile(proposal_path):
        try:
            with open(proposal_path) as _pf:
                _proposal = _json.load(_pf)
            proposed_aggregate = _proposal.get("proposed_band")
            for subtag, axis in (_proposal.get("per_axis") or {}).items():
                _band = axis.get("proposed_band")
                if isinstance(_band, list) and len(_band) == 2:
                    per_axis_bands[subtag] = _band
        except (OSError, ValueError):
            pass  # silent-ok: best-effort fs op

    out = [f"# Multi-axis chaordic bands  (per-subtag HCI; default band [{LO}, {HI}])"]
    if proposed_aggregate:
        out.append(f"  proposed aggregate band: [{proposed_aggregate[0]:.2f}, {proposed_aggregate[1]:.2f}]  (from tmp/hme-band-proposal.json)")
    out.append("")
    out.append(f"  {'subtag':24}  {'verifiers':>9}  {'score':>5}  {'min':>5}  {'state':>9}  {'band':>14}")
    rows = []
    for subtag, pairs in sorted(by_subtag.items()):
        if not pairs:
            continue
        weighted_total = sum(p[0] for p in pairs)
        weight_sum = sum(p[1] for p in pairs) or 1.0
        score = weighted_total / weight_sum
        if score < LO:
            state = "BELOW"
        elif score > HI:
            state = "ABOVE"
        else:
            state = "IN_BAND"
        rows.append((subtag, len(pairs), score, state))
    rows.sort(key=lambda r: (r[3] != "IN_BAND", -r[2]))
    for subtag, n, score, state in rows:
        marker = " " if state == "IN_BAND" else "!"
        # Prefer per-axis band when persisted, else aggregate
        ax_band = per_axis_bands.get(subtag) or proposed_aggregate or [LO, HI]
        band_str = f"[{ax_band[0]:.2f}, {ax_band[1]:.2f}]"
        # Confidence: minimum raw score in the subtag. A subtag where
        raw = raw_scores_by_subtag.get(subtag, [])
        min_raw = min(raw) if raw else 0.0
        out.append(f"  {marker} {subtag:22}  {n:>9}  {score:>5.2f}  {min_raw:>5.2f}  {state:>9}  {band_str:>14}")

    out.append("")
    # Conjugate-channel quadrant inline (Horizon V * II compounding):
    snap_v = snap.get("verifiers", {}).get("conjugate-channel")
    if snap_v:
        cur_status = snap_v.get("status", "?")
        out.append(f"  conjugate-channel: {cur_status}  "
                   f"(score={snap_v.get('score', 0):.2f}; "
                   f"see `i/status mode=conjugate` for full quadrant view)")  # tool-form-ok: drill-in advisory
        out.append("")
    out.append("# Reading the table:")
    out.append("  - BELOW band = axis is starved (too few PASSes / too low weighted score)")
    out.append("  - ABOVE band = axis is saturated (everything green; could license exploration)")
    out.append("  - IN_BAND = healthy chaordic edge for this axis")
    out.append("")
    out.append("  The default [0.55, 0.85] band is shared across axes today.")
    out.append("  Future expansion: per-axis learned bands tuned from ground-truth")
    out.append("  signature per subtag (Horizon IX * Horizon II compounding).")
    return "\n".join(out)


def _mode_conjugate():
    """Horizon V seed -- composition<=>HME conjugate channel.

    The two coherences (HCI = HME's self-coherence, perceptual = the
    music's coherence) have always been tracked in parallel but never
    plotted together. This view joins them per round and classifies into
    quadrants:
      - high-both           = mature stability
      - high-HCI low-perc   = sterile rigor (well-organized but lifeless)
      - low-HCI high-perc   = lucky chaos (good music despite mess)
      - low-both            = lost
    Threshold defaults: HCI=0.85 (current band upper), perc=0.5 (median).
    """
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    mc_path = _os.path.join(_root, "output", "metrics", "hme-musical-correlation.json")
    if not _os.path.isfile(mc_path):
        return ("# i/status mode=conjugate\n"
                "No musical-correlation file at output/metrics/hme-musical-correlation.json")
    try:
        with open(mc_path) as _f:
            mc = _json.load(_f)
    except (OSError, ValueError) as e:
        return f"# i/status mode=conjugate\nFailed to read: {e}"

    history = list(mc.get("history", []))
    if mc.get("latest"):
        history.append(mc["latest"])
    if not history:
        return "# i/status mode=conjugate\nNo per-round history yet."

    # Pull rounds that have both signals
    rounds = []
    for r in history:
        hci = r.get("hme_coherence")
        perc = r.get("perceptual_complexity_avg")
        if isinstance(hci, (int, float)) and isinstance(perc, (int, float)):
            rounds.append({
                "round_id": r.get("round_id", "?"),
                "verdict": r.get("fingerprint_verdict", "?"),
                "hci": hci,
                "perc": perc,
            })
    if not rounds:
        return ("# i/status mode=conjugate\n"
                "No rounds carry both hme_coherence + perceptual_complexity_avg.")

    # Quadrant thresholds -- data-driven medians since `hme_coherence`
    sorted_hci = sorted(r["hci"] for r in rounds)
    sorted_perc = sorted(r["perc"] for r in rounds)
    HCI_T = sorted_hci[len(sorted_hci) // 2]
    PERC_T = sorted_perc[len(sorted_perc) // 2]
    quads = {"mature": [], "sterile": [], "lucky": [], "lost": []}
    for r in rounds:
        hh = r["hci"] >= HCI_T
        pp = r["perc"] >= PERC_T
        if hh and pp:
            quads["mature"].append(r)
        elif hh and not pp:
            quads["sterile"].append(r)
        elif not hh and pp:
            quads["lucky"].append(r)
        else:
            quads["lost"].append(r)

    def _avg(rs, key):
        if not rs:
            return None
        return sum(r[key] for r in rs) / len(rs)

    out = [f"# Conjugate channel -- composition <=> HME ({len(rounds)} rounds joined)"]
    out.append(f"  thresholds: HCI >= {HCI_T:.2f} . perceptual >= {PERC_T:.2f}  (medians; partition is data-driven)")
    out.append("")
    out.append(f"  {'quadrant':18}  {'rounds':>6}  {'avg HCI':>8}  {'avg perc':>9}  meaning")
    rows = [
        ("mature stability",   quads["mature"],  "high-both: well-organized + alive"),
        ("sterile rigor",      quads["sterile"], "high-HCI low-perc: organized but lifeless"),
        ("lucky chaos",        quads["lucky"],   "low-HCI high-perc: alive despite mess"),
        ("lost",               quads["lost"],    "low-both: organize OR vivify next round"),
    ]
    for label, rs, meaning in rows:
        avg_hci = _avg(rs, "hci")
        avg_perc = _avg(rs, "perc")
        avg_hci_s = f"{avg_hci:.2f}" if avg_hci is not None else "-"
        avg_perc_s = f"{avg_perc:.2f}" if avg_perc is not None else "-"
        out.append(f"  {label:18}  {len(rs):>6}  {avg_hci_s:>8}  {avg_perc_s:>9}  {meaning}")

    # Latest round
    latest = rounds[-1]
    if latest["hci"] >= HCI_T and latest["perc"] >= PERC_T:
        cur_q = "mature stability"
    elif latest["hci"] >= HCI_T:
        cur_q = "sterile rigor"
    elif latest["perc"] >= PERC_T:
        cur_q = "lucky chaos"
    else:
        cur_q = "lost"
    out.append("")
    out.append(f"## Latest round ({latest['round_id'][:24]}):")
    out.append(f"  HCI={latest['hci']:.2f}  perc={latest['perc']:.2f}  verdict={latest['verdict']}")
    out.append(f"  quadrant: {cur_q}")
    return "\n".join(out)


def _compute_per_axis_band(sentiment_buckets: dict) -> list:
    """Given a per-axis sentiment->[hci] mapping, compute proposed band
    bounds. Lower = median of negative-axis verdicts; upper = median of
    positive-axis verdicts. Falls back to default [0.55, 0.85] when
    not enough per-axis data."""
    POS = {"legendary", "compelling", "surprising", "moving"}
    NEG = {"flat", "mechanical", "boring", "broken"}
    pos_h = []
    neg_h = []
    for sent, vals in sentiment_buckets.items():
        if sent in POS:
            pos_h.extend(vals)
        elif sent in NEG:
            neg_h.extend(vals)
    pos_h.sort()
    neg_h.sort()
    upper = pos_h[len(pos_h) // 2] / 100.0 if pos_h else 0.85
    lower = neg_h[len(neg_h) // 2] / 100.0 if neg_h else 0.55
    return [lower, upper]


