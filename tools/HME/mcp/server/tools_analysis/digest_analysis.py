"""HME digest analysis — regime_anomaly and composition_critique."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


def _load_trace_local() -> list[dict]:
    """Load trace.jsonl for this project."""
    from . import _load_trace as _load_trace_impl
    return _load_trace_impl(os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl"))


def regime_anomaly() -> str:
    """Auto-detect regime pathologies: death spirals (0% of any expected regime),
    monopolies (>75% single regime), forced-transition storms, and trust inflation.
    Run after every pipeline — catches problems before they require hours of debugging."""
    ctx.ensure_ready_sync()
    _track("regime_anomaly")

    try:
        records = _load_trace_local()
    except Exception as e:
        return f"No trace data: {e}"

    if not records:
        return "Empty trace.jsonl."

    regime_total: dict = defaultdict(int)
    trust_inflation: list = []
    weight_swings: list = []
    prev_weights: dict = {}

    for rec in records:
        regime_total[rec.get("regime", "?")] += 1
        trust = rec.get("trust", {})
        for sys, data in trust.items():
            if not isinstance(data, dict):
                continue
            w = data.get("weight", 1)
            s = data.get("score", 0.5)
            if isinstance(w, (int, float)) and isinstance(s, (int, float)):
                predicted_w = 1.0 + s * 0.75
                if w > predicted_w + 0.15 and s < 0.30:
                    trust_inflation.append((sys, w, s))
            pw = prev_weights.get(sys, w)
            if isinstance(pw, (int, float)) and abs(w - pw) > 0.5:
                weight_swings.append((abs(w - pw), rec.get("beatKey", "?"), sys))
            prev_weights[sys] = w

    total = sum(regime_total.values())
    alerts: list = []

    # Death spiral: 0% of an expected regime
    for expected in ["coherent", "evolving", "exploring"]:
        if regime_total.get(expected, 0) == 0:
            alerts.append(f"🔴 DEATH SPIRAL: 0% {expected} regime ({total} beats). "
                          "Check regimeClassifier warm-start and threshold scale.")

    # Monopoly: >75% single regime
    for regime, count in regime_total.items():
        if regime != "initializing" and count / total > 0.75:
            alerts.append(f"🟡 MONOPOLY: {regime} at {count*100//total}% ({count}/{total} beats). "
                          "Regime self-balancer may be stuck.")

    # Trust inflation: high weight despite low score
    inflated = defaultdict(list)
    for sys, w, s in trust_inflation:
        inflated[sys].append((w, s))
    for sys, samples in sorted(inflated.items(), key=lambda x: -len(x[1]))[:3]:
        pct = len(samples) * 100 // total
        if pct > 20:
            avg_w = sum(w for w, _ in samples) / len(samples)
            avg_s = sum(s for _, s in samples) / len(samples)
            alerts.append(f"🟡 TRUST INFLATION: {sys} — weight {avg_w:.2f} but score {avg_s:.2f} "
                          f"on {pct}% of beats. EMA floor may be propping it up.")

    # Extreme weight swings
    weight_swings.sort(reverse=True)
    if weight_swings and weight_swings[0][0] > 0.7:
        d, bk, sys = weight_swings[0]
        alerts.append(f"🟡 WEIGHT SWING: {sys} Δ{d:.3f} at {bk}. "
                      "Check for EMA alpha spike or sudden score inversion.")

    if not alerts:
        return f"# Regime Health: ALL CLEAR ({total} beats)\n\nNo anomalies detected. " \
               f"Regimes: {', '.join(f'{r}:{c}' for r, c in sorted(regime_total.items(), key=lambda x: -x[1]))}"

    out = [f"# Regime Anomaly Report ({total} beats, {len(alerts)} alerts)\n"]
    out.extend(alerts)
    out.append(f"\nRegimes: {', '.join(f'{r}:{c}' for r, c in sorted(regime_total.items(), key=lambda x: -x[1]))}")
    return "\n".join(out)


def composition_critique() -> str:
    """Musical interpretation of the latest pipeline run. Not stats -- a critic's review
    of what the composition sounds like, how the narrative unfolds, and where the system's
    expression succeeds or falls flat. Reads narrative-digest, perceptual data, and
    trace-replay for grounded musical prose."""
    ctx.ensure_ready_sync()
    _track("composition_critique")
    from .synthesis import _think_local_or_claude, _REASONING_MODEL

    context_parts = []

    narrative_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "narrative-digest.md")
    if os.path.isfile(narrative_path):
        try:
            with open(narrative_path, encoding="utf-8") as f:
                context_parts.append(f"NARRATIVE:\n{f.read()[:3000]}")
        except Exception:
            pass

    perc_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "perceptual-report.json")
    if os.path.isfile(perc_path):
        try:
            with open(perc_path) as f:
                perc = json.load(f)
            perc_lines = []
            clap = perc.get("clap", {})
            if clap:
                perc_lines.append(f"Dominant character: {clap.get('dominant_character', '?')}")
                perc_lines.append(f"  score: {clap.get('dominant_score', 0):.3f}")
                for q, qv in clap.get("queries", {}).items():
                    if isinstance(qv, dict):
                        perc_lines.append(f"  {q}: avg={qv.get('avg', 0):.3f}")
            enc = perc.get("encodec", {})
            if enc:
                sections = enc.get("sections", {})
                cb0_vals = [s["entropies"]["cb0"] for s in sections.values()
                            if isinstance(s, dict) and "entropies" in s and "cb0" in s["entropies"]]
                if cb0_vals:
                    perc_lines.append(f"CB0 entropy: mean={sum(cb0_vals)/len(cb0_vals):.2f} range=[{min(cb0_vals):.2f},{max(cb0_vals):.2f}]")
                perc_lines.append(f"Tension-complexity r: {enc.get('tension_complexity_correlation', 0):.3f}")
                for sec_id, sec_data in sorted(sections.items()):
                    if isinstance(sec_data, dict) and "clap" in sec_data:
                        clap_sec = sec_data["clap"]
                        top_probe = max(clap_sec, key=clap_sec.get, default="?")
                        perc_lines.append(
                            f"  S{sec_id}: {top_probe} ({clap_sec.get(top_probe, 0):.3f})"
                        )
            if perc_lines:
                context_parts.append("PERCEPTUAL:\n" + "\n".join(perc_lines))
        except Exception:
            pass

    replay_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-replay.json")
    if os.path.isfile(replay_path):
        try:
            with open(replay_path) as f:
                replay = json.load(f)
            replay_lines = []
            for sec in replay.get("sections", []):
                if isinstance(sec, dict):
                    replay_lines.append(
                        f"S{sec.get('section', '?')}: {sec.get('beats', 0)} beats, "
                        f"regime={sec.get('dominantRegime', '?')}, "
                        f"tension={sec.get('avgTension', 0):.2f}, "
                        f"profile={sec.get('profile', '?')}"
                    )
            if replay_lines:
                context_parts.append("SECTIONS:\n" + "\n".join(replay_lines))
        except Exception:
            pass

    if not context_parts:
        return "No pipeline data available. Run `npm run main` first."

    user_text = (
        "You are a music critic reviewing a live performance of an AI-composed polyrhythmic "
        "piece. Write a 3-paragraph musical critique based on the data below. Write about "
        "the LISTENER'S experience -- what they hear, feel, and perceive.\n\n"
        "Paragraph 1: Opening character -- how the piece establishes its identity.\n"
        "Paragraph 2: Development -- how the musical narrative evolves, where tension builds "
        "and releases, moments of surprise or predictability.\n"
        "Paragraph 3: Resolution and overall impression -- does the piece achieve coherence? "
        "What lingers in the listener's mind?\n\n"
        + "\n\n".join(context_parts) + "\n\n"
        "Write in vivid, evocative prose. Reference specific sections and moments. "
        "Be honest about weaknesses. Do NOT use technical jargon like 'regime' or 'hotspot' -- "
        "translate everything into musical language a concert-goer would understand."
    )

    parts = ["# Composition Critique\n"]
    # Use reasoning model (GPU 1) + higher temperature for creative music prose.
    # Coder model (GPU 0) produces stilted output for non-code tasks.
    synthesis = _think_local_or_claude(user_text,
                                       model=_REASONING_MODEL,
                                       temperature=0.55)
    if synthesis:
        parts.append(synthesis)
    else:
        parts.append("*Synthesis unavailable.*")

    return "\n".join(parts)
