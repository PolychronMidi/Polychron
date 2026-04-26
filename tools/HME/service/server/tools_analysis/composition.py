"""HME composition-level analysis — section arcs, trust rivalries, coupling evolution."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


from . import _load_trace  # noqa: F401 — shared helper, avoids duplicate in each trace tool


def composition_arc() -> str:
    """Full composition biography: for every section, show regime distribution,
    tension arc (avg/peak), dominant trust systems, coupling labels, and note density.
    The conductor's-eye-view of how the piece unfolds from start to finish."""
    ctx.ensure_ready_sync()
    _track("composition_arc")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    # Aggregate per section
    sections: dict = defaultdict(lambda: {
        "beats": 0, "regimes": defaultdict(int),
        "tensions": [], "note_counts": [],
        "coupling_counts": defaultdict(int),
        "trust_weights": defaultdict(list),
        "profiles": defaultdict(int),
    })

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error reading trace: {e}"

    for rec in records:
        bk = rec.get("beatKey", "")
        parts = bk.split(":")
        if not parts:
            continue
        sec = int(parts[0]) if parts[0].isdigit() else -1
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

        notes = rec.get("notes", [])
        s["note_counts"].append(len(notes))

        for pair, label in (rec.get("couplingLabels") or {}).items():
            s["coupling_counts"][f"{pair}:{label}"] += 1

        trust = rec.get("trust", {})
        for sys_name, data in trust.items():
            if isinstance(data, dict):
                w = data.get("weight")
                if isinstance(w, (int, float)):
                    s["trust_weights"][sys_name].append(w)

    if not sections:
        return "No section data found."

    parts = ["# Composition Arc\n"]
    from .runtime import _check_trace_staleness
    _stale = _check_trace_staleness()
    if _stale:
        parts.append(_stale)
    for sec_num in sorted(sections.keys()):
        s = sections[sec_num]
        beats = s["beats"]
        label = f"Section {sec_num}"

        # Regime distribution (sorted by count)
        regime_str = ", ".join(
            f"{r}:{c}" for r, c in sorted(s["regimes"].items(), key=lambda x: -x[1])
        )

        # Tension stats
        tensions = s["tensions"]
        if tensions:
            avg_t = sum(tensions) / len(tensions)
            peak_t = max(tensions)
            tension_str = f"avg={avg_t:.3f} peak={peak_t:.3f}"
            # ASCII bar: 20 chars wide
            bar_len = int(avg_t * 20)
            bar = "█" * bar_len + "░" * (20 - bar_len)
            tension_str += f" [{bar}]"
        else:
            tension_str = "no data"

        # Note density
        if s["note_counts"]:
            avg_notes = sum(s["note_counts"]) / len(s["note_counts"])
            peak_notes = max(s["note_counts"])
            density_str = f"avg={avg_notes:.0f} peak={peak_notes}"
        else:
            density_str = "no data"

        # Top 3 trust systems by avg weight
        top_trust = sorted(
            ((n, sum(ws) / len(ws)) for n, ws in s["trust_weights"].items()),
            key=lambda x: -x[1]
        )[:3]
        trust_str = ", ".join(f"{n}({w:.2f})" for n, w in top_trust)

        # Most frequent coupling labels
        top_couplings = sorted(s["coupling_counts"].items(), key=lambda x: -x[1])[:3]
        coupling_str = " | ".join(lbl.split(":")[-1] for lbl, _ in top_couplings)

        # Dominant profile
        dom_profile = max(s["profiles"].items(), key=lambda x: x[1])[0] if s["profiles"] else "?"

        parts.append(f"## {label} ({beats} beats, {dom_profile})")
        parts.append(f"  Regimes:  {regime_str}")
        parts.append(f"  Tension:  {tension_str}")
        parts.append(f"  Notes:    {density_str}")
        parts.append(f"  Trust:    {trust_str}")
        parts.append(f"  Coupling: {coupling_str}")

    return "\n".join(parts)


def hotspot_leaderboard() -> str:
    """Rank all trust systems by how often they appear under hotspot pressure across
    the full run. Reveals chronic underperformers vs consistently dominant systems.
    The 'most wanted' list of the trust ecology."""
    ctx.ensure_ready_sync()
    _track("hotspot_leaderboard")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error reading trace: {e}"

    hotspot_counts: dict = defaultdict(int)
    hotspot_pressure: dict = defaultdict(list)
    beat_counts: dict = defaultdict(int)
    total_beats = len(records)

    for rec in records:
        trust = rec.get("trust", {})
        for sys_name, data in trust.items():
            if not isinstance(data, dict):
                continue
            beat_counts[sys_name] += 1
            hp = data.get("hotspotPressure", 0)
            if hp > 0.1:
                hotspot_counts[sys_name] += 1
                hotspot_pressure[sys_name].append(hp)

    if not hotspot_counts:
        return "No hotspot data found."

    # Sort by hotspot frequency
    ranked = sorted(
        hotspot_counts.items(),
        key=lambda x: -x[1]
    )

    parts = [f"# Hotspot Leaderboard ({total_beats} beats)\n"]
    parts.append("Rank | System                    | Beats% | Avg Pressure | Peak Pressure")
    parts.append("--")
    for i, (name, count) in enumerate(ranked, 1):
        total = beat_counts.get(name, 1)
        pct = count / total * 100
        pressures = hotspot_pressure.get(name, [0])
        avg_p = sum(pressures) / len(pressures)
        peak_p = max(pressures)
        bar = "▓" * int(pct / 5)  # 1 char per 5%
        parts.append(f"  {i:2d} | {name:<25} | {pct:5.1f}% {bar:<20} | {avg_p:.3f} | {peak_p:.3f}")
        if i >= 27:
            break

    return "\n".join(parts)


def composition_events(mode: str = "both", top_n: int = 10) -> str:
    """Unified composition analysis hub. mode='both' (default): section arc + drama moments.
    mode='arc': full section biography (regime/tension/trust/notes per section).
    mode='drama': top-N most dramatic trust swings and regime transitions.
    mode='hotspots': trust systems ranked by hotspot pressure frequency.
    mode='full': all three views combined."""
    ctx.ensure_ready_sync()
    _track("composition_events")
    from .runtime import drama_finder
    parts = []
    if mode in ("arc", "both", "full"):
        parts.append(composition_arc())
    if mode in ("drama", "both", "full"):
        parts.append(drama_finder(top_n))
    if mode in ("hotspots", "full"):
        parts.append(hotspot_leaderboard())
    if not parts:
        return f"Unknown mode '{mode}'. Use 'arc', 'drama', 'hotspots', 'both', or 'full'."
    return "\n\n".join(parts)
