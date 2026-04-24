"""Metric reports: staleness, coherence."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

logger = logging.getLogger("HME")


def _staleness_report() -> str:
    """Render metrics/kb-staleness.json. Phase 2.2 of openshell feature mapping."""
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "kb-staleness.json")
    if not os.path.exists(path):
        return (
            "# KB Staleness Index\n\n"
            "output/metrics/kb-staleness.json not found.\n"
            "Run: python3 scripts/pipeline/build-kb-staleness-index.py"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# KB Staleness Index\n\nCould not read: {type(_e).__name__}: {_e}"
    meta = data.get("meta", {})
    modules = data.get("modules", [])
    by_status = meta.get("by_status", {})
    stale = [m for m in modules if m.get("status") == "STALE"]
    def _stale_key(m):
        _sd = m.get("staleness_days")
        return 0 if _sd is None else _sd
    stale.sort(key=_stale_key, reverse=True)
    missing = [m for m in modules if m.get("status") == "MISSING"]
    lines = [
        "# KB Staleness Index",
        "",
        f"Generated: {meta.get('timestamp_iso', '?')}  "
        f"modules={meta.get('modules_tracked', '?')}  "
        f"KB entries={meta.get('kb_entries_total', '?')}",
        f"Threshold: {meta.get('stale_days_threshold', '?')} days",
        "",
        "## Status counts",
        f"  FRESH   {by_status.get('FRESH', 0)}",
        f"  STALE   {by_status.get('STALE', 0)}",
        f"  MISSING {by_status.get('MISSING', 0)}",
    ]
    if stale:
        lines.append("")
        lines.append("## Stale modules (KB older than code)")
        for m in stale[:25]:
            days = m.get("staleness_days")
            days_s = f"{days:6.1f}d" if isinstance(days, (int, float)) else "  ?"
            lines.append(
                f"  {days_s}  {m.get('module', '?'):<30}  "
                f"{m.get('kb_entries_matched', 0)} hits  {m.get('file_path', '?')}"
            )
        if len(stale) > 25:
            lines.append(f"  … and {len(stale) - 25} more")
    if missing:
        lines.append("")
        lines.append(f"## Modules with no KB coverage ({len(missing)} total, showing first 20)")
        for m in missing[:20]:
            lines.append(f"  - {m.get('module', '?')}  ({m.get('file_path', '?')})")
    return "\n".join(lines)


def _coherence_report() -> str:
    """Render metrics/hme-coherence.json. Phase 2.3 of openshell feature mapping."""
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-coherence.json")
    if not os.path.exists(path):
        return (
            "# Round Coherence Score\n\n"
            "output/metrics/hme-coherence.json not found.\n"
            "Run: node scripts/pipeline/compute-coherence-score.js"
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
    # the "/100" suffix — the slash implies a denominator that doesn't apply
    # when the numerator is missing.
    delta_s = ""
    if isinstance(delta, (int, float)):
        sign = "+" if delta >= 0 else ""
        delta_s = f" ({sign}{delta * 100:+.1f} vs prev)"
    window_events = data.get("meta", {}).get("window_events", "?")
    if isinstance(score, (int, float)):
        headline = f"**{_pct(score)}/100**{delta_s}  ({window_events} events in window)"
    else:
        null_reason = data.get("score_null_reason") or comps.get("read_coverage_null_reason") or ""
        headline = f"**N/A** — score unavailable ({window_events} events in window)"
        if null_reason:
            headline += f"\nReason: {null_reason}"
    # Display labels use *_score (higher=better, 100=perfect) so the "penalty"
    # word doesn't conflict with the header. Underlying JSON keys are kept as
    # *_penalty for backward-compat with downstream parsers.
    _rcd = comps.get('read_coverage_detail') if isinstance(comps.get('read_coverage_detail'), dict) else {}
    _vd = comps.get('violation_detail') if isinstance(comps.get('violation_detail'), dict) else {}
    _sd = comps.get('staleness_detail') if isinstance(comps.get('staleness_detail'), dict) else {}
    _v_count = _vd['count'] if 'count' in _vd else 0
    _v_saturated = " — SATURATED, >=10 violations indistinguishable" if _v_count >= 10 else ""
    _rc_prior = _rcd['writes_with_prior_read'] if 'writes_with_prior_read' in _rcd else 0
    _rc_total = _rcd['total_writes'] if 'total_writes' in _rcd else 0
    _st_touched = _sd['touches_on_stale_or_missing'] if 'touches_on_stale_or_missing' in _sd else 0
    _st_withinfo = _sd['touches_with_index_info'] if 'touches_with_index_info' in _sd else 0
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
        f"  kb_freshness    {_pct(comps.get('staleness_penalty'))}   "
        f"({_st_touched}/{_st_withinfo} writes touched stale/missing-KB modules)",
    ]
    # Gentle interpretation line — helps users who aren't steeped in the scoring.
    if isinstance(score, (int, float)):
        if score >= 90:
            lines.append("")
            lines.append("Interpretation: HEALTHY — high read-coverage, few violations, KB tracks code.")
        elif score >= 70:
            lines.append("")
            lines.append("Interpretation: ACCEPTABLE — one or two components dragging; see the lowest above.")
        elif score >= 50:
            lines.append("")
            lines.append("Interpretation: DEGRADED — address the lowest component before next major change.")
        else:
            lines.append("")
            lines.append("Interpretation: POOR — KB/code alignment is breaking down. Do `i/status mode=staleness` + `i/status mode=blindspots` for specifics.")
    if prev is not None:
        lines.append("")
        if isinstance(prev, (int, float)) and isinstance(score, (int, float)):
            delta = score - prev
            arrow = "↑" if delta > 0.5 else ("↓" if delta < -0.5 else "→")
            lines.append(f"Previous round: {_pct(prev)}  ({arrow} {delta:+.1f})")
        else:
            lines.append(f"Previous round: {_pct(prev)}")
    return "\n".join(lines)
