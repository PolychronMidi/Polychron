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

                # Multiple simultaneous hotspots — amplified by tension
                snap = record.get("snap", {})
                tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
                note_count = len(record.get("notes", []))
                active_hotspots = sum(1 for s in trust.values()
                                      if isinstance(s, dict) and s.get("hotspotPressure", 0) > 0.2)
                if active_hotspots >= 3:
                    # Tension and note density amplify drama; max_hotspot_pressure shows peak stress
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
    # Also enforce beat diversity: don't let one beat dominate all top_n slots
    final: list = []
    beat_count: dict = {}
    for ev in deduped:
        if beat_count.get(ev["beat"], 0) < 2:  # max 2 events per beat in top results
            final.append(ev)
            beat_count[ev["beat"]] = beat_count.get(ev["beat"], 0) + 1
        if len(final) >= top_n * 3:
            break
    top = final[:top_n]

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
