"""HME trust ecology analysis — trajectories, rivalries, system-level trust dynamics."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


from . import _load_trace  # noqa: F401 — shared helper


# Trust system → what the listener hears (shared with section_compare drama_map)
TRUST_MUSICAL_MEANING: dict[str, str] = {
    "restSynchronizer": "coordinated breathing/silence",
    "stutterContagion": "rhythmic infection spreading",
    "motifEcho": "imitative counterpoint",
    "convergenceDetector": "pattern locking",
    "convergence": "pattern locking",
    "convergenceHarmonicTrigger": "harmonic-driven convergence",
    "convergenceVelocitySurge": "velocity-driven intensity",
    "dynamicRoleSwap": "voice role exchange",
    "roleSwap": "voice role exchange",
    "harmonicIntervalGuard": "interval/dissonance control",
    "feedbackOscillator": "oscillatory feedback texture",
    "temporalGravity": "density gravity pull",
    "crossLayerSilhouette": "timbral silhouette shaping",
    "texturalMirror": "spectral mirroring",
    "rhythmicPhaseLock": "phase synchronization",
    "phaseLock": "phase synchronization",
    "rhythmicComplementEngine": "rhythmic complementarity",
    "rhythmicComplement": "rhythmic complementarity",
    "grooveTransfer": "groove pattern transfer",
    "emergentDownbeat": "spontaneous accent",
    "articulationComplement": "articulation diversity",
    "phaseAwareCadenceWindow": "cadence timing",
    "climaxEngine": "climax building",
    "crossLayerClimaxEngine": "climax building",
    "dynamicEnvelope": "dynamic envelope shaping",
    "coherenceMonitor": "coherence tracking",
    "entropyRegulator": "entropy regulation",
    "velocityInterference": "velocity interference patterns",
    "verticalIntervalMonitor": "vertical interval tracking",
    "spectralComplementarity": "spectral complement matching",
    "registerCollisionAvoider": "register collision avoidance",
    "polyrhythmicPhasePredictor": "polyrhythmic phase prediction",
}


def trust_trajectory(system_name: str) -> str:
    """Show how a trust system's weight and score evolved section-by-section across the
    full run — its 'career arc'. Reveals if a system is gaining trust, losing it, or
    oscillating. Useful for diagnosing chronic underperformers (high hotspot, low score)
    vs rising stars. Use hotspot_leaderboard first to pick interesting systems."""
    ctx.ensure_ready_sync()
    _track("trust_trajectory")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error reading trace: {e}"

    # Per-section stats
    sections: dict = defaultdict(lambda: {"weights": [], "scores": [], "hotspot": [], "regimes": defaultdict(int)})
    all_weights: list = []
    all_scores: list = []
    not_found_sections: set = set()

    for rec in records:
        bk = rec.get("beatKey", "")
        parts = bk.split(":")
        sec = int(parts[0]) if parts and parts[0].isdigit() else -1
        trust = rec.get("trust", {})
        data = trust.get(system_name)
        if not isinstance(data, dict):
            not_found_sections.add(sec)
            continue
        sections[sec]["regimes"][rec.get("regime", "?")] += 1
        w = data.get("weight")
        s = data.get("score")
        hp = data.get("hotspotPressure", 0)
        if isinstance(w, (int, float)):
            sections[sec]["weights"].append(w)
            all_weights.append(w)
        if isinstance(s, (int, float)):
            sections[sec]["scores"].append(s)
            all_scores.append(s)
        if isinstance(hp, (int, float)) and hp > 0.05:
            sections[sec]["hotspot"].append(hp)

    if not all_weights:
        return f"Trust system '{system_name}' not found in trace. Check spelling — use trust_report() (no args) for valid system names."

    role = TRUST_MUSICAL_MEANING.get(system_name, "")
    role_s = f" — {role}" if role else ""
    parts_out = [f"# Trust Trajectory: {system_name}{role_s}\n"]

    # Global stats
    avg_w = sum(all_weights) / len(all_weights)
    avg_s = sum(all_scores) / len(all_scores) if all_scores else 0
    trend = all_weights[-1] - all_weights[0] if len(all_weights) > 1 else 0
    trend_str = f"▲{trend:+.3f}" if trend > 0.01 else (f"▼{trend:+.3f}" if trend < -0.01 else "→ flat")
    parts_out.append(f"Overall: avg_weight={avg_w:.3f} avg_score={avg_s:.3f} run_trend={trend_str}")
    parts_out.append("")

    # Per-section table
    parts_out.append("Sec | AvgWeight (Δ)         | AvgScore | Hotspot% | Dominant Regime    | Weight Arc")
    parts_out.append("-")
    prev_avg_w = None
    for sec_num in sorted(sections.keys()):
        s = sections[sec_num]
        ws = s["weights"]
        ss = s["scores"]
        hs = s["hotspot"]
        beats = len(ws) if ws else 1
        avg_w_s = sum(ws) / len(ws) if ws else 0
        avg_s_s = sum(ss) / len(ss) if ss else 0
        hp_pct = len(hs) / beats * 100 if beats > 0 else 0
        dom_regime = max(s["regimes"].items(), key=lambda x: x[1])[0] if s["regimes"] else "?"

        # Weight arc: sparkline across beats (sample every N)
        step = max(1, len(ws) // 20)
        sampled = ws[::step]
        w_min = min(sampled) if sampled else 0
        w_max = max(sampled) if sampled else 0
        w_range = w_max - w_min or 0.001
        spark = "".join("▁▂▃▄▅▆▇█"[min(7, int((v - w_min) / w_range * 7))] for v in sampled)

        delta = f" Δ{avg_w_s - prev_avg_w:+.3f}" if prev_avg_w is not None else ""
        parts_out.append(
            f"  {sec_num} | {avg_w_s:9.3f}{delta:<9} | {avg_s_s:8.3f} | {hp_pct:7.1f}% | {dom_regime:<18} | {spark}"
        )
        prev_avg_w = avg_w_s

    # Highlight concerning patterns
    concerns = []
    for sec_num, s in sections.items():
        ws = s["weights"]
        ss = s["scores"]
        hs = s["hotspot"]
        beats = len(ws) if ws else 1
        if ws and ss:
            if sum(ss) / len(ss) < 0.35 and sum(ws) / len(ws) > 1.1:
                concerns.append(f"  S{sec_num}: low score ({sum(ss)/len(ss):.3f}) but weight {sum(ws)/len(ws):.3f} — trust inflation")
            hp_pct = len(hs) / beats
            if hp_pct > 0.5:
                concerns.append(f"  S{sec_num}: {hp_pct*100:.0f}% hotspot rate — chronic underperformance vs pair")

    if concerns:
        parts_out.append("\n## Concerns")
        parts_out.extend(concerns)

    return "\n".join(parts_out)


def trust_rivalry(system_a: str, system_b: str) -> str:
    """Compare two trust systems head-to-head across the full run: weight, score, hotspot
    pressure, and section-by-section dominance. Find the moments where one overtook the
    other. Best used after composition_arc reveals interesting trust dynamics."""
    ctx.ensure_ready_sync()
    _track("trust_rivalry")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error reading trace: {e}"

    stats: dict = {system_a: defaultdict(list), system_b: defaultdict(list)}
    overtakes: list = []
    section_leads: dict = {}  # section_idx → {system_a: beats, system_b: beats}
    prev_leader = None

    for rec in records:
        bk = rec.get("beatKey", "?")
        trust = rec.get("trust", {})
        da = trust.get(system_a)
        db = trust.get(system_b)
        if not isinstance(da, dict) or not isinstance(db, dict):
            continue
        wa = da.get("weight", 0)
        wb = db.get("weight", 0)
        stats[system_a]["weights"].append(wa)
        stats[system_b]["weights"].append(wb)
        stats[system_a]["scores"].append(da.get("score", 0))
        stats[system_b]["scores"].append(db.get("score", 0))

        # Extract section index from beatKey (format: section:phrase:bar:beat)
        try:
            sec = int(str(bk).split(":")[0])
        except Exception as _err:
            logger.debug(f"unnamed-except trust_analysis.py:201: {type(_err).__name__}: {_err}")
            sec = -1
        if sec not in section_leads:
            section_leads[sec] = {system_a: 0, system_b: 0}
        leader = system_a if wa > wb else system_b
        section_leads[sec][leader] = section_leads[sec].get(leader, 0) + 1
        if prev_leader and leader != prev_leader:
            overtakes.append((sec, prev_leader, leader, abs(wa - wb)))
        prev_leader = leader

    def _fmt(name: str) -> str:
        ws = stats[name]["weights"]
        ss = stats[name]["scores"]
        if not ws:
            return f"{name}: not found"
        return (f"{name}: weight avg={sum(ws)/len(ws):.3f} "
                f"[{min(ws):.3f}–{max(ws):.3f}] | "
                f"score avg={sum(ss)/len(ss):.3f} [{min(ss):.3f}–{max(ss):.3f}]")

    role_a = TRUST_MUSICAL_MEANING.get(system_a, "")
    role_b = TRUST_MUSICAL_MEANING.get(system_b, "")
    subtitle = ""
    if role_a and role_b:
        subtitle = f"\n  {role_a} vs {role_b}\n"
    lines = [f"# Trust Rivalry: {system_a} vs {system_b}{subtitle}",
             _fmt(system_a), _fmt(system_b)]

    # Section-level dominance (much more useful than raw beat coords)
    sec_lines = []
    for sec in sorted(k for k in section_leads if k >= 0):
        la = section_leads[sec].get(system_a, 0)
        lb = section_leads[sec].get(system_b, 0)
        total = la + lb
        if total > 0:
            winner = system_a if la > lb else system_b
            pct = max(la, lb) / total * 100
            sec_lines.append(f"  S{sec}: {winner} ({pct:.0f}%)")
    if sec_lines:
        lines.append(f"\n## Section Dominance")
        lines.extend(sec_lines)

    if overtakes:
        # Summarize overtakes by section instead of listing all beat coords
        sec_flip_counts: dict = {}
        for sec, loser, winner, gap in overtakes:
            sec_flip_counts[sec] = sec_flip_counts.get(sec, 0) + 1
        lines.append(f"\n## Overtakes ({len(overtakes)} total, by section)")
        for sec in sorted(sec_flip_counts):
            lines.append(f"  S{sec}: {sec_flip_counts[sec]} flip(s)")

    wa_all = stats[system_a]["weights"]
    wb_all = stats[system_b]["weights"]
    if wa_all and wb_all:
        a_led = sum(1 for a, b in zip(wa_all, wb_all) if a > b)
        lines.append(f"\n{system_a} led {a_led}/{len(wa_all)} beats ({a_led/len(wa_all)*100:.0f}%)")
        lines.append(f"{system_b} led {len(wa_all)-a_led}/{len(wa_all)} beats ({(len(wa_all)-a_led)/len(wa_all)*100:.0f}%)")

    return "\n".join(lines)


def trust_report(system_a: str = "", system_b: str = "", mode: str = "both") -> str:
    """Unified trust analysis. No args → leaderboard overview of all systems.
    system_a only → trajectory (weight/score arc, hotspot patterns, concerns).
    system_a + system_b → rivalry (head-to-head, overtakes, dominance).
    mode='rivalry': force rivalry mode. mode='trajectory': trajectory only."""
    ctx.ensure_ready_sync()
    _track("trust_report")

    if not system_a.strip():
        # Overview mode: sample first 200 trace records, rank all systems by avg weight
        trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
        if not os.path.isfile(trace_path):
            return "No trace.jsonl found. Run pipeline first."
        try:
            records = []
            with open(trace_path, encoding="utf-8") as _f:
                for _line in _f:
                    if len(records) >= 200:
                        break
                    try:
                        records.append(json.loads(_line))
                    except Exception as _err:
                        logger.debug(f"unnamed-except trust_analysis.py:282: {type(_err).__name__}: {_err}")
                        continue
            agg: dict = defaultdict(lambda: {"weights": [], "scores": [], "hotspot": []})
            for rec in records:
                for name, data in rec.get("trust", {}).items():
                    if not isinstance(data, dict):
                        continue
                    w = data.get("weight")
                    s = data.get("score")
                    hp = data.get("hotspotPressure", 0)
                    if isinstance(w, (int, float)):
                        agg[name]["weights"].append(w)
                    if isinstance(s, (int, float)):
                        agg[name]["scores"].append(s)
                    if isinstance(hp, (int, float)) and hp > 0.05:
                        agg[name]["hotspot"].append(hp)

            ranked = sorted(
                [(n, sum(d["weights"]) / len(d["weights"]),
                  sum(d["scores"]) / len(d["scores"]) if d["scores"] else 0,
                  len(d["hotspot"]) / len(d["weights"]) if d["weights"] else 0)
                 for n, d in agg.items() if d["weights"]],
                key=lambda x: -x[1]
            )
            lines = [f"# Trust Leaderboard (sample: {len(records)} beats)\n",
                     f"{'System':<28} {'AvgWeight':>9} {'AvgScore':>9} {'Hotspot%':>9}  Musical Role",
                     "-" * 85]
            for name, w, sc, hp in ranked[:25]:
                role = TRUST_MUSICAL_MEANING.get(name, "")
                lines.append(f"  {name:<26} {w:9.3f} {sc:9.3f} {hp*100:8.1f}%  {role}")
            lines.append(f"\nTotal systems: {len(ranked)}  |  trust_report(system) for full trajectory")
            return "\n".join(lines)
        except Exception as e:
            return f"Error building trust overview: {e}"

    if mode == "rivalry" or (mode == "both" and system_b.strip()):
        if not system_b.strip():
            return "Error: system_b required for rivalry mode."
        return trust_rivalry(system_a, system_b)
    return trust_trajectory(system_a)
