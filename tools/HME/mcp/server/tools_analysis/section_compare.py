"""HME section comparison — drill into what changed between two sections."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track, _load_trace
from .section_labels import _coupling_label_display
from .drama_map import drama_map

logger = logging.getLogger("HME")


def section_compare(section_a: int, section_b: int) -> str:
    """Compare two sections head-to-head: regime shift, tension delta, trust system
    winners/losers, coupling label changes, note density change. Reveals what drove
    the transition between sections — useful after composition_arc highlights an
    interesting section pair."""
    ctx.ensure_ready_sync()
    _track("section_compare")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    records = _load_trace(trace_path)
    if not records:
        return "No trace.jsonl found."

    sections: dict = {}
    for target in (section_a, section_b):
        sections[target] = {
            "beats": 0, "regimes": defaultdict(int), "tensions": [],
            "note_counts": [], "trust_weights": defaultdict(list),
            "trust_scores": defaultdict(list), "coupling": defaultdict(int),
            "profiles": defaultdict(int), "hotspot_counts": defaultdict(int),
        }

    try:
        for rec in records:
            bk = rec.get("beatKey", "")
            parts = bk.split(":")
            sec = int(parts[0]) if parts and parts[0].isdigit() else -1
            if sec not in sections:
                continue
            s = sections[sec]
            s["beats"] += 1
            s["regimes"][rec.get("regime", "?")] += 1
            snap = rec.get("snap", {})
            if isinstance(snap, dict):
                t = snap.get("tension")
                if isinstance(t, (int, float)):
                    s["tensions"].append(t)
                prof = snap.get("activeProfile", "")
                if prof:
                    s["profiles"][prof] += 1
            s["note_counts"].append(len(rec.get("notes", [])))
            for pair, label in (rec.get("couplingLabels") or {}).items():
                s["coupling"][f"{pair}:{label}"] += 1
            trust = rec.get("trust", {})
            for sys_name, data in trust.items():
                if not isinstance(data, dict):
                    continue
                w = data.get("weight")
                sc = data.get("score")
                hp = data.get("hotspotPressure", 0)
                if isinstance(w, (int, float)):
                    s["trust_weights"][sys_name].append(w)
                if isinstance(sc, (int, float)):
                    s["trust_scores"][sys_name].append(sc)
                if isinstance(hp, (int, float)) and hp > 0.1:
                    s["hotspot_counts"][sys_name] += 1
    except Exception as e:
        return f"Error: {e}"

    sa, sb = sections[section_a], sections[section_b]
    if sa["beats"] == 0 or sb["beats"] == 0:
        return f"Section {section_a if sa['beats'] == 0 else section_b} not found in trace."

    parts_out = [f"# Section {section_a} vs Section {section_b}\n"]

    # Basics
    prof_a = max(sa["profiles"].items(), key=lambda x: x[1])[0] if sa["profiles"] else "?"
    prof_b = max(sb["profiles"].items(), key=lambda x: x[1])[0] if sb["profiles"] else "?"
    parts_out.append(f"  S{section_a}: {sa['beats']} beats, {prof_a}")
    parts_out.append(f"  S{section_b}: {sb['beats']} beats, {prof_b}")

    # Regime shift
    def regime_str(s: dict) -> str:
        return ", ".join(f"{r}:{c}" for r, c in sorted(s["regimes"].items(), key=lambda x: -x[1]))
    parts_out.append(f"\n## Regime")
    parts_out.append(f"  S{section_a}: {regime_str(sa)}")
    parts_out.append(f"  S{section_b}: {regime_str(sb)}")

    # Tension delta
    avg_a = sum(sa["tensions"]) / len(sa["tensions"]) if sa["tensions"] else 0
    avg_b = sum(sb["tensions"]) / len(sb["tensions"]) if sb["tensions"] else 0
    delta = avg_b - avg_a
    direction = "▲" if delta > 0.01 else ("▼" if delta < -0.01 else "→")
    parts_out.append(f"\n## Tension: {avg_a:.3f} → {avg_b:.3f} ({direction}{delta:+.3f})")

    # Note density
    avg_notes_a = sum(sa["note_counts"]) / len(sa["note_counts"]) if sa["note_counts"] else 0
    avg_notes_b = sum(sb["note_counts"]) / len(sb["note_counts"]) if sb["note_counts"] else 0
    parts_out.append(f"## Notes: {avg_notes_a:.0f} → {avg_notes_b:.0f} avg/beat")

    # Trust winners and losers (biggest weight changes)
    trust_deltas: list = []
    all_systems = set(sa["trust_weights"].keys()) | set(sb["trust_weights"].keys())
    for sys in all_systems:
        wa = sum(sa["trust_weights"][sys]) / len(sa["trust_weights"][sys]) if sa["trust_weights"][sys] else 0
        wb = sum(sb["trust_weights"][sys]) / len(sb["trust_weights"][sys]) if sb["trust_weights"][sys] else 0
        if wa > 0 or wb > 0:
            trust_deltas.append((wb - wa, sys, wa, wb))
    trust_deltas.sort(key=lambda x: -abs(x[0]))

    winners: list = []
    losers: list = []
    if trust_deltas:
        winners = [(d, n, wa, wb) for d, n, wa, wb in trust_deltas if d > 0.01][:3]
        losers = [(d, n, wa, wb) for d, n, wa, wb in trust_deltas if d < -0.01][:3]
        if winners:
            parts_out.append(f"\n## Trust Winners (S{section_a}→S{section_b})")
            for d, n, wa, wb in winners:
                parts_out.append(f"  ▲ {n}: {wa:.3f}→{wb:.3f} (+{d:.3f})")
        if losers:
            parts_out.append(f"\n## Trust Losers")
            for d, n, wa, wb in losers:
                parts_out.append(f"  ▼ {n}: {wa:.3f}→{wb:.3f} ({d:.3f})")

    # Hotspot dominance per section (which trust system had most hotspot pressure)
    all_hotspot_systems = set(sa["hotspot_counts"].keys()) | set(sb["hotspot_counts"].keys())
    if all_hotspot_systems:
        parts_out.append(f"\n## Hotspot Activity")
        for sec_label, sec_data in [(f"S{section_a}", sa), (f"S{section_b}", sb)]:
            if sec_data["hotspot_counts"]:
                top_hot = sorted(sec_data["hotspot_counts"].items(), key=lambda x: -x[1])[:3]
                hot_str = ", ".join(f"{name}({count})" for name, count in top_hot)
                parts_out.append(f"  {sec_label}: {hot_str}")
            else:
                parts_out.append(f"  {sec_label}: no hotspot pressure")

    # Coupling label changes — with musical semantics
    labels_a = set(sa["coupling"].keys())
    labels_b = set(sb["coupling"].keys())
    new_labels = labels_b - labels_a
    lost_labels = labels_a - labels_b
    if new_labels or lost_labels:
        parts_out.append(f"\n## Coupling Changes")
        for lbl in sorted(new_labels)[:5]:
            parts_out.append(f"  + {_coupling_label_display(lbl)}")
        for lbl in sorted(lost_labels)[:5]:
            parts_out.append(f"  - {_coupling_label_display(lbl)}")

    # Persistent coupling — labels present in both sections (stable relationships)
    shared_labels = labels_a & labels_b
    if shared_labels:
        # Show top 3 most frequent shared labels
        shared_sorted = sorted(shared_labels, key=lambda l: sb["coupling"].get(l, 0), reverse=True)[:3]
        parts_out.append(f"\n## Stable Coupling (present in both)")
        for lbl in shared_sorted:
            parts_out.append(f"  = {_coupling_label_display(lbl)}")

    # Narrative synthesis — one sentence distilling what the listener hears at this transition
    from .synthesis import _two_stage_think
    from .trust_analysis import TRUST_MUSICAL_MEANING as _TMM
    top_winner = winners[0] if winners else None
    top_loser = losers[0] if losers else None
    winner_role = _TMM.get(top_winner[1], "") if top_winner else ""
    loser_role = _TMM.get(top_loser[1], "") if top_loser else ""
    syn_ctx = (
        f"Section {section_a} vs {section_b} transition in a generative alien music composition.\n"
        f"S{section_a}: dominant regime {max(sa['regimes'], key=lambda r: sa['regimes'][r])}, "
        f"tension={avg_a:.3f}, notes/beat={avg_notes_a:.0f}\n"
        f"S{section_b}: dominant regime {max(sb['regimes'], key=lambda r: sb['regimes'][r])}, "
        f"tension={avg_b:.3f}, notes/beat={avg_notes_b:.0f}\n"
        f"Tension delta: {delta:+.3f}  |  Notes delta: {avg_notes_b - avg_notes_a:+.0f}/beat\n"
        + (f"Trust winner: {top_winner[1]} ({winner_role}) +{top_winner[0]:.3f}\n" if top_winner else "")
        + (f"Trust loser: {top_loser[1]} ({loser_role}) {top_loser[0]:.3f}\n" if top_loser else "")
        + (f"New coupling: {next(iter(new_labels), '')}\n" if new_labels else "")
    )
    narrative = _two_stage_think(
        syn_ctx,
        f"Write ONE sentence (max 40 words) describing what a listener would HEAR at the S{section_a}→S{section_b} transition. Be specific about texture, tension feel, and sonic character."
    )
    if narrative and len(narrative.strip()) > 10:
        parts_out.append(f"\n## What You Hear")
        parts_out.append(f"  {narrative.strip()}")

    # Cross-reference suggestions
    parts_out.append(f"\n---")
    parts_out.append(f"See also: regime_report(mode='drama') for tension spikes and trust reversals")
    if abs(delta) > 0.05:
        parts_out.append(f"Large tension delta — try trust_rivalry to trace which system drove the shift")

    return "\n".join(parts_out)


def regime_timeline(row_width: int = 80) -> str:
    """Visual ASCII timeline of regime transitions across the full composition."""
    ctx.ensure_ready_sync()
    _track("regime_timeline")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    records = _load_trace(trace_path)
    if not records:
        return "No trace.jsonl found."

    regime_map = {"initializing": "I", "evolving": "E", "exploring": "X", "coherent": "C"}
    timeline: list = []
    tension_vals: list = []
    section_starts: list = []
    prev_sec = -1

    try:
        for rec in records:
            bk = rec.get("beatKey", "")
            parts_bk = bk.split(":")
            sec = int(parts_bk[0]) if parts_bk and parts_bk[0].isdigit() else -1
            regime = rec.get("regime", "?")
            snap = rec.get("snap", {})
            tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
            timeline.append(regime_map.get(regime, "?"))
            tension_vals.append(float(tension) if isinstance(tension, (int, float)) else 0.5)
            if sec != prev_sec:
                section_starts.append(len(timeline) - 1)
                prev_sec = sec
    except Exception as e:
        return f"Error: {e}"

    def _tension_char(t: float) -> str:
        if t >= 0.75:
            return "^"
        if t >= 0.55:
            return "+"
        if t <= 0.25:
            return "_"
        return "."

    out = [f"# Regime Timeline ({len(timeline)} beats)", ""]
    out.append("```")
    for start in range(0, len(timeline), row_width):
        chunk = timeline[start:start + row_width]
        t_chunk = tension_vals[start:start + row_width]
        beat_range = f"{start:4d}-{min(start + row_width - 1, len(timeline) - 1):4d}"
        out.append(f"{beat_range} {''.join(chunk)}")
        out.append(f"{'':9s} {''.join(_tension_char(t) for t in t_chunk)}")
    out.append("```")
    out.append("")
    out.append("I=initializing E=evolving X=exploring C=coherent")
    out.append("^=tension>=0.75  +=tension>=0.55  .=mid  _=tension<=0.25")
    out.append("")

    # Section summary with tension stats
    for i, sb in enumerate(section_starts):
        end = section_starts[i + 1] - 1 if i + 1 < len(section_starts) else len(timeline) - 1
        section_chunk = timeline[sb:end + 1]
        t_section = tension_vals[sb:end + 1]
        counts: dict = {}
        for c in section_chunk:
            counts[c] = counts.get(c, 0) + 1
        dom = max(counts.items(), key=lambda x: x[1])[0]
        regime_str = " ".join(f"{k}:{v}" for k, v in sorted(counts.items(), key=lambda x: -x[1]))
        avg_t = sum(t_section) / len(t_section) if t_section else 0.0
        peak_t = max(t_section) if t_section else 0.0
        out.append(f"  S{i} ({end - sb + 1:3d}b) {regime_str} [{dom}] t_avg={avg_t:.2f} t_peak={peak_t:.2f}")

    return "\n".join(out)


def regime_report(mode: str = "both", row_width: int = 80, top_n: int = 5) -> str:
    """Regime + drama analysis. mode='timeline': ASCII beat-map (I=initializing E=evolving
    X=exploring C=coherent) with tension overlay and per-section stats. mode='anomaly':
    auto-detect death spirals, monopolies, forced-transition storms. mode='drama': find the
    composition's most intense moments (tension spikes, sustained coherent blocks, trust
    reversals, density contrast pairs). mode='both' (default): timeline + anomaly."""
    ctx.ensure_ready_sync()
    _track("regime_report")
    from .digest_analysis import regime_anomaly
    parts = []
    if mode in ("timeline", "both"):
        parts.append(regime_timeline(row_width))
    if mode in ("anomaly", "both"):
        parts.append(regime_anomaly())
    if mode == "drama":
        parts.append(drama_map(top_n))
    if not parts:
        return f"Unknown mode '{mode}'. Use 'timeline', 'anomaly', 'drama', or 'both'."
    return "\n\n".join(parts)
