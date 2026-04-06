"""HME pipeline digest — one-call post-pipeline summary."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


from . import _load_trace as _load_trace_impl  # shared helper


def _load_trace() -> list[dict]:
    """Wrapper: loads from the canonical trace.jsonl path for this project."""
    return _load_trace_impl(os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl"))


@ctx.mcp.tool()
def pipeline_digest() -> str:
    """One-call post-pipeline analysis: composition arc + top hotspot systems + dramatic
    moments + regime health. Run this after every pipeline to get the full picture without
    calling 4 separate tools. The 'executive summary' of the composition."""
    ctx.ensure_ready_sync()
    _track("pipeline_digest")

    try:
        records = _load_trace()
    except Exception as e:
        return f"No trace data: {e}"

    if not records:
        return "Empty trace.jsonl."

    # --- Composition Arc (compact) ---
    sections: dict = defaultdict(lambda: {
        "beats": 0, "regimes": defaultdict(int), "tensions": [],
        "profiles": defaultdict(int), "trust_weights": defaultdict(list),
    })
    regime_total: dict = defaultdict(int)
    hotspot_counts: dict = defaultdict(int)
    hotspot_pressure: dict = defaultdict(list)
    prev_regime = None
    prev_weights: dict = {}
    drama_events: list = []

    for rec in records:
        bk = rec.get("beatKey", "")
        parts = bk.split(":")
        sec = int(parts[0]) if parts and parts[0].isdigit() else -1
        regime = rec.get("regime", "?")
        regime_total[regime] += 1
        s = sections[sec]
        s["beats"] += 1
        s["regimes"][regime] += 1
        snap = rec.get("snap", {})
        if isinstance(snap, dict):
            t = snap.get("tension")
            if isinstance(t, (int, float)):
                s["tensions"].append(t)
            prof = snap.get("activeProfile", "")
            if prof:
                s["profiles"][prof] += 1
        trust = rec.get("trust", {})
        for sys_name, data in trust.items():
            if not isinstance(data, dict):
                continue
            w = data.get("weight")
            if isinstance(w, (int, float)):
                s["trust_weights"][sys_name].append(w)
            hp = data.get("hotspotPressure", 0)
            if hp > 0.1:
                hotspot_counts[sys_name] += 1
                hotspot_pressure[sys_name].append(hp)
            # Weight swings
            prev_w = prev_weights.get(sys_name, w)
            swing = abs(w - prev_w)
            if swing > 0.3:
                tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
                drama_events.append((swing * 20 + tension * 2, bk, sys_name, prev_w, w))
            prev_weights[sys_name] = w
        # Regime transitions
        if regime != prev_regime and prev_regime is not None:
            active_hp = sum(1 for sv in trust.values()
                           if isinstance(sv, dict) and sv.get("hotspotPressure", 0) > 0.2)
            tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
            drama_events.append((10 + active_hp * 0.5 + tension * 3, bk, f"{prev_regime}→{regime}", 0, 0))
        prev_regime = regime

    total_beats = sum(regime_total.values())
    out = [f"# Pipeline Digest ({total_beats} beats)\n"]

    # Regime health
    regime_str = " | ".join(f"{r}:{c} ({c*100//total_beats}%)" for r, c in
                            sorted(regime_total.items(), key=lambda x: -x[1]))
    out.append(f"**Regimes:** {regime_str}")
    if regime_total.get("coherent", 0) == 0:
        out.append("⚠ **ZERO coherent beats** — possible regime classification failure")
    out.append("")

    # Section arc
    out.append("## Sections")
    for sec_num in sorted(sections.keys()):
        s = sections[sec_num]
        dom_regime = max(s["regimes"].items(), key=lambda x: x[1])[0] if s["regimes"] else "?"
        dom_profile = max(s["profiles"].items(), key=lambda x: x[1])[0] if s["profiles"] else "?"
        tensions = s["tensions"]
        avg_t = sum(tensions) / len(tensions) if tensions else 0
        bar = "█" * int(avg_t * 15) + "░" * (15 - int(avg_t * 15))
        top_trust = sorted(((n, sum(ws) / len(ws)) for n, ws in s["trust_weights"].items()),
                           key=lambda x: -x[1])[:2]
        trust_str = ", ".join(f"{n}({w:.2f})" for n, w in top_trust)
        out.append(f"  S{sec_num} ({s['beats']}b {dom_profile}) {dom_regime:10} t={avg_t:.2f} [{bar}] {trust_str}")
    out.append("")

    # Top 5 hotspot systems
    ranked_hp = sorted(hotspot_counts.items(), key=lambda x: -x[1])[:5]
    if ranked_hp:
        out.append("## Top Hotspots")
        for name, count in ranked_hp:
            total_sys = total_beats
            pct = count / total_sys * 100
            pressures = hotspot_pressure.get(name, [0])
            peak = max(pressures)
            out.append(f"  {name:<25} {pct:5.1f}% (peak {peak:.3f})")
        out.append("")

    # Top 5 dramatic moments (mixed types)
    drama_events.sort(key=lambda x: -x[0])
    if drama_events:
        out.append("## Top Drama")
        seen = set()
        shown = 0
        for score, bk, detail, pw, w in drama_events:
            if bk in seen or shown >= 5:
                continue
            seen.add(bk)
            if pw and w:
                out.append(f"  {bk}: {detail} {pw:.3f}→{w:.3f} (drama={score:.1f})")
            else:
                out.append(f"  {bk}: {detail} (drama={score:.1f})")
            shown += 1

    return "\n".join(out)


@ctx.mcp.tool()
def regime_anomaly() -> str:
    """Auto-detect regime pathologies: death spirals (0% of any expected regime),
    monopolies (>75% single regime), forced-transition storms, and trust inflation.
    Run after every pipeline — catches problems before they require hours of debugging."""
    ctx.ensure_ready_sync()
    _track("regime_anomaly")

    try:
        records = _load_trace()
    except Exception as e:
        return f"No trace data: {e}"

    if not records:
        return "Empty trace.jsonl."

    regime_total: dict = defaultdict(int)
    forced_reasons: dict = defaultdict(int)
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


@ctx.mcp.tool()
def composition_critique() -> str:
    """Musical interpretation of the latest pipeline run. Not stats -- a critic's review
    of what the composition sounds like, how the narrative unfolds, and where the system's
    expression succeeds or falls flat. Reads narrative-digest, perceptual data, and
    trace-replay for grounded musical prose."""
    ctx.ensure_ready_sync()
    _track("composition_critique")
    from .synthesis import _get_api_key, _think_local_or_claude
    import json

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
                perc_lines.append(f"Dominant character: {clap.get('dominant_label', '?')}")
                for k, v in clap.items():
                    if isinstance(v, (int, float)):
                        perc_lines.append(f"  {k}: {v:.3f}")
            enc = perc.get("encodec", {})
            if enc:
                perc_lines.append(f"CB0 entropy: {enc.get('cb0_entropy', 0):.2f}")
                perc_lines.append(f"Tension-complexity r: {enc.get('tension_correlation', 0):.3f}")
                sections = enc.get("sections", {})
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
    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(synthesis)
    else:
        parts.append("*Synthesis unavailable.*")

    return "\n".join(parts)
