"""HME pipeline digest — one-call post-pipeline summary."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


from . import _load_trace as _load_trace_impl  # shared helper

# Files written by every pipeline run — used to detect freshness.
# pipeline.log is written LAST (the "Pipeline finished" line), so it detects completion
# even when digest was called mid-run and already consumed the early metrics files.
_PIPELINE_OUTPUT_FILES = [
    "metrics/trace.jsonl",
    "metrics/trace-summary.json",
    "metrics/fingerprint-comparison.json",
    "log/pipeline.log",
]
# Sentinel file records when pipeline_digest last ran successfully
_DIGEST_SENTINEL = ".claude/mcp/HME/.last_pipeline_digest"


def _pipeline_outputs_fresh() -> bool:
    """Return True if pipeline has run since the last pipeline_digest call."""
    sentinel = os.path.join(ctx.PROJECT_ROOT, _DIGEST_SENTINEL)
    if not os.path.exists(sentinel):
        return True  # first call ever — allow through
    sentinel_mtime = os.path.getmtime(sentinel)
    for rel in _PIPELINE_OUTPUT_FILES:
        p = os.path.join(ctx.PROJECT_ROOT, rel)
        if os.path.exists(p) and os.path.getmtime(p) > sentinel_mtime:
            return True
    return False


def _touch_digest_sentinel():
    sentinel = os.path.join(ctx.PROJECT_ROOT, _DIGEST_SENTINEL)
    os.makedirs(os.path.dirname(sentinel), exist_ok=True)
    import time
    with open(sentinel, "w") as f:
        f.write(str(time.time()))


@ctx.mcp.tool()
def check_pipeline() -> str:
    """Check current pipeline status by reading pipeline.log directly.
    Reports: IN PROGRESS (pipeline currently running), the finished line
    (pipeline completed), or FAILED with last 30 lines for diagnosis.
    This is the ONLY permitted way to check pipeline state — never tail/cat the log."""
    _track("check_pipeline")
    log_path = os.path.join(ctx.PROJECT_ROOT, "log", "pipeline.log")
    if not os.path.isfile(log_path):
        return "No pipeline.log found — pipeline has not been run yet."
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except Exception as e:
        return f"Could not read pipeline.log: {e}"

    if not lines:
        return "pipeline.log is empty."

    stripped = [l.rstrip() for l in lines if l.strip()]
    last30 = "\n".join(stripped[-30:])
    last10 = stripped[-10:] if len(stripped) >= 10 else stripped

    # In-progress: ANY of the last 5 non-empty lines starts with "script in progress"
    # (pipeline prints this once per step, not as a continuous stream)
    last5 = stripped[-5:] if len(stripped) >= 5 else stripped
    if any(l.startswith("script in progress") for l in last5):
        return "Pipeline: IN PROGRESS"

    # Finished: "Pipeline finished" appears in last 10 non-empty lines
    finished = next((l for l in reversed(last10) if "Pipeline finished" in l), None)
    if finished:
        return f"Pipeline: {finished.strip()}"

    # Otherwise: failed
    return f"Pipeline: FAILED\n\nLast 30 lines:\n{last30}"


def _load_trace() -> list[dict]:
    """Wrapper: loads from the canonical trace.jsonl path for this project."""
    return _load_trace_impl(os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl"))


@ctx.mcp.tool()
def pipeline_digest(critique: bool = False, evolve: bool = True) -> str:
    """The single post-pipeline ritual. Consolidates: composition arc, regime health,
    regime anomaly detection, top hotspot systems, dramatic moments, run delta
    (what changed vs last run), and ranked evolution proposals. evolve=True (default)
    appends suggest_evolution output so no separate call is needed. critique=True
    appends a musical prose critique via Claude synthesis. Replaces pipeline_digest +
    regime_anomaly + evolution_delta + composition_critique + suggest_evolution.
    FRESHNESS GUARD: only runs if pipeline output files are newer than last digest call.
    If stale, auto-runs check_pipeline and returns its status instead."""
    ctx.ensure_ready_sync()
    _track("pipeline_digest")

    # In-progress guard: reject if pipeline is still running.
    # Partial output files written mid-pipeline pass the freshness check below,
    # so this must come FIRST to prevent digesting incomplete data.
    status = check_pipeline()
    if "IN PROGRESS" in status:
        return (
            "pipeline_digest: pipeline is still running — cannot digest partial results.\n"
            f"{status}\n\n"
            "Do substantive work while waiting (implement next evolution, run what_did_i_forget, "
            "update KB/docs, explore with module_intel). The background task fires a notification "
            "when done — then call pipeline_digest."
        )

    # Freshness guard: only run if pipeline has produced new output since last digest.
    if not _pipeline_outputs_fresh():
        stale_summary = ""
        try:
            summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
            if os.path.isfile(summary_path):
                with open(summary_path) as _sf:
                    summary = json.load(_sf)
                beats_data = summary.get("beats", {})
                total_beats = beats_data.get("totalEntries", "?") if isinstance(beats_data, dict) else "?"
                regimes = summary.get("regimes", {})
                total_regime = sum(regimes.values()) if regimes else 1
                regime_str = ", ".join(f"{k}:{v/total_regime:.0%}" for k, v in sorted(regimes.items(), key=lambda x: -x[1]))
                top_trust = summary.get("trustDominance", {}).get("dominantSystems", [])
                trust_str = ", ".join(f"{s['system']}({s.get('score',0):.2f})" for s in top_trust[:3]) if top_trust else "?"
                fp_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "fingerprint-comparison.json")
                fp_verdict = "?"
                if os.path.isfile(fp_path):
                    with open(fp_path) as _fp:
                        fp = json.load(_fp)
                    verdict = fp.get("verdict", "?")
                    drifted = fp.get("driftedDimensions", 0)
                    total_fp = fp.get("totalDimensions", 0)
                    fp_verdict = f"{verdict} ({drifted}/{total_fp} drifted)"
                stale_summary = (
                    f"\n## Last Run (cached)\n"
                    f"  Beats: {total_beats} | Regimes: {regime_str}\n"
                    f"  Top trust: {trust_str}\n"
                    f"  Fingerprints: {fp_verdict}\n"
                )
        except Exception:
            pass
        return (
            "pipeline_digest: no new pipeline output since last digest.\n"
            f"{status}"
            f"{stale_summary}"
            "\nRun `npm run main` for a fresh pipeline, then call pipeline_digest again."
        )

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
        out.append("")

    # --- Regime Anomaly (inline) ---
    alerts: list = []
    for expected in ["coherent", "evolving", "exploring"]:
        if regime_total.get(expected, 0) == 0:
            alerts.append(f"🔴 DEATH SPIRAL: 0% {expected} — check regimeClassifier warm-start")
    for regime, count in regime_total.items():
        if regime != "initializing" and count / total_beats > 0.75:
            alerts.append(f"🟡 MONOPOLY: {regime} at {count*100//total_beats}% ({count}/{total_beats})")
    trust_inflation: list = []
    for rec in records:
        for sys, data in rec.get("trust", {}).items():
            if not isinstance(data, dict):
                continue
            w = data.get("weight", 1)
            s = data.get("score", 0.5)
            if isinstance(w, (int, float)) and isinstance(s, (int, float)):
                predicted_w = 1.0 + s * 0.75
                if w > predicted_w + 0.15 and s < 0.30:
                    trust_inflation.append(sys)
    from collections import Counter as _Counter
    inflated = _Counter(trust_inflation)
    for sys, cnt in inflated.most_common(2):
        pct = cnt * 100 // total_beats
        if pct > 20:
            alerts.append(f"🟡 TRUST INFLATION: {sys} high weight / low score on {pct}% of beats")
    if alerts:
        out.append("## Regime Alerts")
        out.extend(f"  {a}" for a in alerts)
        out.append("")
    else:
        out.append("## Regime Health: ✓ ALL CLEAR\n")

    # --- Run Delta (last 2 snapshots) ---
    history_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if os.path.isdir(history_dir):
        snaps = sorted([f for f in os.listdir(history_dir) if f.endswith(".json")], reverse=True)
        if len(snaps) >= 2:
            try:
                def _load_snap(fname):
                    with open(os.path.join(history_dir, fname)) as f:
                        return json.load(f)
                cur = _load_snap(snaps[0])
                prev = _load_snap(snaps[1])
                cf = cur.get("features", {})
                pf = prev.get("features", {})
                cp = cur.get("perceptual", {}).get("encodec", {})
                pp = prev.get("perceptual", {}).get("encodec", {})
                delta_lines = []
                for label, key, fmt in [
                    ("totalNotes", "totalNotes", ".0f"),
                    ("densityMean", "densityMean", ".3f"),
                    ("couplingLabels", "couplingLabelCount", ".0f"),
                    ("tensionArc", "tensionArcShape", ".3f"),
                ]:
                    old_v, new_v = pf.get(key), cf.get(key)
                    if old_v is not None and new_v is not None:
                        d = new_v - old_v
                        sign = "+" if d >= 0 else ""
                        delta_lines.append(
                            f"  {label:<16} {format(old_v, fmt)} → {format(new_v, fmt)}  ({sign}{format(d, fmt)})"
                        )
                for regime in ["coherentShare", "exploringShare", "evolvingShare"]:
                    old_v, new_v = pf.get(regime, 0), cf.get(regime, 0)
                    d = new_v - old_v
                    sign = "+" if d >= 0 else ""
                    delta_lines.append(
                        f"  {regime:<16} {old_v:.1%} → {new_v:.1%}  ({sign}{d:.1%})"
                    )
                old_cb0 = pp.get("cb0_entropy")
                new_cb0 = cp.get("cb0_entropy")
                if old_cb0 is not None and new_cb0 is not None:
                    d = new_cb0 - old_cb0
                    sign = "+" if d >= 0 else ""
                    delta_lines.append(f"  CB0 entropy      {old_cb0:.3f} → {new_cb0:.3f}  ({sign}{d:.3f})")
                if delta_lines:
                    out.append(f"## Run Delta  ({prev.get('timestamp','?')[:16]} → {cur.get('timestamp','?')[:16]})")
                    out.extend(delta_lines)
                    out.append("")
            except Exception:
                pass

    # --- Optional critique ---
    if critique:
        try:
            out.append("## Musical Critique")
            out.append(composition_critique())
        except Exception as e:
            out.append(f"## Musical Critique\n*(unavailable: {e})*")

    # --- Inline evolution suggestions (default on) ---
    if evolve:
        try:
            from .evolution_next import suggest_evolution as _suggest_ev
            out.append("\n---")
            out.append(_suggest_ev())
        except Exception as e:
            out.append(f"\n## Evolution\n*(unavailable: {e})*")

    _touch_digest_sentinel()
    return "\n".join(out)


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
    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(synthesis)
    else:
        parts.append("*Synthesis unavailable.*")

    return "\n".join(parts)
