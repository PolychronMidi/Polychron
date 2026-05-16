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
from .status_modes_band import _compute_per_axis_band  # noqa: F401

logger = logging.getLogger("HME")




def _mode_band_tuning():
    """Horizon IX seed -- chaordic band as a learned controllable.

    Reads output/metrics/hme-ground-truth.jsonl (human verdicts with
    sentiment tags) and joins each verdict against the HCI timeseries
    at its timestamp. Computes the HCI distribution per sentiment
    bucket. Proposes new band bounds from the data: upper bound near
    the median HCI of legendary/compelling rounds, lower bound near
    the median of mechanical/flat rounds.

    Today's band is fixed [0.55, 0.85] (or [55, 85] in 0-100 scale).
    Self-tuning all the way down: the band itself becomes a function
    of recent ground-truth feedback."""
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))

    gt_path = _os.path.join(_root, "output", "metrics", "hme-ground-truth.jsonl")
    ts_path = _os.path.join(_root, "output", "metrics", "hme-coherence-timeseries.jsonl")

    if not _os.path.isfile(gt_path):
        try:
            from tool_invocations import i_form as _i_form
            _hint = _i_form('learn', value='ground_truth')
        except ImportError:
            _hint = "i/learn action=ground_truth"  # tool-form-ok: fallback
        return ("# i/status mode=band-tuning\n"
                "No ground-truth log at output/metrics/hme-ground-truth.jsonl yet.\n"
                f"Add verdicts via `{_hint}` first.")
    if not _os.path.isfile(ts_path):
        return ("# i/status mode=band-tuning\n"
                "No HCI timeseries -- nothing to join verdicts against.")

    try:
        with open(gt_path) as _f:
            verdicts = [_json.loads(ln) for ln in _f if ln.strip()]
        with open(ts_path) as _f:
            ts_rows = [_json.loads(ln) for ln in _f if ln.strip()]
    except (OSError, ValueError) as e:
        return f"# i/status mode=band-tuning\nFailed to read inputs: {e}"

    # Build sorted HCI history for nearest-neighbor join
    ts_rows = [r for r in ts_rows if r.get("hci") is not None and r.get("ts")]
    ts_rows.sort(key=lambda r: r.get("ts", 0))

    def _hci_at(t: float) -> float | None:
        if not ts_rows:
            return None
        # Find row with ts closest to t (binary-ish search via linear)
        best = min(ts_rows, key=lambda r: abs(r["ts"] - t))
        if abs(best["ts"] - t) > 86400 * 7:  # 7-day max window
            return None
        return float(best["hci"])

    # Bucket verdicts by sentiment, and per-axis if subtag is present.
    # Horizon IX * II asymptote: per-axis verdicts -> per-axis bands.
    buckets: dict[str, list[float]] = {}
    per_axis_buckets: dict[str, dict[str, list[float]]] = {}  # subtag -> sentiment -> [hci]
    for v in verdicts:
        sentiment = v.get("sentiment", "?")
        ts = v.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        hci = _hci_at(float(ts))
        if hci is None:
            continue
        buckets.setdefault(sentiment, []).append(hci)
        # Per-axis when subtag is recorded
        subtag = v.get("subtag", "")
        if subtag:
            per_axis_buckets.setdefault(subtag, {}).setdefault(sentiment, []).append(hci)

    if not buckets:
        return ("# i/status mode=band-tuning\n"
                "No ground-truth verdicts could be joined to HCI timeseries.")

    # Categorize sentiments
    POSITIVE = {"legendary", "compelling", "surprising", "moving"}
    NEGATIVE = {"flat", "mechanical", "boring", "broken"}

    pos_hcis: list[float] = []
    neg_hcis: list[float] = []
    for sent, vals in buckets.items():
        if sent in POSITIVE:
            pos_hcis.extend(vals)
        elif sent in NEGATIVE:
            neg_hcis.extend(vals)

    out = [f"# Chaordic band tuning (from {len(verdicts)} ground-truth verdicts)"]
    out.append("")
    out.append("## HCI distribution by sentiment:")
    for sent in sorted(buckets.keys(), key=lambda s: -len(buckets[s])):
        vals = sorted(buckets[sent])
        median = vals[len(vals) // 2]
        out.append(f"  {sent:14}  n={len(vals):3}  median={median:5.1f}  range=[{vals[0]:.0f}-{vals[-1]:.0f}]")

    # Proposal
    out.append("")
    out.append("## Band proposal:")
    if pos_hcis:
        pos_hcis.sort()
        upper = pos_hcis[len(pos_hcis) // 2]
        out.append(f"  upper bound  ~= {upper:.0f}  (median HCI of {len(pos_hcis)} positive verdicts)")
    else:
        out.append(f"  upper bound  not enough positive verdicts")
    if neg_hcis:
        neg_hcis.sort()
        lower = neg_hcis[len(neg_hcis) // 2]
        out.append(f"  lower bound  ~= {lower:.0f}  (median HCI of {len(neg_hcis)} negative verdicts)")
    else:
        try:
            from tool_invocations import i_form as _i_form
            _gt_hint = _i_form('learn', value='ground_truth')
        except ImportError:
            _gt_hint = "i/learn action=ground_truth"  # tool-form-ok: fallback
        out.append(f"  lower bound  not enough negative verdicts; current default 55 retained")
        out.append(f"               (to inform: tag a flat/mechanical/boring round via")
        out.append(f"                `{_gt_hint} tags=[flat]` when one occurs --")
        out.append(f"                even one negative verdict starts the calibration)")
    # Persist the proposal to tmp/hme-band-proposal.json so downstream
    proposal_path = _os.path.join(_root, "tmp", "hme-band-proposal.json")
    per_axis: dict[str, list[float]] = {}
    # Read the snapshot to get current per-subtag scores; use them as
    snap_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    if _os.path.isfile(snap_path):
        try:
            with open(snap_path) as _sf:
                snap = _json.load(_sf)
            try:
                _sys2 = __import__("sys")
                _scripts2 = _os.path.join(_root, "tools", "HME", "scripts")
                if _scripts2 not in _sys2.path:
                    _sys2.path.insert(0, _scripts2)
                from verify_coherence import REGISTRY as _REG  # type: ignore
                _name_to_subtag = {v.name: getattr(v, "subtag", "(none)") for v in _REG}
                for name, info in snap.get("verifiers", {}).items():
                    subtag = _name_to_subtag.get(name, "(none)")
                    score = float(info.get("score", 0.0))
                    per_axis.setdefault(subtag, []).append(score)
            except Exception as exc:
                logger.debug(f"band tuning verifier-axis read failed: {type(exc).__name__}: {exc}")
        except (OSError, ValueError):
            pass  # silent-ok: best-effort fs op

    proposal = {
        "ts": __import__("time").time(),
        "current_band": [0.55, 0.85],
        "proposed_band": [
            (neg_hcis[len(neg_hcis) // 2] / 100.0) if neg_hcis else 0.55,
            (pos_hcis[len(pos_hcis) // 2] / 100.0) if pos_hcis else 0.85,
        ],
        "n_positive_verdicts": len(pos_hcis),
        "n_negative_verdicts": len(neg_hcis),
        "sentiments": {sent: len(vals) for sent, vals in buckets.items()},
        "per_axis": {
            # For each subtag: current observed_median (from snapshot) AND
            subtag: {
                "observed_median": (sorted(scores)[len(scores) // 2] if scores else 0.0),
                "n_verifiers": len(scores),
                "proposed_band": _compute_per_axis_band(per_axis_buckets.get(subtag, {})),
                "n_axis_verdicts": sum(len(v) for v in per_axis_buckets.get(subtag, {}).values()),
            }
            for subtag, scores in per_axis.items()
        },
        "note": "Advisory proposal. Aggregate proposed_band is learned from ground-truth verdicts; per_axis observed_median is current state, per_axis proposed_band is placeholder until subtag-aware verdicts accumulate.",
    }
    try:
        proposal_tmp = proposal_path + ".tmp"
        with open(proposal_tmp, "w") as _pf:
            _json.dump(proposal, _pf, indent=2)
        _os.replace(proposal_tmp, proposal_path)
        out.append("")
        out.append(f"# Persisted proposal:")
        out.append(f"  tmp/hme-band-proposal.json   (downstream consumers may read)")
    except OSError:
        pass  # silent-ok: best-effort fs op

    out.append("")
    out.append("# Note:")
    out.append("  Today's band [55, 85] is fixed. The proposal above is advisory.")
    out.append("  Future expansion: composition code reads the proposal on round")
    out.append("  start, allowing the band to self-tune as new ground-truth lands.")
    return "\n".join(out)


