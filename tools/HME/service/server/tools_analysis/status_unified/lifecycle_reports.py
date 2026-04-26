"""Lifecycle reports: resume briefing, evolution priorities, trajectory."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context
import datetime

logger = logging.getLogger("HME")


def _resume_briefing() -> str:
    """Cold-start briefing for context recovery after compaction or new session.

    Synthesizes git state, nexus lifecycle, pipeline verdict, session narrative,
    and think history into a structured briefing optimized for rapid re-orientation.
    """
    parts = ["# Session Resume Briefing\n"]

    # 1. Uncommitted changes (what am I in the middle of?)
    diff_stat = _git_run(["git", "diff", "--stat", "HEAD"], cwd=ctx.PROJECT_ROOT)
    if diff_stat.strip():
        parts.append("## Uncommitted Changes")
        for line in diff_stat.strip().splitlines():
            parts.append(f"  {line.strip()}")
    else:
        parts.append("## Changes: working tree clean")

    # 2. Pipeline verdict + timing
    try:
        summary_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "pipeline-summary.json")
        with open(summary_path, encoding="utf-8") as f:
            ps = json.load(f)
        verdict = ps.get("verdict")
        wall = ps.get("wallTimeSeconds", 0)
        failed = ps.get("failed", 0)
        gen = ps.get("generated", "")[:19]
        errors = ps.get("errorPatterns", [])
        parts.append(f"\n## Pipeline: {verdict or 'no verdict'} ({gen})")
        parts.append(f"  Wall time: {wall:.0f}s | Failed steps: {failed}")
        if errors:
            parts.append(f"  Error patterns: {', '.join(str(e) for e in errors[:3])}")
    except Exception as _err:
        logger.debug(f"unnamed-except status_unified.py:442: {type(_err).__name__}: {_err}")
        parts.append("\n## Pipeline: no summary available")

    # 3. Nexus lifecycle state (bash hook state read directly)
    try:
        nexus_path = os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-nexus.state")
        if os.path.isfile(nexus_path):
            with open(nexus_path, encoding="utf-8") as f:
                nexus_lines = [l.strip() for l in f.readlines() if l.strip()]
            if nexus_lines:
                edits, pipeline_v, has_commit, briefs = [], "", False, []
                for line in nexus_lines:
                    segs = line.split(":", 2)
                    ntype = segs[0]
                    payload = segs[2] if len(segs) > 2 else ""
                    if ntype == "EDIT":
                        edits.append(payload)
                    elif ntype == "PIPELINE":
                        pipeline_v = payload
                    elif ntype == "COMMIT":
                        has_commit = True
                    elif ntype == "BRIEF":
                        briefs.append(payload)
                pending = []
                if edits:
                    pending.append(f"Unreviewed edits ({len(edits)}): {', '.join(edits[:6])}")
                if pipeline_v in ("STABLE", "EVOLVED") and not has_commit:
                    pending.append(f"Pipeline {pipeline_v} but NOT committed")
                if pipeline_v in ("FAILED", "DRIFTED"):
                    pending.append(f"Pipeline {pipeline_v} — needs diagnosis before continuing")
                if pending:
                    parts.append("\n## Lifecycle Pending")
                    for p in pending:
                        parts.append(f"  - {p}")
                if briefs:
                    parts.append(f"  Briefed files: {', '.join(briefs[:5])}")
    except Exception as _err5:
        logger.debug(f'silent-except status_unified.py:478: {type(_err5).__name__}: {_err5}')

    # 4. Session narrative (what has the session been doing?)
    narrative = get_session_narrative(max_entries=12)
    if narrative:
        parts.append(f"\n## Session Thread")
        parts.append(narrative.strip())

    # 5. Think history (prior reasoning exchanges)
    think_ctx = get_think_history_context()
    if think_ctx:
        parts.append(f"\n## Prior Reasoning")
        parts.append(think_ctx.strip())

    # 6. Session intent
    intent = get_session_intent()
    if intent != "unknown":
        parts.append(f"\n## Detected Intent: {intent}")

    # 7. Recent git commits (what was the last thing committed?)
    log_out = _git_run(["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "-5"], cwd=ctx.PROJECT_ROOT)
    if log_out.strip():
        parts.append(f"\n## Recent Commits")
        for line in log_out.strip().splitlines():
            parts.append(f"  {line}")

    return "\n".join(parts)


def _evolution_priority_report() -> str:
    """Render metrics/hme-evolution-priority.json — HME's self-directed roadmap."""
    _track("evolution_priority_report")
    ppath = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-evolution-priority.json")
    if not os.path.exists(ppath):
        return "# Evolution Priorities\n\nNo priority data — run pipeline first.\n"
    try:
        data = json.load(open(ppath))
        priorities = data.get("priorities", [])
        if not priorities:
            return "# Evolution Priorities\n\nNo priorities generated.\n"
        # Compute staleness of the report — the underlying file only
        # regenerates on pipeline runs. Without a freshness indicator the
        # user can't tell whether w=0.65 reflects the current session
        # or a snapshot from 8 hours ago.
        ts_str = data["meta"].get("timestamp", "")
        stale_note = ""
        try:
            from datetime import datetime, timezone
            import re as _re_ts
            # Handle both Z-suffixed ISO and plain strings.
            _norm = _re_ts.sub(r"Z$", "+00:00", ts_str)
            ts = datetime.fromisoformat(_norm)
            age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
            if age_h > 24:
                stale_note = f"  ⚠ STALE ({age_h:.1f}h old — re-run `npm run main` for current priorities)"
            elif age_h > 2:
                stale_note = f"  ({age_h:.1f}h old)"
        except Exception as _ts_err:
            logger.debug(f"status_unified: ts staleness calc skipped: {type(_ts_err).__name__}: {_ts_err}")
        lines = [
            "# HME Evolution Priorities",
            "",
            f"*{data['meta']['priorities_generated']} priorities from {data['meta']['signals_aggregated']} signal sources*",
            f"*Generated: {ts_str}*{stale_note}",
            "",
            "*Weight scale: 0.0–1.0. ≥0.60 = high-signal / act soon. "
            "0.30–0.59 = notable but not urgent. <0.30 = background noise.*",
            "",
        ]
        for p in priorities[:10]:
            r = p.get("rationale", "")
            ev = p.get("evidence", [{}])[0]
            w = p.get('weight', 0)
            # Inline weight tier so the scale is evident per-item.
            tier = "HIGH" if w >= 0.60 else ("MED" if w >= 0.30 else "low")
            lines.append(f"**#{p['rank']}** [{p['category']}] **{p['target']}** (w={w:.2f} {tier})")
            if r:
                lines.append(f"  {r}")
            lines.append(f"  evidence: {ev.get('source', '?')} → {ev.get('signal', '?')}")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"# Evolution Priorities\n\nError loading: {e}\n"


def _trajectory_report() -> str:
    """Render metrics/hme-trajectory.json (Phase 5.1)."""
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-trajectory.json")
    if not os.path.exists(path):
        return (
            "# Compositional Trajectory\n\n"
            "output/metrics/hme-trajectory.json not found.\n"
            "Run: node scripts/pipeline/compute-compositional-trajectory.js"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Compositional Trajectory\n\nCould not read: {type(_e).__name__}: {_e}"
    meta = data.get("meta", {}) or {}
    verdict = data.get("verdict", "?")
    signals = data.get("signals", {}) or {}
    history = data.get("history", []) or []
    lines = [
        "# Compositional Trajectory",
        "",
        f"**Verdict:** {verdict}",
        f"Window: {meta.get('rounds_used', '?')}/{meta.get('window', '?')} rounds",
        "",
        "## Per-signal analysis",
    ]
    for k, s in signals.items():
        slope = s.get("slope")
        slope_s = f"{slope:+.5f}" if isinstance(slope, (int, float)) else "n/a"
        rng = s.get("range")
        rng_s = f"[{rng[0]:.3f}, {rng[1]:.3f}]" if isinstance(rng, list) and len(rng) == 2 else "n/a"
        lines.append(f"  {k:<30} {s.get('verdict', '?'):<12}  slope={slope_s}  range={rng_s}")
    if history:
        recent = history[-5:]
        lines.append("")
        lines.append("## Recent verdict history")
        for h in recent:
            lines.append(f"  {h.get('timestamp', '?')[-19:-5]}  {h.get('verdict', '?')}")
        # Streak detection: same verdict N+ rounds = chronic state.
        last = history[-1].get("verdict") if history else None
        streak = 0
        for h in reversed(history):
            if h.get("verdict") == last:
                streak += 1
            else:
                break
        if last and streak >= 3:
            lines.append("")
            lines.append(f"**{last}** has been the verdict for {streak} consecutive rounds.")
    # Interpretation + suggested next step keyed off the verdict.
    _GUIDANCE = {
        "GROWING": "Composition is acquiring more variety/complexity over the window. Confirm the perceptual signal you're tracking is the one you intended to grow.",
        "DECLINING": "Composition is losing variety/intensity. Likely causes: a recent change reduced the signal it was driving, a regime is overstaying, or a recent profile shift dampened diversity. Inspect with `i/status mode=accuracy` (which predictions failed?) and `i/review mode=regime` (which sections went monotone?).",
        "PLATEAU": "Slope near zero — the signal is stable, not necessarily good. If you wanted growth, this means the lever is broken; if you wanted equilibrium, this is success.",
        "OSCILLATING": "Signal is bouncing — likely a feedback loop tuning back-and-forth. Look at `i/substrate diff` to see what changed last round and `i/status mode=trust` for the destabilizing system.",
    }
    if verdict in _GUIDANCE:
        lines.append("")
        lines.append("## Interpretation")
        lines.append(_GUIDANCE[verdict])
    return "\n".join(lines)


