"""HME runtime intelligence — drama finder, beat snapshots, trace-intensive tools."""
import json
import os
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HyperMeta-Ecstasy")


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

                # Regime transition with context
                if regime != prev_regime and prev_regime is not None:
                    # Collect hotspot pressures at this transition
                    hotspots = []
                    for sys_name, sys_data in trust.items():
                        if isinstance(sys_data, dict):
                            hp = sys_data.get("hotspotPressure", 0)
                            if hp > 0.1:
                                hotspots.append((sys_name, round(hp, 3)))
                    drama = 2.0 + len(hotspots) * 0.5  # transitions are dramatic; hotspots amplify
                    events.append({
                        "beat": beat_key, "drama": drama,
                        "type": "regime_transition",
                        "detail": f"{prev_regime} -> {regime}, {len(hotspots)} hotspots",
                        "hotspots": hotspots[:3],
                    })

                # Weight swings — compare to previous beat
                for sys_name, sys_data in trust.items():
                    if not isinstance(sys_data, dict):
                        continue
                    weight = sys_data.get("weight", 1.0)
                    prev_w = prev_weights.get(sys_name, weight)
                    swing = abs(weight - prev_w)
                    if swing > 0.15:  # significant weight swing
                        events.append({
                            "beat": beat_key, "drama": swing * 5,
                            "type": "weight_swing",
                            "detail": f"{sys_name}: {prev_w:.3f} -> {weight:.3f} (swing {swing:.3f})",
                        })
                    prev_weights[sys_name] = weight

                # Multiple simultaneous hotspots (system under pressure)
                active_hotspots = sum(1 for s in trust.values()
                                      if isinstance(s, dict) and s.get("hotspotPressure", 0) > 0.2)
                if active_hotspots >= 3:
                    events.append({
                        "beat": beat_key, "drama": active_hotspots * 0.8,
                        "type": "multi_hotspot",
                        "detail": f"{active_hotspots} systems under hotspot pressure simultaneously",
                    })

                prev_regime = regime
    except Exception as e:
        return f"Error reading trace: {e}"

    if not events:
        return "No dramatic moments detected."

    # Sort by drama score and take top N
    events.sort(key=lambda e: -e["drama"])
    top = events[:top_n]

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

    # Find the beat
    target = beat_key.strip()
    record = None
    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get("beatKey") == target:
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
