"""HME evolution intelligence — next-evolution suggestions powered by synthesis."""
import json
import os
import logging

from server import context as ctx
from .synthesis import _get_api_key, _think_local_or_claude
from . import _track

logger = logging.getLogger("HME")


def _find_uncoupled_modules(src_root, engine_name):
    """Find crossLayer modules that don't reference a given engine."""
    uncoupled = []
    cl_dir = os.path.join(src_root, "crossLayer")
    if not os.path.isdir(cl_dir):
        return []
    for dirpath, _, filenames in os.walk(cl_dir):
        for fname in filenames:
            if not fname.endswith(".js") or fname == "index.js":
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if engine_name not in content:
                    rel = fpath.replace(src_root + "/", "")
                    uncoupled.append(rel)
            except Exception:
                continue
    return sorted(uncoupled)


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
                signals["perceptual_character"] = clap.get("dominant_label", "unknown")
                signals["perceptual_scores"] = {
                    k: round(v, 3) for k, v in clap.items()
                    if isinstance(v, (int, float))
                }
            enc = perc.get("encodec", {})
            if enc:
                signals["cb0_entropy"] = enc.get("cb0_entropy", 0)
                signals["tension_correlation"] = enc.get("tension_correlation", 0)
        except Exception:
            pass

    # 3. Uncoupled modules -- crossLayer modules not reading emergent engines
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    melodic_uncoupled = _find_uncoupled_modules(src_root, "emergentMelodicEngine")
    rhythm_uncoupled = _find_uncoupled_modules(src_root, "emergentRhythmEngine")
    signals["melodically_uncoupled"] = melodic_uncoupled[:15]
    signals["rhythmically_uncoupled"] = rhythm_uncoupled[:15]

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

    signal_str = json.dumps(signals, indent=2, default=str)[:6000]

    user_text = (
        "You are the evolution intelligence for Polychron, a generative polyrhythmic "
        "composition engine with 39 cross-layer modules, 27 trust-scored systems, and "
        "19 self-calibrating hypermeta controllers.\n\n"
        f"SIGNALS:\n{signal_str}\n\n"
        "Propose 3-5 evolution targets ranked by expected impact on musical expression. "
        "For each:\n"
        "### E<N>: <title>\n"
        "**Target:** <file:function>\n"
        "**Change:** <specific structural change, not constant tweaking>\n"
        "**Musical Effect:** <what the listener hears differently>\n"
        "**Risk:** <what could break>\n\n"
        "Prioritize: (1) uncoupled modules with high trust scores -- these are powerful "
        "systems not yet responding to melodic/rhythmic context; (2) perceptual gaps -- "
        "where the system's intention diverges from what the audio analysis hears; "
        "(3) underexplored architectural connections between subsystems.\n"
        "Focus on STRUCTURAL evolutions (new pathways, new cross-system connections) "
        "over parametric changes."
    )

    parts = ["# Evolution Suggestions\n"]
    parts.append(f"**Signals analyzed:** {len(signals)} categories")
    parts.append(f"**Melodically uncoupled:** {len(melodic_uncoupled)} crossLayer modules")
    parts.append(f"**Rhythmically uncoupled:** {len(rhythm_uncoupled)} crossLayer modules")
    if signals.get("perceptual_character"):
        parts.append(f"**Perceptual character:** {signals['perceptual_character']}")
    parts.append("")

    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(synthesis)
    else:
        parts.append("*Synthesis unavailable. Uncoupled modules:*")
        for mod in melodic_uncoupled[:10]:
            parts.append(f"  {mod} -- no emergentMelodicEngine reference")

    return "\n".join(parts)
