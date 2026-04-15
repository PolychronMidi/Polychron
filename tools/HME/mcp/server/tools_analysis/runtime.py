"""HME runtime intelligence — drama finder, beat snapshots, trace-intensive tools."""
import json
import os
import logging
import glob as _glob

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


def _check_trace_staleness() -> str:
    """Compare trace.jsonl mtime against latest run-history snapshot. Returns warning if stale."""
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    rh_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if not os.path.isfile(trace_path) or not os.path.isdir(rh_dir):
        return ""
    trace_mtime = os.path.getmtime(trace_path)
    snapshots = sorted(_glob.glob(os.path.join(rh_dir, "*.json")))
    if not snapshots:
        return ""
    latest_mtime = os.path.getmtime(snapshots[-1])
    delta_sec = abs(trace_mtime - latest_mtime)
    if delta_sec > 300:
        from datetime import datetime
        trace_ts = datetime.fromtimestamp(trace_mtime).strftime("%Y-%m-%d %H:%M")
        snap_ts = datetime.fromtimestamp(latest_mtime).strftime("%Y-%m-%d %H:%M")
        return (f"\n> **STALE DATA WARNING**: trace.jsonl ({trace_ts}) is from a different "
                f"pipeline run than the latest snapshot ({snap_ts}). "
                f"Run `npm run main` to sync.\n")
    return ""


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
                except Exception as _err:
                    logger.debug(f"unnamed-except runtime.py:55: {type(_err).__name__}: {_err}")
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

    # Micro-narrative synthesis for top 3 events
    from .synthesis import _local_think, _REASONING_MODEL
    top3_summary = "\n".join(
        f"{i+1}. Beat {ev['beat']} [{ev['type']}]: {ev['detail']}"
        for i, ev in enumerate(top[:3])
    )
    narrative = _local_think(
        f"For each of these 3 dramatic moments in a generative music composition, "
        f"write ONE sentence explaining WHY it was dramatic musically (what the listener would hear). "
        f"Be specific about musical effects like rhythmic disruption, textural shift, harmonic tension.\n\n"
        f"{top3_summary}",
        max_tokens=512, model=_REASONING_MODEL
    )
    if narrative:
        parts.append(f"\n## What the Listener Hears")
        parts.append(narrative)

    return "\n".join(parts)


def beat_snapshot(beat_key: str) -> str:
    """Show the complete system state at a specific beat: regime, all trust scores/weights,
    snap fields, coupling labels, notes emitted. A cross-section of everything happening
    at one moment in the composition.

    beat_key formats (flexible):
      '2:1:3:0' — exact section:phrase:measure:beat key
      '2:1'     — prefix match (finds first beat starting with '2:1:')
      '400'     — plain number: finds the 400th trace record (0-indexed)
      'S3'      — section shorthand: finds first beat in section 3"""
    ctx.ensure_ready_sync()
    _track("beat_snapshot")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    target = beat_key.strip()
    record = None

    # Detect format: plain number (Nth record), section shorthand (S3), or beat key
    import re as _re
    section_match = _re.match(r'^[Ss](\d+)$', target)
    is_plain_number = _re.match(r'^\d+$', target) and ':' not in target

    try:
        with open(trace_path, encoding="utf-8") as f:
            if is_plain_number:
                # Plain number: skip to Nth record
                idx = int(target)
                for i, line in enumerate(f):
                    if i == idx:
                        try:
                            record = json.loads(line)
                        except Exception as _err1:
                            logger.debug(f"json.loads: {type(_err1).__name__}: {_err1}")
                        break
            elif section_match:
                # Section shorthand: find first beat in that section
                section_num = section_match.group(1)
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception as _err:
                        logger.debug(f"unnamed-except runtime.py:231: {type(_err).__name__}: {_err}")
                        continue
                    bk = r.get("beatKey", "")
                    if bk.startswith(section_num + ":"):
                        record = r
                        break
            else:
                # Exact or prefix match
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception as _err:
                        logger.debug(f"unnamed-except runtime.py:242: {type(_err).__name__}: {_err}")
                        continue
                    bk = r.get("beatKey", "")
                    if bk == target or bk.startswith(target + ":"):
                        record = r
                        break
    except Exception as e:
        return f"Error reading trace: {e}"

    if not record:
        # Count total records for helpful message
        try:
            with open(trace_path, encoding="utf-8") as f:
                total = sum(1 for _ in f)
        except Exception as _err:
            logger.debug(f"unnamed-except runtime.py:256: {type(_err).__name__}: {_err}")
            total = "?"
        return (f"Beat '{beat_key}' not found in trace.jsonl ({total} records total).\n"
                f"Accepted formats: '2:1:3:0' (exact key), '2:1' (prefix), '400' (Nth record), 'S3' (section 3)")

    parts = [f"## Beat Snapshot: {beat_key}\n"]
    _stale = _check_trace_staleness()
    if _stale:
        parts.append(_stale)

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
