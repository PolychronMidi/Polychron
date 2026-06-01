"""Metric reports: coherence."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from paths import hme_metric
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

logger = logging.getLogger("HME")



def _coherence_report() -> str:
    """Render metrics/hme-coherence.json. Phase 2.3 of openshell feature mapping."""
    path = hme_metric("hme-coherence.json")
    if not os.path.exists(path):
        return (
            "# Round Coherence Score\n\n"
            "tools/HME/runtime/metrics/hme-coherence.json not found.\n"
            "Run: node tools/HME/scripts/pipeline/hme/compute-coherence-score.js"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Round Coherence Score\n\nCould not read: {type(_e).__name__}: {_e}"
    score = data.get("score")
    prev = data.get("previous_score")
    delta = data.get("delta")
    comps = data.get("components", {}) or {}

    def _pct(v):
        try:
            return f"{float(v) * 100:.1f}"
        except (TypeError, ValueError):
            return "N/A"

    # Headline line: when score is null (not enough data), show "N/A" without
    delta_s = ""
    if isinstance(delta, (int, float)):
        sign = "+" if delta >= 0 else ""
        delta_s = f" ({sign}{delta * 100:+.1f} vs prev)"
    window_events = data.get("meta", {}).get("window_events", "?")
    if isinstance(score, (int, float)):
        headline = f"**{_pct(score)}/100**{delta_s}  ({window_events} events in window)"
    else:
        null_reason = data.get("score_null_reason") or comps.get("read_coverage_null_reason") or ""
        headline = f"**N/A** -- score unavailable ({window_events} events in window)"
        if null_reason:
            headline += f"\nReason: {null_reason}"
    # Display labels use *_score (higher=better, 100=perfect) so the "penalty"
    _rcd = comps.get('read_coverage_detail') if isinstance(comps.get('read_coverage_detail'), dict) else {}
    _vd = comps.get('violation_detail') if isinstance(comps.get('violation_detail'), dict) else {}
    _v_count = _vd['count'] if 'count' in _vd else 0
    _v_saturated = " -- SATURATED, >=10 violations indistinguishable" if _v_count >= 10 else ""
    _rc_prior = _rcd['writes_with_prior_read'] if 'writes_with_prior_read' in _rcd else 0
    _rc_total = _rcd['total_writes'] if 'total_writes' in _rcd else 0
    lines = [
        "# Round Coherence Score",
        "",
        headline,
        "",
        "## Components  (100 = perfect; lower is worse)",
        f"  read_coverage   {_pct(comps.get('read_coverage'))}   "
        f"({_rc_prior}/{_rc_total} writes had prior HME read)",
        f"  boundary_score  {_pct(comps.get('violation_penalty'))}   "
        f"({_v_count} boundary violations this round{_v_saturated})",
    ]
    # Gentle interpretation line -- helps users who aren't steeped in the scoring.
    if isinstance(score, (int, float)):
        if score >= 90:
            lines.append("")
            lines.append("Interpretation: HEALTHY -- high read-coverage and few violations.")
        elif score >= 70:
            lines.append("")
            lines.append("Interpretation: ACCEPTABLE -- one or two components dragging; see the lowest above.")
        elif score >= 50:
            lines.append("")
            lines.append("Interpretation: DEGRADED -- address the lowest component before next major change.")
        else:
            lines.append("")
            lines.append("Interpretation: POOR -- coherence is breaking down. Do `i/status mode=blindspots` for specifics.")  # tool-form-ok: prose with embedded command examples
    if prev is not None:
        lines.append("")
        if isinstance(prev, (int, float)) and isinstance(score, (int, float)):
            delta = score - prev
            arrow = "^" if delta > 0.5 else ("v" if delta < -0.5 else "->")
            lines.append(f"Previous round: {_pct(prev)}  ({arrow} {delta:+.1f})")
        else:
            lines.append(f"Previous round: {_pct(prev)}")
    return "\n".join(lines)
