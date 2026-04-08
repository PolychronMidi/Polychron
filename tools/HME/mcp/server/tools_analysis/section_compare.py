"""HME section comparison — drill into what changed between two sections."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


# Coupling label → musical meaning (from Polychron coupling engine semantics)
_COUPLING_LABEL_MEANING: dict[str, str] = {
    "locked": "tightly synchronized — movements mirror each other",
    "drifting": "loosely coupled — independent but aware",
    "opposing": "antagonistic — one rises as other falls",
    "converging": "approaching sync — building toward lock",
    "diverging": "separating — increasing independence",
    "resonant": "harmonic reinforcement — shared frequency peaks",
    "decoupled": "fully independent — no interaction",
    "entangled": "complex bidirectional — hard to predict one from other",
}


def _coupling_label_display(raw_label: str) -> str:
    """Format a coupling label with musical meaning."""
    parts = raw_label.split(":")
    if len(parts) >= 2:
        pair = parts[0]
        label = parts[-1]
        meaning = _COUPLING_LABEL_MEANING.get(label, "")
        suffix = f" ({meaning})" if meaning else ""
        return f"{label}{suffix} [{pair}]"
    return raw_label


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
                    rec = json.loads(line)
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
    except Exception:
        pass

    return "\n".join(out)
