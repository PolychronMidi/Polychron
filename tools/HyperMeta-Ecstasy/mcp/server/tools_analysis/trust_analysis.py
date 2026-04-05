"""HME trust ecology analysis — trajectories, rivalries, system-level trust dynamics."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HyperMeta-Ecstasy")


def _load_trace(trace_path: str) -> list[dict]:
    records = []
    with open(trace_path, encoding="utf-8") as f:
        for line in f:
            try:
                records.append(json.loads(line))
            except Exception:
                continue
    return records


def trust_trajectory(system_name: str) -> str:
    """Show how a trust system's weight and score evolved section-by-section across the
    full run — its 'career arc'. Reveals if a system is gaining trust, losing it, or
    oscillating. Useful for diagnosing chronic underperformers (high hotspot, low score)
    vs rising stars. Use hotspot_leaderboard first to pick interesting systems."""
    ctx.ensure_ready_sync()
    _track("trust_trajectory")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
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
        return f"Trust system '{system_name}' not found in trace. Check spelling — use hotspot_leaderboard for valid names."

    parts_out = [f"# Trust Trajectory: {system_name}\n"]

    # Global stats
    avg_w = sum(all_weights) / len(all_weights)
    avg_s = sum(all_scores) / len(all_scores) if all_scores else 0
    trend = all_weights[-1] - all_weights[0] if len(all_weights) > 1 else 0
    trend_str = f"▲{trend:+.3f}" if trend > 0.01 else (f"▼{trend:+.3f}" if trend < -0.01 else "→ flat")
    parts_out.append(f"Overall: avg_weight={avg_w:.3f} avg_score={avg_s:.3f} run_trend={trend_str}")
    parts_out.append("")

    # Per-section table
    parts_out.append("Sec | AvgWeight | AvgScore | Hotspot% | Dominant Regime    | Weight Arc")
    parts_out.append("----|-----------|----------|----------|--------------------|------------")
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

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error reading trace: {e}"

    stats: dict = {system_a: defaultdict(list), system_b: defaultdict(list)}
    overtakes: list = []
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

        leader = system_a if wa > wb else system_b
        if prev_leader and leader != prev_leader:
            overtakes.append((bk, prev_leader, leader, abs(wa - wb)))
        prev_leader = leader

    def _fmt(name: str) -> str:
        ws = stats[name]["weights"]
        ss = stats[name]["scores"]
        if not ws:
            return f"{name}: not found"
        return (f"{name}: weight avg={sum(ws)/len(ws):.3f} "
                f"[{min(ws):.3f}–{max(ws):.3f}] | "
                f"score avg={sum(ss)/len(ss):.3f} [{min(ss):.3f}–{max(ss):.3f}]")

    lines = [f"# Trust Rivalry: {system_a} vs {system_b}\n",
             _fmt(system_a), _fmt(system_b)]

    if overtakes:
        lines.append(f"\n## Overtakes ({len(overtakes)} total)")
        for bk, loser, winner, gap in overtakes[:8]:
            lines.append(f"  Beat {bk}: {winner} overtook {loser} (gap={gap:.3f})")
        if len(overtakes) > 8:
            lines.append(f"  ... and {len(overtakes) - 8} more")

    wa_all = stats[system_a]["weights"]
    wb_all = stats[system_b]["weights"]
    if wa_all and wb_all:
        a_led = sum(1 for a, b in zip(wa_all, wb_all) if a > b)
        lines.append(f"\n{system_a} led {a_led}/{len(wa_all)} beats ({a_led/len(wa_all)*100:.0f}%)")
        lines.append(f"{system_b} led {len(wa_all)-a_led}/{len(wa_all)} beats ({(len(wa_all)-a_led)/len(wa_all)*100:.0f}%)")

    return "\n".join(lines)


@ctx.mcp.tool()
def trust_report(system_a: str, system_b: str = "") -> str:
    """Merged trust analysis. If system_b is empty: show system_a's section-by-section
    weight/score career arc (trajectory). If system_b is provided: head-to-head rivalry
    with overtake moments and dominance percentage. Replaces trust_trajectory + trust_rivalry."""
    ctx.ensure_ready_sync()
    _track("trust_report")
    if not system_b.strip():
        return trust_trajectory(system_a)
    return trust_rivalry(system_a, system_b)
