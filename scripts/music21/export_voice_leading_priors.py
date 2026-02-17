#!/usr/bin/env python3
"""
Export music21-derived voice-leading priors into the project's runtime JS table.

Usage:
  python scripts/music21/export_voice_leading_priors.py \
    --output src/composers/voice/voiceLeadingPriorsData.js \
    --limit 220

Requires:
  pip install music21
"""

from __future__ import annotations

import argparse
import pathlib
from collections import Counter
from typing import Dict, Iterable, List

from music21 import corpus, note
from export_utils import interpolate_nested, merge_numeric_maps, to_js_assignment


PHASES = ("opening", "development", "climax", "resolution")
DIRECTIONS = ("up", "down", "static")


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def phase_for_index(index: int, total_steps: int) -> str:
    if total_steps <= 0:
        return "development"
    ratio = index / float(total_steps)
    if ratio < 0.25:
        return "opening"
    if ratio < 0.65:
        return "development"
    if ratio < 0.85:
        return "climax"
    return "resolution"


def extract_quality_mode(k) -> str:
    mode = str(getattr(k, "mode", "major") or "major").lower()
    return "minor" if mode in {"minor", "aeolian", "dorian", "phrygian", "locrian"} else "major"


def iter_scores(limit: int, source: str = "chorales"):
    if source == "chorales":
        iterator = corpus.chorales.Iterator()
        yielded = 0
        for score in iterator:
            yield score
            yielded += 1
            if yielded >= limit:
                break
        return

    score_paths = list(corpus.getCorePaths())
    for p in score_paths[:limit]:
        try:
            yield corpus.parse(p)
        except Exception:
            continue


def collect_part_midis(part, max_notes_per_part: int) -> List[int]:
    out: List[int] = []
    events: Iterable[note.Note] = part.recurse().notes
    for ev in events:
        if isinstance(ev, note.Note):
            midi = ev.pitch.midi
            if midi is None:
                continue
            out.append(int(round(float(midi))))
            if len(out) >= max_notes_per_part:
                break
    return out


def seed_fallback_counters() -> Dict[str, Dict]:
    fallback = {}
    for quality in ("major", "minor"):
        intervals = {phase: Counter() for phase in PHASES}
        directions = {phase: Counter() for phase in PHASES}
        tendencies = Counter()
        for phase in PHASES:
            intervals[phase][0] += 12
            intervals[phase][1] += 10
            intervals[phase][2] += 12
            intervals[phase][3] += 8
            intervals[phase][4] += 6
            intervals[phase][5] += 5
            intervals[phase][7] += 4
            intervals[phase][12] += 3
            directions[phase]["up"] += 9
            directions[phase]["down"] += 9
            directions[phase]["static"] += 7

        if quality == "major":
            tendencies[(11, 0)] += 24
            tendencies[(6, 5)] += 14
            tendencies[(4, 3)] += 10
            tendencies[(2, 1)] += 8
        else:
            tendencies[(10, 9)] += 22
            tendencies[(11, 0)] += 18
            tendencies[(8, 7)] += 11
            tendencies[(6, 5)] += 10

        fallback[quality] = {
            "phase_interval": intervals,
            "phase_direction": directions,
            "tendency": tendencies,
        }
    return fallback


def build_phase_interval_weights(phase_interval_counter: Dict[str, Counter]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for phase in PHASES:
        c = phase_interval_counter[phase]
        total = sum(c.values())
        expected = total / 13.0 if total > 0 else 1.0
        phase_map = {}
        for interval in range(13):
            count = c.get(interval, 0)
            weight = clamp((count + 1.0) / (expected + 1.0), 0.45, 1.95)
            phase_map[str(interval)] = round(weight, 3)
        out[phase] = phase_map
    return out


def build_phase_direction_weights(phase_direction_counter: Dict[str, Counter]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for phase in PHASES:
        c = phase_direction_counter[phase]
        total = sum(c.values())
        expected = total / 3.0 if total > 0 else 1.0
        phase_map = {}
        for direction in DIRECTIONS:
            count = c.get(direction, 0)
            weight = clamp((count + 1.0) / (expected + 1.0), 0.55, 1.75)
            phase_map[direction] = round(weight, 3)
        out[phase] = phase_map
    return out


def build_tendency_weights(tendency_counter: Counter, top_n: int = 28) -> Dict[str, float]:
    total = sum(tendency_counter.values())
    expected = total / 144.0 if total > 0 else 1.0
    out: Dict[str, float] = {}
    for (from_degree, to_degree), count in tendency_counter.most_common(top_n):
        key = f"{from_degree}->{to_degree}"
        weight = clamp((count + 1.0) / (expected + 1.0), 0.65, 2.4)
        out[key] = round(weight, 3)
    return out


def to_js_assignment_for_voice_leading(data: Dict) -> str:
    return to_js_assignment("VOICE_LEADING_PRIOR_TABLES", data, "scripts/music21/export_voice_leading_priors.py")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export music21 voice-leading priors to JS")
    parser.add_argument("--output", default="src/composers/voice/voiceLeadingPriorsData.js", help="Output JS file path")
    parser.add_argument("--limit", type=int, default=180, help="Max scores to scan")
    parser.add_argument("--source", choices=["chorales", "core"], default="chorales", help="Corpus source")
    parser.add_argument("--max-notes-per-part", type=int, default=420, help="Max melodic notes to consume per part")
    parser.add_argument("--part-limit", type=int, default=8, help="Max parts to scan per score")
    parser.add_argument("--top-tendencies", type=int, default=28, help="Max tendency transitions per quality")
    parser.add_argument("--verbose-every", type=int, default=25, help="Progress print cadence")
    args = parser.parse_args()

    print(
        f"[music21-vl-export] source={args.source} limit={args.limit} "
        f"part_limit={args.part_limit} max_notes={args.max_notes_per_part} top={args.top_tendencies}",
        flush=True,
    )

    counters = {
        "major": {
            "phase_interval": {phase: Counter() for phase in PHASES},
            "phase_direction": {phase: Counter() for phase in PHASES},
            "tendency": Counter(),
        },
        "minor": {
            "phase_interval": {phase: Counter() for phase in PHASES},
            "phase_direction": {phase: Counter() for phase in PHASES},
            "tendency": Counter(),
        },
    }

    processed = 0
    accepted = 0

    for score in iter_scores(args.limit, source=args.source):
        processed += 1
        try:
            analyzed_key = score.analyze("key")
            quality = extract_quality_mode(analyzed_key)
            tonic_pitch = analyzed_key.tonic.pitchClass
            if tonic_pitch is None:
                continue
            tonic_pc = int(tonic_pitch) % 12

            part_stream = list(score.parts) if hasattr(score, "parts") else [score]
            if args.part_limit > 0:
                part_stream = part_stream[:args.part_limit]

            score_had_transitions = False
            for part in part_stream:
                midis = collect_part_midis(part, max_notes_per_part=args.max_notes_per_part)
                if len(midis) < 2:
                    continue

                total_steps = len(midis) - 1
                for i in range(total_steps):
                    from_m = int(midis[i])
                    to_m = int(midis[i + 1])
                    diff = to_m - from_m
                    interval = min(12, abs(diff))
                    direction = "up" if diff > 0 else ("down" if diff < 0 else "static")
                    phase = phase_for_index(i, total_steps)

                    counters[quality]["phase_interval"][phase][interval] += 1
                    counters[quality]["phase_direction"][phase][direction] += 1

                    from_degree = (from_m % 12 - tonic_pc + 12) % 12
                    to_degree = (to_m % 12 - tonic_pc + 12) % 12
                    counters[quality]["tendency"][(from_degree, to_degree)] += 1
                    score_had_transitions = True

            if score_had_transitions:
                accepted += 1

            if args.verbose_every > 0 and processed % args.verbose_every == 0:
                print(f"[music21-vl-export] processed={processed} accepted={accepted}", flush=True)
        except Exception:
            continue

    fallback = seed_fallback_counters()
    for quality in ("major", "minor"):
        has_data = any(sum(c.values()) > 0 for c in counters[quality]["phase_interval"].values())
        if not has_data:
            counters[quality] = fallback[quality]
            print(f"[music21-vl-export] {quality} counters empty; seeded fallback profile", flush=True)

    data = {
        "version": 2,
        "source": "music21-derived offline voice-leading priors (v2: mode-specific dorian/mixolydian)",
        "generatedAt": "auto",
        "major": {
            "phaseIntervalWeights": build_phase_interval_weights(counters["major"]["phase_interval"]),
            "phaseDirectionWeights": build_phase_direction_weights(counters["major"]["phase_direction"]),
            "tendencyWeights": build_tendency_weights(counters["major"]["tendency"], top_n=args.top_tendencies),
        },
        "minor": {
            "phaseIntervalWeights": build_phase_interval_weights(counters["minor"]["phase_interval"]),
            "phaseDirectionWeights": build_phase_direction_weights(counters["minor"]["phase_direction"]),
            "tendencyWeights": build_tendency_weights(counters["minor"]["tendency"], top_n=args.top_tendencies),
        },
    }

    # interpolate/merge to produce dorian & mixolydian tables (60/40 mixes)
    data["dorian"] = {
        "phaseIntervalWeights": interpolate_nested(data["minor"]["phaseIntervalWeights"], data["major"]["phaseIntervalWeights"], 0.4),
        "phaseDirectionWeights": interpolate_nested(data["minor"]["phaseDirectionWeights"], data["major"]["phaseDirectionWeights"], 0.4),
        "tendencyWeights": merge_numeric_maps(data["minor"]["tendencyWeights"], data["major"]["tendencyWeights"], 0.4),
    }
    data["mixolydian"] = {
        "phaseIntervalWeights": interpolate_nested(data["major"]["phaseIntervalWeights"], data["minor"]["phaseIntervalWeights"], 0.4),
        "phaseDirectionWeights": interpolate_nested(data["major"]["phaseDirectionWeights"], data["minor"]["phaseDirectionWeights"], 0.4),
        "tendencyWeights": merge_numeric_maps(data["major"]["tendencyWeights"], data["minor"]["tendencyWeights"], 0.4),
    }

    out_path = pathlib.Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(to_js_assignment_for_voice_leading(data), encoding="utf-8")
    print(f"[music21-vl-export] wrote voice-leading priors to {out_path}", flush=True)


if __name__ == "__main__":
    main()
