"""Status-mode handlers (_mode_* wrappers) + _STATUS_MODES registry + _list_modes."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

# Cross-submodule report-function imports used by the _STATUS_MODES registry
# lambdas below. These functions live in the report modules; the lambdas
# invoke them by bare name, so they must be importable here at module scope.
from .resource_reports import _vram_report, _freshness_report, _budget_report
from .lifecycle_reports import (
    _resume_briefing, _evolution_priority_report, _trajectory_report,
)
from .metric_reports import _staleness_report, _coherence_report

logger = logging.getLogger("HME")


def _mode_pipeline():
    from ..digest import check_pipeline as _cp
    return _cp()

def _mode_health():
    from ..health import codebase_health as _ch
    return _ch()

def _mode_coupling():
    from ..coupling import coupling_intel as _ci
    # Status surface uses the lighter `network` view (just topology — the
    # one sub-section users actually consume in a status check). The full
    # 4-section view (network + antagonists + personalities + gaps) takes
    # ~45s and belongs behind an explicit `i/hme coupling_intel mode=full`.
    return _budget_gate(_ci(mode="network"))

def _mode_trust():
    from ..trust_analysis import trust_report as _tr
    return _tr("", "")

def _mode_hme():
    """HME session state — distinct from selftest (pre-flight readiness).
    Surfaces: onboarding step, last activity events, current verdict.
    For pre-flight readiness (PASS/FAIL count + warnings), use
    `i/hme-admin action=selftest`."""
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    out = ["## HME session state",
           "(For pre-flight check use `i/hme-admin action=selftest`.)",
           ""]

    # Onboarding state
    onb_file = _os.path.join(_root, "tmp", "hme-onboarding.state")
    onb_state = "graduated"
    if _os.path.isfile(onb_file):
        try:
            with open(onb_file) as _f:
                onb_state = _f.read().strip() or "graduated"
        except OSError:
            pass
    out.append(f"  onboarding: {onb_state}")

    # Pipeline verdict
    verdict_file = _os.path.join(_root, "output", "metrics", "fingerprint-comparison.json")
    if _os.path.isfile(verdict_file):
        try:
            with open(verdict_file) as _f:
                _v = _json.load(_f)
            out.append(f"  last pipeline verdict: {_v.get('verdict', '?')}")
        except (OSError, ValueError):
            pass

    # Recent activity (last 15 events, run-length-collapsed)
    activity_file = _os.path.join(_root, "output", "metrics", "hme-activity.jsonl")
    if _os.path.isfile(activity_file):
        try:
            with open(activity_file) as _f:
                _lines = _f.readlines()[-15:]
            out.append("")
            out.append("recent activity:")
            _last_key = None
            _count = 0
            def _flush():
                if _last_key:
                    _ev, _src = _last_key
                    _label = f"{_ev}  {_src}".strip()
                    out.append(f"  {f'{_count}× ' if _count > 1 else ''}{_label}")
            for _ln in _lines:
                try:
                    _e = _json.loads(_ln)
                except ValueError:
                    continue
                _key = (_e.get("event", "?"), _e.get("source", _e.get("session", "")))
                if _key == _last_key:
                    _count += 1
                else:
                    _flush()
                    _last_key = _key
                    _count = 1
            _flush()
        except OSError:
            pass

    return "\n".join(out)

def _mode_activity():
    from ..activity_digest import activity_digest as _ad
    return _ad(window="round")


def _mode_hci_diff():
    """Show what verifier statuses changed since the last HCI engine run.
    Compares hci-verifier-snapshot.json (current) against .prev (previous);
    surfaces only verifiers whose status changed or whose score moved by
    more than 0.05. Best-effort: if .prev is absent, says so."""
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    cur_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    prev_path = cur_path + ".prev"
    if not _os.path.isfile(cur_path):
        return ("# i/status mode=hci-diff\n"
                "No snapshot found — run `python3 tools/HME/scripts/verify-coherence.py` first.")
    if not _os.path.isfile(prev_path):
        return ("# i/status mode=hci-diff\n"
                "No prior snapshot to diff — run the engine twice (once to seed .prev).")
    try:
        with open(cur_path) as _f:
            cur = _json.load(_f)
        with open(prev_path) as _f:
            prev = _json.load(_f)
    except (OSError, ValueError) as _e:
        return f"# i/status mode=hci-diff\nsnapshot read failed: {_e}"

    cur_v = cur.get("verifiers", {})
    prev_v = prev.get("verifiers", {})
    status_changes = []
    score_moves = []
    added = sorted(set(cur_v) - set(prev_v))
    removed = sorted(set(prev_v) - set(cur_v))
    for name in sorted(set(cur_v) & set(prev_v)):
        cs, ps = cur_v[name].get("status"), prev_v[name].get("status")
        cscore = float(cur_v[name].get("score") or 0)
        pscore = float(prev_v[name].get("score") or 0)
        if cs != ps:
            status_changes.append(f"  {name:36}  {ps} → {cs}")
        elif abs(cscore - pscore) >= 0.05:
            arrow = "↑" if cscore > pscore else "↓"
            score_moves.append(f"  {name:36}  {pscore:.2f} {arrow} {cscore:.2f}")

    out = ["# HCI verifier diff (current vs .prev snapshot)"]
    out.append(f"  HCI: {prev.get('hci', '?')} → {cur.get('hci', '?')}")
    out.append("")
    if status_changes:
        out.append("status changes:")
        out.extend(status_changes)
        out.append("")
    if score_moves:
        out.append("score moves (≥0.05):")
        out.extend(score_moves)
        out.append("")
    if added:
        out.append(f"added verifiers ({len(added)}): {', '.join(added)}")
    if removed:
        out.append(f"removed verifiers ({len(removed)}): {', '.join(removed)}")
    if not (status_changes or score_moves or added or removed):
        out.append("(no verifier status changes; no score moves ≥0.05)")
    return "\n".join(out)


def _mode_race_stats():
    """Summarize recent local-vs-cloud race outcomes from
    hme-race-outcomes.jsonl. Helps tune _RACE_CLOUD_DELAY_SEC — if local
    wins ≥80% of races, the delay can probably be raised (less wasted
    cloud work); if cloud wins often, either delay is too long or local
    is the bottleneck for these query shapes."""
    import os as _os
    import json as _json
    from server import context as _ctx
    out_dir = _os.environ.get("METRICS_DIR") or _os.path.join(
        getattr(_ctx, "PROJECT_ROOT", "."), "output", "metrics")
    path = _os.path.join(out_dir, "hme-race-outcomes.jsonl")
    if not _os.path.isfile(path):
        return "## Race Stats\n  (no races run yet — hme-race-outcomes.jsonl absent)"
    try:
        # Scan last 128KB of the log
        size = _os.path.getsize(path)
        read_from = max(0, size - 128 * 1024)
        with open(path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            text = f.read().decode("utf-8", errors="replace")
    except OSError as _err:
        return f"## Race Stats\n  (read failed: {_err})"
    entries: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(_json.loads(line))
        except _json.JSONDecodeError:
            continue
    if not entries:
        return "## Race Stats\n  (log empty)"
    tally: dict[str, int] = {}
    lat_local: list[int] = []
    lat_cloud: list[int] = []
    for e in entries:
        tally[e.get("winner", "?")] = tally.get(e.get("winner", "?"), 0) + 1
        if isinstance(e.get("local_ms"), int):
            lat_local.append(e["local_ms"])
        if isinstance(e.get("cloud_ms"), int):
            lat_cloud.append(e["cloud_ms"])
    total = len(entries)
    lines = [
        "## Race Stats",
        f"  sample: {total} races (last ~128KB of hme-race-outcomes.jsonl)",
        "",
        "  Winner distribution:",
    ]
    for w, n in sorted(tally.items(), key=lambda x: -x[1]):
        pct = (n * 100) // total
        lines.append(f"    {w:<12} {n:>5}  ({pct}%)")
    if lat_local:
        lat_local.sort()
        p50 = lat_local[len(lat_local) // 2]
        p95 = lat_local[int(len(lat_local) * 0.95)]
        lines.append(f"\n  local  latency: p50={p50}ms  p95={p95}ms  (n={len(lat_local)})")
    if lat_cloud:
        lat_cloud.sort()
        p50 = lat_cloud[len(lat_cloud) // 2]
        p95 = lat_cloud[int(len(lat_cloud) * 0.95)]
        lines.append(f"  cloud  latency: p50={p50}ms  p95={p95}ms  (n={len(lat_cloud)})")
    lines.append("")
    lines.append(f"  Tuning tip: `_RACE_CLOUD_DELAY_SEC` currently 2.5s. "
                 f"If local wins ≥80% raise it; if cloud wins most races the delay "
                 f"may be cutting local work off early — investigate.")
    return "\n".join(lines)


def _mode_learn_suggestions():
    """Surface `productive_incoherence` events — modules the agent edited
    with MISSING KB coverage. The event was already being emitted by
    posttooluse_edit.sh but no consumer read it; this mode closes that loop.

    Shows, per module: file path, module name, session, timestamp (latest
    first). Up to 20 entries from the last round. Agent can drive a
    `learn()` pass to capture the novel findings those edits represent.
    """
    import os as _os
    import json as _json
    from server import context as _ctx
    activity_path = _os.path.join(
        _os.environ.get("METRICS_DIR") or _os.path.join(_ctx.PROJECT_ROOT, "output", "metrics"),
        "hme-activity.jsonl",
    )
    if not _os.path.isfile(activity_path):
        return "## Learn Suggestions\n  (no activity log yet)"
    # Scan last 256KB for recency + productive_incoherence events
    try:
        size = _os.path.getsize(activity_path)
        read_from = max(0, size - 256 * 1024)
        with open(activity_path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            text = f.read().decode("utf-8", errors="replace")
    except OSError as _err:
        return f"## Learn Suggestions\n  (activity log unreadable: {_err})"
    events: list[dict] = []
    last_round_idx = -1
    all_lines = text.splitlines()
    for i, line in enumerate(all_lines):
        if not line.strip():
            continue
        try:
            ev = _json.loads(line)
        except _json.JSONDecodeError:
            continue
        if ev.get("event") == "round_complete":
            last_round_idx = i
        if ev.get("event") == "productive_incoherence":
            events.append(ev)
    if not events:
        return "## Learn Suggestions\n  No productive_incoherence events this round — every edit landed in KB-covered territory, or no edits this round."
    # Dedup by (file, module); keep most recent timestamp per key.
    # Activity events are emitted by tools/HME/activity/emit.py which always
    # sets `ts` — direct index is safe. Historic entries without ts are
    # filtered earlier by `ev.get("event")` which returns a non-event mark
    # for malformed lines.
    def _ts(ev: dict) -> float:
        t = ev.get("ts")
        return t if isinstance(t, (int, float)) else 0.0
    latest: dict[tuple, dict] = {}
    for ev in events:
        key = (ev.get("file", ""), ev.get("module", ""))
        if key in latest and _ts(latest[key]) >= _ts(ev):
            continue
        latest[key] = ev
    rows = sorted(latest.values(), key=_ts, reverse=True)[:20]
    lines = [
        "## Learn Suggestions",
        f"  {len(rows)} module(s) edited with MISSING KB coverage this round. "
        f"Each is a candidate for `learn()` to capture what those edits encode.",
        "",
    ]
    for ev in rows:
        mod = ev.get("module", "?")
        f = ev.get("file", "?")
        lines.append(f"  - {mod}  ({f})")
    lines.append("")
    lines.append("  Capture with: `learn(title='<concise>', content='<2-3 sentences>', category='architecture|pattern|decision')`")
    return "\n".join(lines)

def _mode_blindspots():
    from ..blindspots import blindspots as _bs
    return _bs()

def _mode_hypotheses():
    from ..hypothesis_registry import hypotheses_report as _hr
    return _hr()

def _mode_drift():
    from ..semantic_drift_report import semantic_drift_report as _sd
    return _sd()

def _mode_accuracy():
    from ..prediction_accuracy import prediction_accuracy_report as _pa
    return _pa()

def _mode_crystallized():
    from ..crystallizer import crystallized_report as _cr
    return _cr()

def _mode_music_truth():
    from ..epistemic_reports import music_truth_report as _mt
    return _mt()

def _mode_kb_trust():
    from ..epistemic_reports import kb_trust_report as _kt
    return _kt()

def _mode_intention_gap():
    from ..epistemic_reports import intention_gap_report as _ig
    return _ig()

def _mode_self_audit():
    from ..self_audit import self_audit_report as _sa
    return _sa()

def _mode_probes():
    from ..probe import probes_report as _pr
    return _pr()

def _mode_negative_space():
    from ..negative_space import negative_space_report as _ns
    return _ns()

def _mode_cognitive_load():
    from ..cognitive_load import cognitive_load_report as _cl
    return _cl()

def _mode_ground_truth():
    from ..ground_truth import ground_truth_report as _gt
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
    from ..multi_agent import multi_agent_report as _ma
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
    from ..evolution.evolution_admin import hme_introspect as _hi
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
    "hci-diff": _mode_hci_diff,
    "hci_diff": _mode_hci_diff,
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
    # Exploratory-edit signal: modules you edited this round that lack KB
    # coverage — `learn()` candidates that the old loop never surfaced.
    "learn_suggestions": _mode_learn_suggestions,
    "novel_modules": _mode_learn_suggestions,   # alias
    # Local-vs-cloud race outcomes from _reasoning_think's race-mode path.
    "race_stats": _mode_race_stats,
}
