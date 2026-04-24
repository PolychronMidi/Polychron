"""Status-mode handlers (_mode_* wrappers) + _STATUS_MODES registry + _list_modes."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

logger = logging.getLogger("HME")


def _mode_pipeline():
    from .digest import check_pipeline as _cp
    return _cp()

def _mode_health():
    from .health import codebase_health as _ch
    return _ch()

def _mode_coupling():
    from .coupling import coupling_intel as _ci
    # Status surface uses the lighter `network` view (just topology — the
    # one sub-section users actually consume in a status check). The full
    # 4-section view (network + antagonists + personalities + gaps) takes
    # ~45s and belongs behind an explicit `i/hme coupling_intel mode=full`.
    return _budget_gate(_ci(mode="network"))

def _mode_trust():
    from .trust_analysis import trust_report as _tr
    return _tr("", "")

def _mode_hme():
    from .evolution.evolution_admin import hme_selftest as _st
    return _st()

def _mode_activity():
    from .activity_digest import activity_digest as _ad
    return _ad(window="round")

def _mode_blindspots():
    from .blindspots import blindspots as _bs
    return _bs()

def _mode_hypotheses():
    from .hypothesis_registry import hypotheses_report as _hr
    return _hr()

def _mode_drift():
    from .semantic_drift_report import semantic_drift_report as _sd
    return _sd()

def _mode_accuracy():
    from .prediction_accuracy import prediction_accuracy_report as _pa
    return _pa()

def _mode_crystallized():
    from .crystallizer import crystallized_report as _cr
    return _cr()

def _mode_music_truth():
    from .epistemic_reports import music_truth_report as _mt
    return _mt()

def _mode_kb_trust():
    from .epistemic_reports import kb_trust_report as _kt
    return _kt()

def _mode_intention_gap():
    from .epistemic_reports import intention_gap_report as _ig
    return _ig()

def _mode_self_audit():
    from .self_audit import self_audit_report as _sa
    return _sa()

def _mode_probes():
    from .probe import probes_report as _pr
    return _pr()

def _mode_negative_space():
    from .negative_space import negative_space_report as _ns
    return _ns()

def _mode_cognitive_load():
    from .cognitive_load import cognitive_load_report as _cl
    return _cl()

def _mode_ground_truth():
    from .ground_truth import ground_truth_report as _gt
    return _gt()

def _mode_constitution():
    from .phase6_reports import constitution_report as _c
    return _c()

def _mode_doc_drift():
    from .phase6_reports import doc_drift_report as _dd
    return _dd()

def _mode_generalizations():
    from .phase6_reports import generalizations_report as _gr
    return _gr()

def _mode_reflexivity():
    from .phase6_reports import reflexivity_report as _rr
    return _rr()

def _mode_multi_agent():
    from .multi_agent import multi_agent_report as _ma
    return _ma()

def _list_modes():
    """Grouped catalogue of mode= options. The bare 'Unknown mode' error
    used to be the only way to discover what was available — that error
    list isn't grouped, isn't described, and gave no hint of aliases."""
    groups = [
        ("Pipeline / data freshness", [
            ("pipeline", "last pipeline run summary"),
            ("freshness", "age of every metric source + sync warnings"),
            ("vram", "GPU usage + 30-min trend sparklines"),
            ("activity", "event counts + read/write coherence"),
            ("budget", "coherence band state + prescription"),
            ("resume", "session briefing: git + pipeline + narrative"),
        ]),
        ("Self-coherence (HME-on-HME)", [
            ("self_audit", "CASCADE_UNRELIABLE / ANCHOR_DEGENERATE flags"),
            ("reflexivity", "clean vs injected prediction-accuracy buckets"),
            ("accuracy", "EMA + per-round confirmed/refuted lists"),
            ("cognitive_load", "session workload vs historical p25/p50/p90"),
            ("introspect", "tool usage breakdown for this session"),
            ("hme", "full HME selftest output"),
            ("health", "codebase line-count / convention / boundary scan"),
            ("doc_drift", "per-doc orphan-reference counts"),
            ("staleness", "FRESH/STALE/MISSING per module"),
        ]),
        ("Evolution / planning", [
            ("priorities", "ranked evolution priorities (alias of `next`)"),
            ("next", "ranked evolution priorities (alias of `priorities`)"),
            ("blindspots", "untouched subsystems + write-without-read modules"),
            ("probes", "adversarial probe candidates"),
            ("hypotheses", "OPEN/CONFIRMED hypothesis registry"),
            ("crystallized", "multi-round patterns + synthesis text"),
            ("generalizations", "patterns that may generalize beyond Polychron"),
            ("constitution", "positive affirmations of what Polychron IS"),
        ]),
        ("Trust / coupling / drift", [
            ("trust", "trust leaderboard with musical roles"),
            ("coupling", "melodic/rhythmic/phase coupling network"),
            ("drift", "Arc III outliers with z-scores"),
            ("trajectory", "verdict + per-signal slope/range"),
            ("kb_trust", "tier distribution + top/bottom entries"),
            ("intention_gap", "todos vs tracked execution"),
            ("negative_space", "feedback-loop near-miss candidates"),
            ("multi_agent", "role distribution"),
        ]),
        ("Music / perception", [
            ("perceptual", "cached EnCodec+CLAP per-section report"),
            ("music_truth", "ground-truth correlations"),
            ("ground_truth", "human listening verdicts"),
            ("coherence", "per-round coherence score breakdown"),
        ]),
    ]
    parts = ["# i/status modes (35+ available)\n"]
    for group_name, items in groups:
        parts.append(f"## {group_name}")
        for name, desc in items:
            parts.append(f"  {name:<18s} {desc}")
        parts.append("")
    parts.append("Pass any name as `i/status mode=<name>` (or `mode=all` for the unified overview).")
    return "\n".join(parts)


def _mode_perceptual():
    # Status is a "quick look" surface — reading the cached report from the
    # last pipeline run is what users actually want, not triggering a fresh
    # (multi-minute) EnCodec+CLAP inference pass. For a live re-run, call
    # `audio_analyze(analysis='both')` directly via i/hme.
    cache_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "perceptual-report.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as _f:
                data = json.load(_f)
            ts = data.get("timestamp", "?")
            confidence = data.get("confidence", 0)
            sections = (data.get("encodec", {}) or {}).get("sections", {}) or {}
            parts = [
                f"# Perceptual Analysis — cached (confidence: {confidence:.0%})",
                f"Source: metrics/perceptual-report.json  (ts={ts})",
                "For a fresh analysis: `i/hme audio_analyze analysis=both`  (takes ~2-5 min)",
                "",
                "## Per-section tension (from EnCodec cb0 entropy)",
            ]
            for sid in sorted(sections.keys(), key=lambda s: int(s) if s.isdigit() else 0):
                s = sections[sid]
                tens = s.get("tension", 0)
                clap = s.get("clap", {}) or {}
                top = sorted(clap.items(), key=lambda kv: -kv[1])[:3]
                top_str = ", ".join(f"{k}={v:+.2f}" for k, v in top)
                parts.append(f"  S{sid}  tension={tens:.3f}  top_clap: {top_str}")
            return "\n".join(parts)
        except (OSError, json.JSONDecodeError, TypeError, KeyError) as _e:
            return f"Perceptual cache read failed: {type(_e).__name__}: {_e}"
    return ("No perceptual-report.json cached. Run `npm run main` (or "
            "`i/hme audio_analyze`) to generate.")

def _mode_introspect():
    from .evolution.evolution_admin import hme_introspect as _hi
    return _hi()


def _mode_signals() -> str:
    """Tail the unified signal bus — the one-file truth of hook + middleware
    + lifecycle events for the current and recent sessions."""
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-signals.jsonl")
    if not os.path.isfile(path):
        return (
            "# HME Signal Bus\n\n"
            "output/metrics/hme-signals.jsonl not yet produced. Hooks emit to it "
            "via _signal_emit (sourced by helpers/_signals.sh). Trigger a few "
            "tool calls and re-check."
        )
    try:
        with open(path, encoding="utf-8") as _f:
            raw = _f.readlines()[-40:]
    except OSError as _e:
        return f"# HME Signal Bus\n\nCould not read: {type(_e).__name__}: {_e}"
    parsed = []
    for ln in raw:
        try:
            parsed.append(_json.loads(ln))
        except (ValueError, TypeError):
            continue
    if not parsed:
        return "# HME Signal Bus\n\nNo parseable entries yet."
    from collections import Counter as _Counter
    counts = _Counter(e.get("event", "?") for e in parsed)
    lines = [
        "# HME Signal Bus",
        "",
        f"Tailing last {len(parsed)} entries from output/metrics/hme-signals.jsonl.",
        "",
        "## Event frequency (this tail)",
    ]
    for ev, n in counts.most_common():
        lines.append(f"  {ev:<30} {n}")
    lines.append("")
    lines.append("## Most recent 10")
    for e in parsed[-10:]:
        lines.append(f"  [{e.get('source', '?'):<20}] {e.get('event', '?'):<22} scope={e.get('scope', '?')}")
    return "\n".join(lines)


# Mode registry
_STATUS_MODES: dict[str, callable] = {
    "resume": lambda: _resume_briefing(),
    "pipeline": _mode_pipeline,
    "health": _mode_health,
    "coupling": _mode_coupling,
    "trust": _mode_trust,
    "perceptual": _mode_perceptual,
    "hme": _mode_hme,
    "activity": _mode_activity,
    "staleness": lambda: _staleness_report(),
    "coherence": lambda: _coherence_report(),
    "blindspots": _mode_blindspots,
    "hypotheses": _mode_hypotheses,
    "drift": _mode_drift,
    "accuracy": _mode_accuracy,
    "crystallized": _mode_crystallized,
    "music_truth": _mode_music_truth,
    "kb_trust": _mode_kb_trust,
    "intention_gap": _mode_intention_gap,
    "self_audit": _mode_self_audit,
    "probes": _mode_probes,
    "trajectory": lambda: _trajectory_report(),
    "budget": lambda: _budget_report(),
    "negative_space": _mode_negative_space,
    "cognitive_load": _mode_cognitive_load,
    "ground_truth": _mode_ground_truth,
    "constitution": _mode_constitution,
    "doc_drift": _mode_doc_drift,
    "generalizations": _mode_generalizations,
    # `priorities` and `next` are intentional aliases — the underlying signal
    # is the same (output/metrics/evolution-priorities.json). Both names exist
    # because users reach for either word; aliasing avoids a "wait, which one?"
    # context-switch and is documented in the mode=list output.
    "priorities": lambda: _evolution_priority_report(),
    "next": lambda: _evolution_priority_report(),
    "reflexivity": _mode_reflexivity,
    "multi_agent": _mode_multi_agent,
    "freshness": lambda: _freshness_report(),
    "vram": lambda: _vram_report(),
    "introspect": _mode_introspect,
    "signals": _mode_signals,
}
