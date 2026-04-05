"""HME section comparison — drill into what changed between two sections."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def section_compare(section_a: int, section_b: int) -> str:
    """Compare two sections head-to-head: regime shift, tension delta, trust system
    winners/losers, coupling label changes, note density change. Reveals what drove
    the transition between sections — useful after composition_arc highlights an
    interesting section pair."""
    ctx.ensure_ready_sync()
    _track("section_compare")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
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
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
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

    # Coupling label changes
    labels_a = set(sa["coupling"].keys())
    labels_b = set(sb["coupling"].keys())
    new_labels = labels_b - labels_a
    lost_labels = labels_a - labels_b
    if new_labels or lost_labels:
        parts_out.append(f"\n## Coupling Changes")
        for lbl in sorted(new_labels)[:5]:
            parts_out.append(f"  + {lbl.split(':')[-1]} ({lbl.split(':')[0]})")
        for lbl in sorted(lost_labels)[:5]:
            parts_out.append(f"  - {lbl.split(':')[-1]} ({lbl.split(':')[0]})")

    return "\n".join(parts_out)


@ctx.mcp.tool()
def regime_timeline(row_width: int = 80) -> str:
    """Visual ASCII timeline of regime transitions across the full composition.
    One character per beat: I=initializing, E=evolving, X=exploring, C=coherent.
    Shows the composition breathing — where coherent blocks form, exploring
    wilderness opens up, and evolving transitions happen. Section boundaries marked."""
    ctx.ensure_ready_sync()
    _track("regime_timeline")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    regime_map = {"initializing": "I", "evolving": "E", "exploring": "X", "coherent": "C"}
    timeline: list = []
    tension_vals: list = []
    section_starts: list = []
    prev_sec = -1

    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
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


@ctx.mcp.tool()
def regime_report(mode: str = "both", row_width: int = 80) -> str:
    """Merged regime analysis tool. mode: 'timeline' (ASCII beat-map of regime transitions),
    'anomaly' (auto-detect death spirals, monopolies, forced-transition storms),
    or 'both' (default, runs both). Replaces calling regime_timeline + regime_anomaly separately."""
    ctx.ensure_ready_sync()
    _track("regime_report")
    from .digest import regime_anomaly
    parts = []
    if mode in ("timeline", "both"):
        parts.append(regime_timeline(row_width))
    if mode in ("anomaly", "both"):
        parts.append(regime_anomaly())
    if not parts:
        return f"Unknown mode '{mode}'. Use 'timeline', 'anomaly', or 'both'."
    return "\n\n".join(parts)
