"""drama_map — find the composition's most dramatically intense moments."""
import os
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


def drama_map(top_n: int = 5) -> str:
    """Find the composition's most dramatically intense moments from the last pipeline run."""
    ctx.ensure_ready_sync()
    _track("drama_map")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found. Run `npm run main` to generate."

    beats: list[dict] = []
    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    rec = {}
                    import json as _json
                    rec = _json.loads(line)
                    if rec.get("recordType") == "snapshot":
                        continue
                    bk = rec.get("beatKey", "")
                    parts_bk = bk.split(":")
                    sec = int(parts_bk[0]) if parts_bk and parts_bk[0].isdigit() else -1
                    snap = rec.get("snap", {})
                    tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
                    note_count = len(rec.get("notes") or [])
                    regime = rec.get("regime", "?")
                    trust = rec.get("trust", {})
                    beats.append({
                        "idx": len(beats), "sec": sec, "bk": bk,
                        "tension": float(tension) if isinstance(tension, (int, float)) else 0.5,
                        "notes": note_count, "regime": regime, "trust": trust,
                    })
                except Exception:
                    continue
    except Exception as e:
        return f"Error reading trace: {e}"

    if len(beats) < 20:
        return "Not enough trace data (need 20+ beats)."

    out = [f"# Drama Map ({len(beats)} beats)\n"]

    # --- Tension spikes: beats where tension jumped vs 5-beat rolling mean ---
    window = 5
    spike_events: list[tuple[float, dict]] = []
    for i in range(window, len(beats)):
        window_mean = sum(b["tension"] for b in beats[i - window:i]) / window
        delta = beats[i]["tension"] - window_mean
        if abs(delta) > 0.08:
            spike_events.append((delta, beats[i]))
    spike_events.sort(key=lambda x: -abs(x[0]))
    if spike_events:
        out.append(f"## Tension Spikes (top {min(top_n, len(spike_events))})")
        for delta, b in spike_events[:top_n]:
            direction = "▲" if delta > 0 else "▼"
            # Annotate section-boundary drops (first 2 beats of a new section)
            bk_parts = b["bk"].split(":")
            beat_in_section = int(bk_parts[2]) if len(bk_parts) > 2 and bk_parts[2].isdigit() else 99
            ctx_note = " [section-start]" if beat_in_section < 2 and delta < 0 else ""
            out.append(f"  {direction}{delta:+.3f}  beat {b['bk']}  S{b['sec']}  t={b['tension']:.3f}  {b['regime']}  {b['notes']}n{ctx_note}")
        out.append("")

    # --- Sustained coherent blocks (consecutive coherent beats ≥ 8) ---
    coherent_blocks: list[tuple[int, int, int]] = []  # (start_idx, length, sec)
    i = 0
    while i < len(beats):
        if beats[i]["regime"] == "coherent":
            j = i
            while j < len(beats) and beats[j]["regime"] == "coherent":
                j += 1
            length = j - i
            if length >= 8:
                coherent_blocks.append((i, length, beats[i]["sec"]))
            i = j
        else:
            i += 1
    coherent_blocks.sort(key=lambda x: -x[1])
    if coherent_blocks:
        out.append(f"## Sustained Coherent Blocks (top {min(top_n, len(coherent_blocks))}, ≥8 beats)")
        for start, length, sec in coherent_blocks[:top_n]:
            b_start = beats[start]
            b_end = beats[min(start + length - 1, len(beats) - 1)]
            avg_tension = sum(beats[k]["tension"] for k in range(start, start + length)) / length
            out.append(f"  {length:3d}b  {b_start['bk']} → {b_end['bk']}  S{sec}  avg_t={avg_tension:.3f}")
        out.append("")

    # --- Trust reversals: one system rose ≥0.04 while another fell ≥0.04 in same beat ---
    reversal_events: list[tuple[float, dict, str, str, float, float]] = []
    for i in range(1, len(beats)):
        prev_t = beats[i - 1]["trust"]
        curr_t = beats[i]["trust"]
        risers = [(n, curr_t[n].get("score", 0) - prev_t.get(n, {}).get("score", curr_t[n].get("score", 0)))
                  for n in curr_t if isinstance(curr_t[n], dict) and n in prev_t and isinstance(prev_t.get(n), dict)]
        winners = [(n, d) for n, d in risers if d >= 0.04]
        losers = [(n, d) for n, d in risers if d <= -0.04]
        if winners and losers:
            w_n, w_d = max(winners, key=lambda x: x[1])
            l_n, l_d = min(losers, key=lambda x: x[1])
            magnitude = w_d - l_d
            reversal_events.append((magnitude, beats[i], w_n, l_n, w_d, l_d))
    # Musical meaning for trust systems (canonical source in trust_analysis.py)
    from .trust_analysis import TRUST_MUSICAL_MEANING as _TRUST_MUSICAL_MEANING
    reversal_events.sort(key=lambda x: -x[0])
    if reversal_events:
        out.append(f"## Trust Reversals (top {min(top_n, len(reversal_events))})")
        for magnitude, b, winner, loser, w_d, l_d in reversal_events[:top_n]:
            w_meaning = _TRUST_MUSICAL_MEANING.get(winner, "")
            l_meaning = _TRUST_MUSICAL_MEANING.get(loser, "")
            out.append(f"  magnitude={magnitude:.3f}  beat {b['bk']}  S{b['sec']}  {b['regime']}")
            w_label = f" ({w_meaning})" if w_meaning else ""
            l_label = f" ({l_meaning})" if l_meaning else ""
            out.append(f"    ▲ {winner}{w_label} (+{w_d:.3f})  ▼ {loser}{l_label} ({l_d:.3f})")
        out.append("")

    # --- Peak tension moments: beats with highest absolute tension (narrative peaks) ---
    sorted_by_tension = sorted(beats, key=lambda b: b["tension"], reverse=True)
    if sorted_by_tension:
        out.append(f"## Peak Tension Moments (top {min(top_n, len(sorted_by_tension))})")
        seen_sections_pt: set = set()
        shown = 0
        for b in sorted_by_tension:
            if b["tension"] < 0.70:
                break
            # One per section to avoid listing the same block repeatedly
            if b["sec"] in seen_sections_pt:
                continue
            seen_sections_pt.add(b["sec"])
            out.append(f"  t={b['tension']:.3f}  beat {b['bk']}  S{b['sec']}  {b['regime']}  {b['notes']}n")
            shown += 1
            if shown >= top_n:
                break
        out.append("")

    # --- Density contrast pairs: find atmospheric valley (≤2 notes) within 10 beats of dense peak (≥6 notes) ---
    # Filter out warmup beats (S0 first 8 beats) and zero-tension beats (section silence)
    contrast_pairs: list[tuple[float, int, int]] = []
    for i in range(len(beats)):
        b = beats[i]
        if b["notes"] < 6:
            continue
        if b["tension"] < 0.08:  # skip warmup / pre-tension silence
            continue
        if b["sec"] == 0 and b["idx"] < 8:  # skip S0 warmup ramp
            continue
        # Look for valley within ±10 beats
        window_start = max(0, i - 10)
        window_end = min(len(beats), i + 11)
        for j in range(window_start, window_end):
            if beats[j]["notes"] <= 2 and abs(i - j) >= 3 and beats[j]["tension"] >= 0.05:
                contrast = beats[i]["notes"] - beats[j]["notes"]
                contrast_pairs.append((contrast, i, j))
    contrast_pairs.sort(key=lambda x: -x[0])
    seen_peaks: set = set()
    unique_pairs: list = []
    for contrast, peak_i, valley_j in contrast_pairs:
        if peak_i not in seen_peaks:
            seen_peaks.add(peak_i)
            unique_pairs.append((contrast, peak_i, valley_j))
    if unique_pairs:
        out.append(f"## Density Contrast Pairs (peak→valley, top {min(top_n, len(unique_pairs))})")
        for contrast, peak_i, valley_j in unique_pairs[:top_n]:
            b_peak = beats[peak_i]
            b_valley = beats[valley_j]
            gap = abs(peak_i - valley_j)
            direction = "→" if valley_j > peak_i else "←"
            out.append(f"  +{contrast}n  dense={b_peak['bk']}({b_peak['notes']}n,t={b_peak['tension']:.2f}) {direction}{gap}b valley={b_valley['bk']}({b_valley['notes']}n,t={b_valley['tension']:.2f})")
        out.append("")

    # --- Dramatic Arc synthesis: one-sentence summary of what makes this composition compelling ---
    try:
        from .synthesis import _two_stage_think
        sec_count = max((b["sec"] for b in beats), default=0) + 1
        top_tension_sec = max(range(sec_count), key=lambda s: sum(b["tension"] for b in beats if b["sec"] == s) / max(1, sum(1 for b in beats if b["sec"] == s)), default=0)
        top_coherent = coherent_blocks[0] if coherent_blocks else None
        top_reversal = reversal_events[0] if reversal_events else None
        arc_ctx = (
            f"{len(beats)} beats, {sec_count} sections.\n"
            f"Peak tension section: S{top_tension_sec}.\n"
            + (f"Longest coherent block: {top_coherent[1]} beats in S{top_coherent[2]} avg_t={sum(beats[k]['tension'] for k in range(top_coherent[0], top_coherent[0]+top_coherent[1]))/top_coherent[1]:.3f}.\n" if top_coherent else "")
            + (f"Largest trust reversal: {top_reversal[2]} rose +{top_reversal[4]:.3f} while {top_reversal[3]} fell {top_reversal[5]:.3f} in S{top_reversal[1]['sec']}.\n" if top_reversal else "")
        )
        arc_synth = _two_stage_think(arc_ctx, "In ONE sentence (max 40 words): what makes this composition's dramatic arc compelling to a listener? Focus on structural contrast, tension trajectory, and where the narrative peaks.")
        if arc_synth:
            out.append(f"## Dramatic Arc *(adaptive)*")
            out.append(f"  {arc_synth.strip()}")
    except Exception as _err1:
        logger.debug(f"out.append: {type(_err1).__name__}: {_err1}")

    return "\n".join(out)
