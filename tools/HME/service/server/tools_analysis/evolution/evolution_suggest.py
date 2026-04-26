"""HME suggest_evolution — full signal synthesis into ranked next-evolution proposals."""
import json
import os
import logging
import re as _re2

from server import context as ctx
from .. import _track, _load_trace

logger = logging.getLogger("HME")

_RNUM_PAT = _re2.compile(r'\bR(\d+)\b')
_COUPLING_PATTERN = _re2.compile(
    r'\b(melodic coupling|rhythmicCouple|melodicEngine|emergentMelodic|'
    r'emergentRhythm|rhythmic coupling|rhythm coupling)\b', _re2.IGNORECASE
)
_HME_PATTERN = _re2.compile(r'\bHME\b|mcp.tool|suggest_evolution|coupling_network', _re2.IGNORECASE)
_BRIDGE_PATTERN = _re2.compile(r'\b(antagonism bridge|bridge.*r=|r=.*bridge|antagonist.*pair)\b', _re2.IGNORECASE)

_INFRA_MODULES = {
    "crossLayerHelpers", "crossLayerRegistry", "crossLayerEmissionGateway",
    "crossLayerLifecycleManager", "conductorSignalBridge", "beatInterleavedProcessor",
    "adaptiveTrustScores", "adaptiveTrustScoresHelpers", "coordinationIndependenceManager",
    "crossLayerDiagnostics",
}
_RHYTHM_FIELD_PRIORITY = ["hotspots", "complexityEma", "densitySurprise", "density", "complexity", "biasStrength"]


def suggest_evolution() -> str:
    """Synthesize all available signals into ranked evolution proposals.
    Called automatically by pipeline_digest(evolve=True)."""
    ctx.ensure_ready_sync()
    _track("suggest_evolution")

    from .evolution_next import (
        _rank_by_cluster_pull, _describe_musical_role, _describe_rhythm_effect, evolution_momentum
    )
    from ..coupling import _scan_coupling_state

    signals = {}

    # 1. Trace summary — regime, trust, hotspots, coupling
    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace-summary.json")
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
                        f"{s.get('system', '?')}({s.get('score', 0):.2f})" for s in top[:8]
                    ]
            signals["couplingLabels"] = ts.get("aggregateCouplingLabels", {})
            signals["axisEnergy"] = ts.get("axisEnergy", {})
        except Exception as _err1:
            logger.debug(f'silent-except evolution_suggest.py:58: {type(_err1).__name__}: {_err1}')

    # 2. Perceptual report — CLAP character + CB0
    perc_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "perceptual-report.json")
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
                    k: round(v.get("avg", 0), 3) for k, v in queries.items() if isinstance(v, dict)
                }
            enc = perc.get("encodec", {})
            if enc:
                sections = enc.get("sections", {})
                cb0_vals = [s["entropies"]["cb0"] for s in sections.values()
                            if isinstance(s, dict) and "entropies" in s and "cb0" in s["entropies"]]
                if cb0_vals:
                    signals["cb0_entropy_mean"] = round(sum(cb0_vals) / len(cb0_vals), 3)
                    signals["cb0_entropy_range"] = [round(min(cb0_vals), 3), round(max(cb0_vals), 3)]
                signals["tension_complexity_r"] = round(enc.get("tension_complexity_correlation", 0), 3)
                sec_chars = {}
                for sec_id, sec_data in sorted(sections.items()):
                    if isinstance(sec_data, dict) and "clap" in sec_data:
                        sc = sec_data["clap"]
                        top = max(sc, key=sc.get, default="?")
                        sec_chars[f"S{sec_id}"] = f"{top}({sc.get(top, 0):.2f})"
                if sec_chars:
                    signals["per_section_character"] = sec_chars
        except Exception as _err2:
            logger.debug(f'silent-except evolution_suggest.py:92: {type(_err2).__name__}: {_err2}')

    # 3. Coupling state
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    coupling_state = _scan_coupling_state(src_root)
    melodic_uncoupled_names = sorted(n for n, i in coupling_state.items()
                                     if not i["melodic"] and n not in _INFRA_MODULES)
    rhythm_uncoupled_names = sorted(n for n, i in coupling_state.items()
                                    if not i["rhythm"] and n not in _INFRA_MODULES)
    already_coupled = sorted(n for n, i in coupling_state.items() if i["melodic"])
    signals["melodically_uncoupled"] = melodic_uncoupled_names[:20]
    signals["rhythmically_uncoupled"] = rhythm_uncoupled_names[:15]
    signals["already_coupled"] = already_coupled

    trace_records: list = []
    trace_raw_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    if os.path.isfile(trace_raw_path):
        try:
            trace_records = _load_trace(trace_raw_path)
        except Exception as _err3:
            logger.debug(f'silent-except evolution_suggest.py:112: {type(_err3).__name__}: {_err3}')
    if trace_records:
        cluster_targets = _rank_by_cluster_pull(coupling_state, trace_records)
        if cluster_targets:
            signals["cluster_priority_targets"] = [
                f"{name}(pull:{score:.2f})" for name, score in cluster_targets
            ]
        elif rhythm_uncoupled_names:
            rhythm_cluster = _rank_by_cluster_pull(coupling_state, trace_records,
                                                   uncoupled_override=set(rhythm_uncoupled_names))
            if rhythm_cluster:
                signals["cluster_priority_targets"] = [
                    f"{name}(pull:{score:.2f})[+rhythm]" for name, score in rhythm_cluster
                ]

    # 4. Narrative excerpt
    narrative_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "narrative-digest.md")
    if os.path.isfile(narrative_path):
        try:
            with open(narrative_path, encoding="utf-8") as f:
                signals["narrative_excerpt"] = f.read()[:2000]
        except Exception as _err4:
            logger.debug(f'silent-except evolution_suggest.py:134: {type(_err4).__name__}: {_err4}')

    # 5. KB evolution patterns
    kb_results = ctx.project_engine.search_knowledge("evolution legendary pattern coupling", top_k=5)
    if kb_results:
        signals["kb_patterns"] = [
            f"[{k['category']}] {k['title']}: {k['content'][:120]}" for k in kb_results
        ]

    # 6. Verdict model top features
    model_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "verdict-model.json")
    if os.path.isfile(model_path):
        try:
            with open(model_path) as f:
                mdl = json.load(f)
            fi = mdl.get("feature_importance", [])
            if fi:
                signals["verdict_top_features"] = fi[:5]
        except Exception as _err5:
            logger.debug(f'silent-except evolution_suggest.py:153: {type(_err5).__name__}: {_err5}')

    # 7. Rut detection
    try:
        all_kb_full = ctx.project_engine.list_knowledge_full() or []
        numbered_kb = []
        for _k in all_kb_full:
            _m = _RNUM_PAT.search(_k.get("title", ""))
            if _m:
                numbered_kb.append((int(_m.group(1)), _k))
        numbered_kb.sort(key=lambda x: -x[0])
        recent_kb = [k for _, k in numbered_kb[:12]]
        rut_types = []
        for k in recent_kb:
            text = k.get("title", "") + " " + k.get("content", "")[:200]
            if _COUPLING_PATTERN.search(text):
                rut_types.append("melodic_coupling")
            elif _BRIDGE_PATTERN.search(text):
                rut_types.append("antagonism_bridge")
            elif _HME_PATTERN.search(text):
                rut_types.append("hme_tool")
            else:
                rut_types.append("other")
        if rut_types:
            last3 = rut_types[:3]
            if len(set(last3)) == 1:
                signals["evolution_rut"] = {
                    "type": last3[0],
                    "consecutive": len([t for t in rut_types if t == last3[0]]),
                    "warning": (f"Last {len(last3)}+ evolutions are all '{last3[0]}' — "
                                "consider orthogonal target (architecture, perceptual loop, "
                                "new engine, or structural refactor)")
                }
            signals["recent_evo_arc"] = rut_types[:6]
    except Exception as _err6:
        logger.debug(f'silent-except evolution_suggest.py:188: {type(_err6).__name__}: {_err6}')

    # Build output
    parts = ["# Evolution Suggestions\n"]
    parts.append(f"**Signals analyzed:** {len(signals)} categories")
    parts.append(f"**Melodically uncoupled:** {len(melodic_uncoupled_names)} crossLayer modules")
    parts.append(f"**Rhythmically uncoupled:** {len(rhythm_uncoupled_names)} crossLayer modules")
    if signals.get("perceptual_character"):
        parts.append(f"**Perceptual character:** {signals['perceptual_character']}")
    if signals.get("cb0_entropy_mean"):
        parts.append(f"**CB0 entropy:** {signals['cb0_entropy_mean']}")
    if signals.get("recent_evo_arc"):
        parts.append(f"**Recent arc:** {' → '.join(signals['recent_evo_arc'])}")
    if signals.get("evolution_rut"):
        parts.append(f"**RUT ALERT:** {signals['evolution_rut']['warning']}")
    parts.append("")

    cluster_targets_list = signals.get("cluster_priority_targets", [])
    is_rhythm_fallback = bool(cluster_targets_list and cluster_targets_list[0].endswith("[+rhythm]"))
    if cluster_targets_list:
        heading = ("## Ranked by Cluster Pull — Rhythm Gap Targets\n"
                   if is_rhythm_fallback else
                   "## Ranked by Cluster Pull (cooperative correlation with coupled modules)\n")
        parts.append(heading)
        for idx, entry in enumerate(cluster_targets_list[:5]):
            name = entry.split("(")[0]
            raw_score = entry.split("pull:")[1] if "pull:" in entry else "?"
            score_str = raw_score.rstrip(")[+rhythm]").rstrip(")") if raw_score != "?" else "?"
            info = coupling_state.get(name, {})
            fpath = info.get("path", "?").replace(os.path.join(ctx.PROJECT_ROOT, "src/"), "")
            parts.append(f"### E{idx + 1}: {name}")
            parts.append(f"**Path:** {fpath}")
            parts.append(f"**Cluster pull:** {score_str}")
            role_desc, coupling_effect = _describe_musical_role(name, fpath, signals.get("narrative_excerpt", ""))
            parts.append(f"**Musical role:** {role_desc}")
            existing_r = info.get("rhythm_dims", [])
            suggested_r = next((f for f in _RHYTHM_FIELD_PRIORITY if f not in existing_r), None)
            if is_rhythm_fallback and suggested_r:
                rhythm_effect = _describe_rhythm_effect(name, suggested_r)
                parts.append(f"**Rhythm coupling:** `{suggested_r}` → {rhythm_effect}")
                parts.append(f"  (x{len([n for n, i in coupling_state.items() if suggested_r in i.get('rhythm_dims', [])])} modules currently)")
            else:
                parts.append(f"**Coupling effect:** {coupling_effect}")
            try:
                kb_hits = ctx.project_engine.search_knowledge(name, top_k=2)
                parts.append(f"**KB:** {kb_hits[0].get('title', '?')[:80]}" if kb_hits else "**KB:** no entries (blind spot)")
            except Exception as _err7:
                logger.debug(f'silent-except evolution_suggest.py:235: {type(_err7).__name__}: {_err7}')
            if is_rhythm_fallback:
                parts.append(f"**Pattern:** `const rhythmEntry = L0.getLast('emergentRhythm', {{layer: 'both'}}); const val = rhythmEntry?.{suggested_r or 'density'} ?? 0;`")
            else:
                parts.append(f"**Pattern:** `safePreBoot.call(() => emergentMelodicEngine.getContext(), null)` → multiplier on key parameter")
            parts.append("")
    else:
        parts.append("## Uncoupled Modules (no cluster data — run pipeline first)\n")
        for name in melodic_uncoupled_names[:8]:
            info = coupling_state.get(name, {})
            fpath = info.get("path", "?").replace(os.path.join(ctx.PROJECT_ROOT, "src/"), "")
            parts.append(f"  {name:<35} {fpath}")

    if signals.get("per_section_character"):
        parts.append("## Perceptual Section Characters")
        for sec, char in signals["per_section_character"].items():
            parts.append(f"  {sec}: {char}")

    try:
        momentum = evolution_momentum()
        if momentum and "Error" not in momentum[:30]:
            parts.append("\n" + momentum)
    except Exception as _err8:
        logger.debug(f'silent-except evolution_suggest.py:258: {type(_err8).__name__}: {_err8}')

    # Dead-end L0 channels
    try:
        from ..coupling import _scan_l0_topology as _topo
        topo = _topo(os.path.join(ctx.PROJECT_ROOT, "src"))
        _SYSTEM_LOOPS = {"rest-sync", "section-quality", "binaural", "instrument", "note"}
        _KNOWN_CONNECTED = {"feedbackLoop", "cadenceAlignment", "explainability", "channel-coherence",
                            "chord", "beatPhase"}
        dead = [(ch, d["producers"]) for ch, d in topo.items()
                if d["producers"] and not d["consumers"]
                and ch not in _SYSTEM_LOOPS and ch not in _KNOWN_CONNECTED]
        if dead:
            parts.append("\n## Dead Signal Channels  (posted but never consumed)\n")
            parts.append("*Adding L0.getLast consumers to these channels unlocks existing data flows.*\n")
            for ch, prods in sorted(dead):
                parts.append(f"  `{ch}` — posted by {', '.join(sorted(prods))}")
    except Exception as _err9:
        logger.debug(f'silent-except evolution_suggest.py:276: {type(_err9).__name__}: {_err9}')

    # Antagonism bridge opportunities
    try:
        from ..coupling import get_top_bridges as _get_bridges
        bridges = _get_bridges(n=2)
        if bridges:
            parts.append("\n## Antagonism Bridge Opportunities\n")
            parts.append("*Couple both sides of an antagonist pair to the SAME signal with opposing effects.*\n")
            for br in bridges:
                already_s = f"  already bridged: {', '.join(br['already_bridged'])}" if br['already_bridged'] else ""
                parts.append(f"**{br['pair_a']} [{br['arch_a']}] ↔ {br['pair_b']} [{br['arch_b']}]**  r={br['r']:+.3f}{already_s}")
                parts.append(f"  Bridge field: `{br['field']}`")
                parts.append(f"  {br['pair_a']}: {br['eff_a']}")
                parts.append(f"  {br['pair_b']}: {br['eff_b']}")
                parts.append(f"  Why: {br['why']}\n")
    except Exception as _err10:
        logger.debug(f'silent-except evolution_suggest.py:293: {type(_err10).__name__}: {_err10}')

    # Adaptive synthesis prescription
    try:
        from ..synthesis import _two_stage_think
        _cluster_top = signals.get("cluster_priority_targets", ["?"])[:2]
        _bridge_top = ""
        try:
            from ..coupling import get_top_bridges as _gb2, _TRUST_FILE_ALIASES
            _bt = _gb2(n=1)
            if _bt:
                _a = _TRUST_FILE_ALIASES.get(_bt[0]["pair_a"], _bt[0]["pair_a"])
                _b = _TRUST_FILE_ALIASES.get(_bt[0]["pair_b"], _bt[0]["pair_b"])
                _bridge_top = f"{_a}↔{_b} r={_bt[0]['r']:+.3f} via `{_bt[0]['field']}`"
        except Exception as _err11:
            logger.debug(f'silent-except evolution_suggest.py:308: {type(_err11).__name__}: {_err11}')
        _rut = signals.get("evolution_rut", {})
        _arc = signals.get("recent_evo_arc", [])
        _recent_kb_titles = ""
        try:
            all_kb_full2 = ctx.project_engine.list_knowledge_full() or []
            _num_kb2 = []
            for _k2 in all_kb_full2:
                _m2 = _RNUM_PAT.search(_k2.get("title", ""))
                if _m2:
                    _num_kb2.append((int(_m2.group(1)), _k2.get("title", ""), _k2.get("content", "")[:80]))
            _num_kb2.sort(key=lambda x: -x[0])
            _recent_kb_titles = "\n".join(f"  R{r}: {t} — {c}" for r, t, c in _num_kb2[:6])
        except Exception as _err12:
            logger.debug(f'silent-except evolution_suggest.py:322: {type(_err12).__name__}: {_err12}')
        from ..synthesis_session import get_session_narrative
        _session_ctx = get_session_narrative(max_entries=5, categories=["pipeline", "kb", "commit", "review"])
        _synthesis_ctx = (
            (_session_ctx if _session_ctx else "")
            + f"Recent KB evolutions (newest first):\n{_recent_kb_titles}\n\n"
            f"Recent arc categories: {' → '.join(_arc) if _arc else 'unknown'}\n"
            + (f"Rut alert: {_rut.get('warning', '')} (consecutive: {_rut.get('consecutive', 0)})\n" if _rut else "")
            + f"Top cluster-pull targets: {', '.join(_cluster_top)}\n"
            + (f"Top bridge opportunity: {_bridge_top}\n" if _bridge_top else "")
            + f"Perceptual character: {signals.get('perceptual_character', 'unknown')}\n"
            + (f"CB0 entropy: mean={signals.get('cb0_entropy_mean', '?')}\n" if signals.get('cb0_entropy_mean') else "")
            + (f"Verdict top features: {signals.get('verdict_top_features', [])[:3]}\n" if signals.get('verdict_top_features') else "")
        )
        _prescription = _two_stage_think(
            _synthesis_ctx,
            "You are an evolution strategist for a self-evolving alien generative music system. "
            "In 2-3 sentences: what is the single highest-leverage evolution action for the NEXT ROUND? "
            "Name the specific module(s) to modify, the signal field to use, "
            "and what the listener will hear differently. "
            "If a rut is detected, prescribe an orthogonal target. Be concrete and decisive.",
            max_tokens=600,
            answer_format=(
                "2-3 decisive sentences. No bullet format. No FILE/FUNCTION labels. "
                "One paragraph: module, signal field, musical effect. Direct and concrete."
            ),
        )
        if _prescription:
            parts.append("\n\n## NEXT EVOLUTION PRESCRIPTION *(synthesized)*\n")
            parts.append(_prescription)
    except Exception as _err13:
        logger.debug(f'silent-except evolution_suggest.py:353: {type(_err13).__name__}: {_err13}')

    result = "\n".join(parts)
    if len(result) > 20000:
        result = result[:20000] + f"\n*(truncated — {len(result) - 20000} chars omitted)*"
    return result
