"""HME evolution intelligence — next-evolution suggestions powered by synthesis."""
import json
import os
import logging

from server import context as ctx
from .synthesis import _get_api_key, _think_local_or_claude
from . import _track, _load_trace

logger = logging.getLogger("HME")


def _rank_by_cluster_pull(coupling_state: dict, trace_records: list, top_n: int = 8) -> list:
    """Rank uncoupled modules by correlation strength with melodically-coupled neighbors.

    Returns list of (module_name, pull_score) sorted descending. pull_score is the
    mean |r| across all coupled modules with |r| >= 0.25 — a direct measure of
    how strongly the coupled network is 'pulling' this module into shared musical logic.
    """
    from .coupling import _pearson

    coupled = {name for name, info in coupling_state.items() if info.get("melodic")}
    uncoupled = {name for name, info in coupling_state.items() if not info.get("melodic")}

    if not trace_records or not coupled or not uncoupled:
        return [(m, 0.0) for m in sorted(uncoupled)[:top_n]]

    n = len(trace_records)

    # Build per-module score series from trace trust data
    raw: dict[str, list] = {}
    for rec in trace_records:
        trust = rec.get("trust", {})
        for mod in coupled | uncoupled:
            data = trust.get(mod)
            if isinstance(data, dict):
                s = data.get("score")
                raw.setdefault(mod, []).append(float(s) if isinstance(s, (int, float)) else None)
            else:
                raw.setdefault(mod, []).append(None)

    # Fill missing values with per-module mean; skip modules with < 50 data points
    series: dict[str, list[float]] = {}
    for mod, vals in raw.items():
        present = [v for v in vals if v is not None]
        if len(present) < 50:
            continue
        mean = sum(present) / len(present)
        series[mod] = [v if v is not None else mean for v in vals]

    # Score each uncoupled module: mean |r| with coupled neighbors >= 0.25
    scores: dict[str, float] = {}
    for unc in uncoupled:
        if unc not in series:
            continue
        pull_vals = []
        for cop in coupled:
            if cop not in series:
                continue
            r = _pearson(series[unc], series[cop])
            if abs(r) >= 0.25:
                pull_vals.append(abs(r))
        if pull_vals:
            scores[unc] = sum(pull_vals) / len(pull_vals)

    return sorted(scores.items(), key=lambda x: -x[1])[:top_n]


@ctx.mcp.tool()
def suggest_evolution() -> str:
    """Synthesize all available signals -- hotspots, trust ecology, coupling state, perceptual
    character, uncoupled modules, KB evolution patterns -- into 3-5 ranked evolution proposals.
    The single-call evolution planner that replaces manual research. Use after pipeline_digest
    to decide what to evolve next."""
    ctx.ensure_ready_sync()
    _track("suggest_evolution")

    signals = {}

    # 1. Trace summary -- regime, trust, hotspots, coupling
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
    if os.path.isfile(trace_path):
        try:
            with open(trace_path) as f:
                ts = json.load(f)
            signals["regimes"] = ts.get("regimes", {})
            dom = ts.get("trustDominance", {})
            if isinstance(dom, dict):
                top = dom.get("dominantSystems", [])
                if top:
                    signals["top_trust"] = [
                        f"{s.get('system', '?')}({s.get('score', 0):.2f})"
                        for s in top[:8]
                    ]
            signals["couplingLabels"] = ts.get("aggregateCouplingLabels", {})
            signals["axisEnergy"] = ts.get("axisEnergy", {})
        except Exception:
            pass

    # 2. Perceptual report -- CLAP character + CB0
    perc_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "perceptual-report.json")
    if os.path.isfile(perc_path):
        try:
            with open(perc_path) as f:
                perc = json.load(f)
            clap = perc.get("clap", {})
            if clap:
                signals["perceptual_character"] = clap.get("dominant_character", "unknown")
                signals["perceptual_score"] = round(clap.get("dominant_score", 0), 3)
                queries = clap.get("queries", {})
                signals["perceptual_queries"] = {
                    k: round(v.get("avg", 0), 3) for k, v in queries.items()
                    if isinstance(v, dict)
                }
            enc = perc.get("encodec", {})
            if enc:
                # CB0 entropy averaged across sections
                sections = enc.get("sections", {})
                cb0_vals = [s["entropies"]["cb0"] for s in sections.values()
                            if isinstance(s, dict) and "entropies" in s and "cb0" in s["entropies"]]
                if cb0_vals:
                    signals["cb0_entropy_mean"] = round(sum(cb0_vals) / len(cb0_vals), 3)
                    signals["cb0_entropy_range"] = [round(min(cb0_vals), 3), round(max(cb0_vals), 3)]
                signals["tension_complexity_r"] = round(
                    enc.get("tension_complexity_correlation", 0), 3
                )
                # Per-section character
                sec_chars = {}
                for sec_id, sec_data in sorted(sections.items()):
                    if isinstance(sec_data, dict) and "clap" in sec_data:
                        sc = sec_data["clap"]
                        top = max(sc, key=sc.get, default="?")
                        sec_chars[f"S{sec_id}"] = f"{top}({sc.get(top, 0):.2f})"
                if sec_chars:
                    signals["per_section_character"] = sec_chars
        except Exception:
            pass

    # 3. Coupling state — source-code scan (accurate, no KB guessing)
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    from .coupling import _scan_coupling_state
    coupling_state = _scan_coupling_state(src_root)
    melodic_uncoupled_names = sorted(n for n, i in coupling_state.items() if not i["melodic"])
    rhythm_uncoupled_names = sorted(n for n, i in coupling_state.items() if not i["rhythm"])
    already_coupled = sorted(n for n, i in coupling_state.items() if i["melodic"])
    signals["melodically_uncoupled"] = melodic_uncoupled_names[:20]
    signals["rhythmically_uncoupled"] = rhythm_uncoupled_names[:15]
    signals["already_coupled"] = already_coupled

    # Cluster-pull ranking: load trace and rank uncoupled by correlation with coupled neighbors
    trace_raw_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    trace_records: list = []
    if os.path.isfile(trace_raw_path):
        try:
            trace_records = _load_trace(trace_raw_path)
        except Exception:
            pass
    if trace_records:
        cluster_targets = _rank_by_cluster_pull(coupling_state, trace_records)
        if cluster_targets:
            signals["cluster_priority_targets"] = [
                f"{name}(pull:{score:.2f})" for name, score in cluster_targets
            ]

    # 4. Narrative excerpt
    narrative_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "narrative-digest.md")
    if os.path.isfile(narrative_path):
        try:
            with open(narrative_path, encoding="utf-8") as f:
                signals["narrative_excerpt"] = f.read()[:2000]
        except Exception:
            pass

    # 5. KB evolution patterns
    kb_results = ctx.project_engine.search_knowledge(
        "evolution legendary pattern coupling", top_k=5
    )
    if kb_results:
        signals["kb_patterns"] = [
            f"[{k['category']}] {k['title']}: {k['content'][:120]}"
            for k in kb_results
        ]

    # 6. Verdict model top features
    model_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "verdict-model.json")
    if os.path.isfile(model_path):
        try:
            with open(model_path) as f:
                model = json.load(f)
            fi = model.get("feature_importance", [])
            if fi:
                signals["verdict_top_features"] = fi[:5]
        except Exception:
            pass

    # 7. Rut detection -- categorize last N KB evolution entries to detect monotonic runs
    import re as _re2
    _COUPLING_PATTERN = _re2.compile(
        r'\b(melodic coupling|rhythmicCouple|melodicEngine|emergentMelodic|'
        r'emergentRhythm|rhythmic coupling|rhythm coupling)\b', _re2.IGNORECASE
    )
    _HME_PATTERN = _re2.compile(r'\bHME\b|mcp.tool|suggest_evolution|coupling_network', _re2.IGNORECASE)
    try:
        recent_kb = ctx.project_engine.search_knowledge("R5 R6 evolution round", top_k=12)
        rut_types = []
        for k in recent_kb:
            text = k.get("title", "") + " " + k.get("content", "")[:200]
            if _COUPLING_PATTERN.search(text):
                rut_types.append("melodic_coupling")
            elif _HME_PATTERN.search(text):
                rut_types.append("hme_tool")
            else:
                rut_types.append("other")
        if rut_types:
            # Check if last 3+ are same type
            last3 = rut_types[:3]
            if len(set(last3)) == 1:
                signals["evolution_rut"] = {
                    "type": last3[0],
                    "consecutive": len([t for t in rut_types if t == last3[0]]),
                    "warning": f"Last {len(last3)}+ evolutions are all '{last3[0]}' — "
                               "consider orthogonal target (architecture, perceptual loop, "
                               "new engine, or structural refactor)"
                }
    except Exception:
        pass

    signal_str = json.dumps(signals, indent=2, default=str)[:6000]

    rut_warning = ""
    if signals.get("evolution_rut"):
        rut = signals["evolution_rut"]
        rut_warning = (
            f"\n\nRUT ALERT: {rut['warning']} "
            f"If suggesting more melodic coupling, explicitly explain why it's not diminishing returns. "
            f"Consider one orthogonal evolution (new engine, perceptual loop extension, "
            f"cross-boundary architecture) among your proposals."
        )

    cluster_hint = ""
    if signals.get("cluster_priority_targets"):
        cluster_hint = (
            "\n\nCLUSTER PRIORITY: The following uncoupled modules have the strongest "
            "cooperative correlation with already-coupled modules (pull score = mean |r| "
            "with coupled cluster-mates). These are the highest-leverage targets:\n  "
            + "\n  ".join(signals["cluster_priority_targets"])
            + "\nStart your proposals from this ranked list before considering others."
        )

    user_text = (
        "You are the evolution intelligence for Polychron, a generative polyrhythmic "
        "composition engine with 50 cross-layer modules, 27 trust-scored systems, and "
        "19 self-calibrating hypermeta controllers.\n\n"
        f"SIGNALS:\n{signal_str}\n\n"
        "Propose 3-5 evolution targets ranked by expected impact on musical expression. "
        "For each:\n"
        "### E<N>: <title>\n"
        "**Target:** <module_name:function>\n"
        "**Change:** <specific structural change, not constant tweaking>\n"
        "**Musical Effect:** <what the listener hears differently>\n"
        "**Risk:** <what could break>\n\n"
        "CRITICAL CONSTRAINTS:\n"
        "- Do NOT suggest modules listed in 'already_coupled' -- they are done.\n"
        "- ONLY suggest modules from 'melodically_uncoupled' list (exact names).\n"
        "- Do NOT invent module names -- copy exact names verbatim from the lists.\n"
        "- Melodic coupling pattern: `safePreBoot.call(() => emergentMelodicEngine.getContext(), null)` "
        "then compute a multiplier from contourShape/counterpoint/thematicDensity and apply to "
        "the module's key behavioral parameter.\n\n"
        "Prioritize: (1) modules in cluster_priority_targets (highest network leverage); "
        "(2) perceptual gaps where the system's intention diverges from what audio analysis hears; "
        "(3) underexplored architectural connections.\n"
        "Focus on STRUCTURAL evolutions (new pathways, new cross-system connections)."
        + cluster_hint
        + rut_warning
    )

    parts = ["# Evolution Suggestions\n"]
    parts.append(f"**Signals analyzed:** {len(signals)} categories")
    parts.append(f"**Melodically uncoupled:** {len(melodic_uncoupled_names)} crossLayer modules")
    parts.append(f"**Rhythmically uncoupled:** {len(rhythm_uncoupled_names)} crossLayer modules")
    if signals.get("cluster_priority_targets"):
        parts.append(f"**Cluster targets:** {', '.join(t.split('(')[0] for t in signals['cluster_priority_targets'][:5])}")
    if signals.get("perceptual_character"):
        parts.append(f"**Perceptual character:** {signals['perceptual_character']}")
    parts.append("")

    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(synthesis)
    else:
        parts.append("*Synthesis unavailable. Top cluster targets:*")
        for mod in (signals.get("cluster_priority_targets") or melodic_uncoupled_names)[:10]:
            parts.append(f"  {mod}")

    return "\n".join(parts)
