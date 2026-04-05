"""HME pipeline digest — one-call post-pipeline summary."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


def _load_trace() -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                records.append(json.loads(line))
            except Exception:
                continue
    return records


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
