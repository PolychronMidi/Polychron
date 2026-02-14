#!/usr/bin/env python3
"""
Export music21-derived melodic priors into the project's runtime JS table.

Usage:
  python scripts/music21/export_melodic_priors.py \
    --output src/composers/voice/melodicPriorsData.js \
    --limit 220

Requires:
  pip install music21
"""

from __future__ import annotations

import argparse
import json
import pathlib
from collections import Counter
from typing import Dict, Iterable, List

from music21 import corpus, note


PHASES = ("opening", "development", "climax", "resolution")


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
        phase_degree = {phase: Counter() for phase in PHASES}
        tendency = Counter()

        for phase in PHASES:
            if quality == "major":
                phase_degree[phase][0] += 16
                phase_degree[phase][4] += 11
                phase_degree[phase][7] += 12
                phase_degree[phase][2] += 8
                phase_degree[phase][5] += 8
                phase_degree[phase][11] += 8
            else:
                phase_degree[phase][0] += 15
                phase_degree[phase][3] += 12
                phase_degree[phase][7] += 12
                phase_degree[phase][8] += 9
                phase_degree[phase][10] += 9
                phase_degree[phase][11] += 8

        if quality == "major":
            tendency[(11, 0)] += 26
            tendency[(2, 1)] += 14
            tendency[(5, 4)] += 12
            tendency[(7, 0)] += 10
            tendency[(6, 5)] += 9
        else:
            tendency[(10, 9)] += 24
            tendency[(11, 0)] += 18
            tendency[(8, 7)] += 15
            tendency[(6, 5)] += 10
            tendency[(2, 1)] += 9

        fallback[quality] = {
            "phase_degree": phase_degree,
            "tendency": tendency,
        }

    return fallback


def build_phase_degree_weights(phase_degree_counter: Dict[str, Counter]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for phase in PHASES:
        c = phase_degree_counter[phase]
        total = sum(c.values())
        expected = total / 12.0 if total > 0 else 1.0
        phase_map = {}
        for degree in range(12):
            count = c.get(degree, 0)
            weight = clamp((count + 1.0) / (expected + 1.0), 0.55, 1.95)
            phase_map[str(degree)] = round(weight, 3)
        out[phase] = phase_map
    return out


def build_tendency_weights(tendency_counter: Counter, top_n: int = 24) -> Dict[str, float]:
    total = sum(tendency_counter.values())
    expected = total / 144.0 if total > 0 else 1.0
    out: Dict[str, float] = {}
    for (from_degree, to_degree), count in tendency_counter.most_common(top_n):
        key = f"{from_degree}->{to_degree}"
        weight = clamp((count + 1.0) / (expected + 1.0), 0.7, 2.5)
        out[key] = round(weight, 3)
    return out


def to_js_assignment(data: Dict) -> str:
    pretty = json.dumps(data, indent=2)
    return f"MELODIC_PRIOR_TABLES = {pretty};\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Export music21 melodic priors to JS")
    parser.add_argument("--output", default="src/composers/voice/melodicPriorsData.js", help="Output JS file path")
    parser.add_argument("--limit", type=int, default=180, help="Max scores to scan")
    parser.add_argument("--source", choices=["chorales", "core"], default="chorales", help="Corpus source")
    parser.add_argument("--max-notes-per-part", type=int, default=420, help="Max melodic notes to consume per part")
    parser.add_argument("--part-limit", type=int, default=8, help="Max parts to scan per score")
    parser.add_argument("--top-tendencies", type=int, default=24, help="Max tendency transitions per quality")
    parser.add_argument("--verbose-every", type=int, default=25, help="Progress print cadence")
    args = parser.parse_args()

    counters = {
        "major": {
            "phase_degree": {phase: Counter() for phase in PHASES},
            "tendency": Counter(),
        },
        "minor": {
            "phase_degree": {phase: Counter() for phase in PHASES},
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

            score_had_degrees = False
            for part in part_stream:
                midis = collect_part_midis(part, max_notes_per_part=args.max_notes_per_part)
                if len(midis) == 0:
                    continue

                if len(midis) == 1:
                    only_degree = (int(midis[0]) % 12 - tonic_pc + 12) % 12
                    counters[quality]["phase_degree"]["development"][only_degree] += 1
                    score_had_degrees = True
                    continue

                total_steps = len(midis) - 1
                for i in range(total_steps):
                    from_m = int(midis[i])
                    to_m = int(midis[i + 1])
                    phase = phase_for_index(i, total_steps)

                    to_degree = (to_m % 12 - tonic_pc + 12) % 12
                    from_degree = (from_m % 12 - tonic_pc + 12) % 12

                    counters[quality]["phase_degree"][phase][to_degree] += 1
                    counters[quality]["tendency"][(from_degree, to_degree)] += 1
                    score_had_degrees = True

            if score_had_degrees:
                accepted += 1

            if args.verbose_every > 0 and processed % args.verbose_every == 0:
                print(f"[music21-melodic-export] processed={processed} accepted={accepted}", flush=True)
        except Exception:
            continue

    fallback = seed_fallback_counters()
    for quality in ("major", "minor"):
        has_data = any(sum(c.values()) > 0 for c in counters[quality]["phase_degree"].values())
        if not has_data:
            counters[quality] = fallback[quality]
            print(f"[music21-melodic-export] {quality} counters empty; seeded fallback profile", flush=True)

    data = {
        "version": 1,
        "source": "music21-derived offline melodic priors",
        "generatedAt": "auto",
        "major": {
            "phaseDegreeWeights": build_phase_degree_weights(counters["major"]["phase_degree"]),
            "tendencyWeights": build_tendency_weights(counters["major"]["tendency"], top_n=args.top_tendencies),
        },
        "minor": {
            "phaseDegreeWeights": build_phase_degree_weights(counters["minor"]["phase_degree"]),
            "tendencyWeights": build_tendency_weights(counters["minor"]["tendency"], top_n=args.top_tendencies),
        },
    }

    out_path = pathlib.Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(to_js_assignment(data), encoding="utf-8")
    print(f"[music21-melodic-export] wrote melodic priors to {out_path}", flush=True)


if __name__ == "__main__":
    main()
