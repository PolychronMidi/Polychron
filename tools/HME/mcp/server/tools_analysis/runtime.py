"""HME runtime intelligence — drama finder, beat snapshots, trace-intensive tools."""
import json
import os
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def drama_finder(top_n: int = 10) -> str:
    """Find the N most dramatic moments in the last pipeline run: largest trust weight
    swings, regime transitions with hotspot pressure, convergence cascades. The
    'highlight reel' of the composition's most intense system interactions."""
    ctx.ensure_ready_sync()
    _track("drama_finder")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    events = []
    prev_regime = None
    prev_weights = {}

    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                beat_key = record.get("beatKey", "?")
                regime = record.get("regime", "?")
                trust = record.get("trust", {})

                # Snap fields available to all event types
                snap = record.get("snap", {})
                tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
                note_count = len(record.get("notes", []))

                # Regime transition — highest base drama (system fundamental shift)
                if regime != prev_regime and prev_regime is not None:
                    hotspots = [(n, round(d.get("hotspotPressure", 0), 3))
                                for n, d in trust.items()
                                if isinstance(d, dict) and d.get("hotspotPressure", 0) > 0.1]
                    drama = 10.0 + len(hotspots) * 0.5 + tension * 3.0
                    events.append({
                        "beat": beat_key, "drama": drama,
                        "type": "regime_transition",
                        "detail": f"{prev_regime} → {regime} | {len(hotspots)} hotspots | tension={tension:.3f}",
                        "hotspots": hotspots[:3],
                    })

                # Weight swings — trust system seizing or losing control
                for sys_name, sys_data in trust.items():
                    if not isinstance(sys_data, dict):
                        continue
                    weight = sys_data.get("weight", 1.0)
                    prev_w = prev_weights.get(sys_name, weight)
                    swing = abs(weight - prev_w)
                    if swing > 0.15:
                        drama = swing * 20.0 + tension * 2.0
                        events.append({
                            "beat": beat_key, "drama": drama,
                            "type": "weight_swing",
                            "detail": f"{sys_name}: {prev_w:.3f}→{weight:.3f} (Δ{swing:.3f}) | tension={tension:.3f}",
                        })
                    prev_weights[sys_name] = weight

                # Multiple simultaneous hotspots — sustained systemic stress
                active_hotspots = sum(1 for s in trust.values()
                                      if isinstance(s, dict) and s.get("hotspotPressure", 0) > 0.2)
                if active_hotspots >= 3:
                    max_hp = max((s.get("hotspotPressure", 0) for s in trust.values()
                                  if isinstance(s, dict)), default=0)
                    drama = active_hotspots * 0.8 + tension * 3.0 + max_hp * 2.0 + min(note_count / 50, 2.0)
                    events.append({
                        "beat": beat_key, "drama": drama,
                        "type": "multi_hotspot",
                        "detail": (f"{active_hotspots} hotspots | tension={tension:.3f} | "
                                   f"peak_hp={max_hp:.3f} | {note_count} notes"),
                    })

                prev_regime = regime
    except Exception as e:
        return f"Error reading trace: {e}"

    if not events:
        return "No dramatic moments detected."

    # Sort by drama score descending
    events.sort(key=lambda e: -e["drama"])

    # Deduplicate consecutive same-type same-beat-key runs — keep highest, skip the rest
    deduped = []
    seen_run: dict = {}  # type -> last beat key that was emitted
    for ev in events:
        run_key = (ev["type"], ev["beat"])
        if run_key not in seen_run:
            deduped.append(ev)
            seen_run[run_key] = True
    # Bucket by type with section-diversity cap: max N multi_hotspot per section
    per_type: dict = {"multi_hotspot": [], "regime_transition": [], "weight_swing": []}
    seen_beats_by_type: dict = {t: set() for t in per_type}
    section_counts: dict = {}  # "type:section" -> count
    max_per_section = max(top_n // 3, 3)  # prevent one section from monopolizing
    for ev in deduped:
        t = ev["type"]
        if t not in per_type or ev["beat"] in seen_beats_by_type[t]:
            continue
        section = ev["beat"].split(":")[0] if ":" in ev["beat"] else "?"
        sec_key = f"{t}:{section}"
        if section_counts.get(sec_key, 0) >= max_per_section:
            continue
        per_type[t].append(ev)
        seen_beats_by_type[t].add(ev["beat"])
        section_counts[sec_key] = section_counts.get(sec_key, 0) + 1

    # Guaranteed minimums per type
    quota = max(top_n // 4, 2)
    top = []
    for t, evs in per_type.items():
        top.extend(evs[:quota])
    # Fill remaining slots with highest-drama events not already included
    included_keys = {(e["beat"], e["type"]) for e in top}
    for ev in deduped:
        if len(top) >= top_n:
            break
        k = (ev["beat"], ev["type"])
        if k not in included_keys:
            top.append(ev)
            included_keys.add(k)
    top.sort(key=lambda e: -e["drama"])
    top = top[:top_n]

    parts = [f"## Drama Finder — Top {len(top)} Most Dramatic Moments\n"]
    for i, ev in enumerate(top, 1):
        parts.append(f"**{i}. Beat {ev['beat']}** [{ev['type']}] (drama: {ev['drama']:.1f})")
        parts.append(f"  {ev['detail']}")
        if ev.get("hotspots"):
            parts.append(f"  hotspots: {', '.join(f'{n}={v}' for n, v in ev['hotspots'])}")
    return "\n".join(parts)


@ctx.mcp.tool()
def beat_snapshot(beat_key: str) -> str:
    """Show the complete system state at a specific beat: regime, all trust scores/weights,
    snap fields, coupling labels, notes emitted. A cross-section of everything happening
    at one moment in the composition."""
    ctx.ensure_ready_sync()
    _track("beat_snapshot")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    # Find the beat — exact match first, then prefix match (e.g. "3:0" finds "3:0:0:0")
    target = beat_key.strip()
    record = None
    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                bk = r.get("beatKey", "")
                if bk == target or bk.startswith(target + ":"):
                    record = r
                    break
    except Exception as e:
        return f"Error reading trace: {e}"

    if not record:
        return f"Beat '{beat_key}' not found in trace.jsonl."

    parts = [f"## Beat Snapshot: {beat_key}\n"]

    # Regime and timing
    parts.append(f"**Regime:** {record.get('regime', '?')}")
    parts.append(f"**Layer:** {record.get('layer', '?')}")
    parts.append(f"**Time:** {record.get('timeMs', '?')}ms")

    # Trust scores — sorted by weight (most influential first)
    trust = record.get("trust", {})
    if trust:
        trust_sorted = sorted(
            ((k, v) for k, v in trust.items() if isinstance(v, dict)),
            key=lambda x: -x[1].get("weight", 0)
        )
        parts.append(f"\n### Trust Ecology ({len(trust_sorted)} systems)")
        for name, data in trust_sorted:
            w = data.get("weight", 0)
            s = data.get("score", 0)
            dp = data.get("dominantPair", "")
            hp = data.get("hotspotPressure", 0)
            flags = []
            if dp:
                flags.append(f"pair={dp}")
            if hp > 0.05:
                flags.append(f"hotspot={hp:.3f}")
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            parts.append(f"  {name}: weight={w:.3f} score={s:.3f}{flag_str}")

    # Snap fields (conductor signal state)
    snap = record.get("snap", {})
    if snap:
        parts.append(f"\n### Conductor Snap ({len(snap)} fields)")
        for k in sorted(snap.keys()):
            v = snap[k]
            if isinstance(v, float):
                parts.append(f"  {k}: {v:.4f}")
            elif isinstance(v, (int, str, bool)):
                parts.append(f"  {k}: {v}")
            # Skip complex nested objects

    # Coupling labels
    labels = record.get("couplingLabels", {})
    if labels:
        parts.append(f"\n### Coupling Labels")
        for k, v in labels.items():
            parts.append(f"  {k}: {v}")

    # Notes emitted
    notes = record.get("notes", [])
    if notes:
        parts.append(f"\n### Notes ({len(notes)})")
        for n in notes[:8]:
            parts.append(f"  pitch={n.get('pitch', '?')} vel={n.get('velocity', '?')} ch={n.get('channel', '?')}")
        if len(notes) > 8:
            parts.append(f"  ... and {len(notes) - 8} more")

    return "\n".join(parts)
