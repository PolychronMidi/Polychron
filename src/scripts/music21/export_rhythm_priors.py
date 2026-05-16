#!/usr/bin/env python3
"""
Export music21-derived rhythm priors into the project's runtime JS table.

Usage:
  python scripts/music21/export_rhythm_priors.py \
    --output src/rhythm/rhythmPriorsData.js \
    --limit 220

Requires:
  pip install music21
"""

from __future__ import annotations

import argparse
import pathlib
from collections import defaultdict
from typing import Dict, Iterable, List

from music21 import corpus, note
from export_utils import interpolate_nested, to_js_assignment


PHASES = ("opening", "development", "climax", "resolution")
METHOD_COMPLEXITY = {
    "binary": 0.18,
    "hex": 0.28,
    "random": 0.34,
    "prob": 0.42,
    "rotate": 0.52,
    "morph": 0.66,
    "onsets": 0.78,
    "euclid": 0.88,
}
LEVELS = ("beat", "div", "subdiv", "subsubdiv")


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


def collect_part_notes(part, max_notes_per_part: int):
    out: List[note.Note] = []
    events: Iterable[note.Note] = part.recurse().notes
    for ev in events:
        if isinstance(ev, note.Note):
            out.append(ev)
            if len(out) >= max_notes_per_part:
                break
    return out


def fractional_subdivision(value: float) -> int:
    frac = abs(value - int(value))
    if frac < 1e-4:
        return 1
    candidates = [2, 3, 4, 6, 8, 12]
    best = 2
    best_err = 999.0
    for c in candidates:
        err = abs(round(frac * c) - (frac * c))
        if err < best_err:
            best = c
            best_err = err
    return best


def build_method_weights(target_complexity: float) -> Dict[str, float]:
    out = {}
    for method, method_complexity in METHOD_COMPLEXITY.items():
        distance = abs(method_complexity - target_complexity)
        weight = clamp(1.95 - distance * 2.2, 0.55, 1.95)
        out[method] = round(weight, 3)
    return out


def build_level_phase_multipliers(phase_complexity: Dict[str, float]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {level: {} for level in LEVELS}
    for phase in PHASES:
        score = phase_complexity.get(phase, 0.5)
        out["beat"][phase] = round(clamp(1.35 - score * 0.7, 0.65, 1.45), 3)
        out["div"][phase] = round(clamp(0.92 + score * 0.24, 0.75, 1.25), 3)
        out["subdiv"][phase] = round(clamp(0.72 + score * 0.86, 0.55, 1.55), 3)
        out["subsubdiv"][phase] = round(clamp(0.68 + score * 0.82, 0.5, 1.5), 3)
    return out


def build_profile(metrics_by_phase: Dict[str, Dict[str, float]], cadence_complexity: float) -> Dict:
    phase_complexity = {}
    phase_method_weights = {}

    for phase in PHASES:
        phase_metrics = metrics_by_phase.get(phase, {})
        density = phase_metrics.get("density", 0.35)
        syncopation = phase_metrics.get("syncopation", 0.25)
        subdivision_variety = phase_metrics.get("subdivision_variety", 0.25)
        complexity = clamp(0.45 * density + 0.35 * syncopation + 0.20 * subdivision_variety, 0.05, 0.95)
        phase_complexity[phase] = complexity
        phase_method_weights[phase] = build_method_weights(complexity)

    cadential_method_weights = build_method_weights(clamp(cadence_complexity, 0.05, 0.95))

    return {
        "phaseMethodWeights": phase_method_weights,
        "levelPhaseMultipliers": build_level_phase_multipliers(phase_complexity),
        "cadentialMethodWeights": cadential_method_weights,
    }


def seed_fallback_profiles() -> Dict[str, Dict]:
    major_complexity = {
        "opening": 0.24,
        "development": 0.54,
        "climax": 0.76,
        "resolution": 0.21,
    }
    minor_complexity = {
        "opening": 0.28,
        "development": 0.57,
        "climax": 0.81,
        "resolution": 0.24,
    }

    major_metrics = {
        phase: {
            "density": complexity,
            "syncopation": complexity * 0.85,
            "subdivision_variety": complexity * 0.7,
        }
        for phase, complexity in major_complexity.items()
    }
    minor_metrics = {
        phase: {
            "density": complexity,
            "syncopation": complexity * 0.88,
            "subdivision_variety": complexity * 0.74,
        }
        for phase, complexity in minor_complexity.items()
    }

    return {
        "major": build_profile(major_metrics, cadence_complexity=0.22),
        "minor": build_profile(minor_metrics, cadence_complexity=0.25),
    }


def to_js_assignment_for_rhythm(data: Dict) -> str:
    return to_js_assignment("RHYTHM_PRIOR_TABLES", data, "scripts/music21/export_rhythm_priors.py")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export music21 rhythm priors to JS")
    parser.add_argument("--output", default="src/rhythm/rhythmPriorsData.js", help="Output JS file path")
    parser.add_argument("--limit", type=int, default=180, help="Max scores to scan")
    parser.add_argument("--source", choices=["chorales", "core"], default="chorales", help="Corpus source")
    parser.add_argument("--max-notes-per-part", type=int, default=500, help="Max note events to consume per part")
    parser.add_argument("--part-limit", type=int, default=8, help="Max parts to scan per score")
    parser.add_argument("--verbose-every", type=int, default=25, help="Progress print cadence")
    args = parser.parse_args()

    metrics = {
        "major": {
            phase: {"notes": 0.0, "measureSpan": 0.0, "syncopated": 0.0, "subdivisions": defaultdict(float)}
            for phase in PHASES
        },
        "minor": {
            phase: {"notes": 0.0, "measureSpan": 0.0, "syncopated": 0.0, "subdivisions": defaultdict(float)}
            for phase in PHASES
        },
    }
    cadence_acc = {"major": {"sum": 0.0, "count": 0}, "minor": {"sum": 0.0, "count": 0}}

    processed = 0
    accepted = 0

    for score in iter_scores(args.limit, source=args.source):
        processed += 1
        try:
            analyzed_key = score.analyze("key")
            quality = extract_quality_mode(analyzed_key)

            part_stream = list(score.parts) if hasattr(score, "parts") else [score]
            if args.part_limit > 0:
                part_stream = part_stream[: args.part_limit]

            score_had_data = False
            for part in part_stream:
                notes = collect_part_notes(part, max_notes_per_part=args.max_notes_per_part)
                if len(notes) < 2:
                    continue

                total_steps = len(notes) - 1
                for i in range(total_steps):
                    current = notes[i]
                    nxt = notes[i + 1]
                    phase = phase_for_index(i, total_steps)

                    off = float(getattr(nxt, "offset", 0.0) or 0.0)
                    ql = float(getattr(current, "quarterLength", 0.0) or 0.0)
                    if ql <= 0:
                        continue

                    phase_metrics = metrics[quality][phase]
                    phase_metrics["notes"] += 1.0
                    phase_metrics["measureSpan"] += ql

                    is_syncopated = abs(off - round(off)) > 1e-4
                    if is_syncopated:
                        phase_metrics["syncopated"] += 1.0

                    subdiv = fractional_subdivision(off)
                    phase_metrics["subdivisions"][subdiv] += 1.0

                    # Cadence proxy: final phrase zone
                    if i >= int(total_steps * 0.82):
                        local_density = clamp(ql / 1.5, 0.0, 1.0)
                        local_sync = 1.0 if is_syncopated else 0.0
                        local_subdiv = clamp(subdiv / 12.0, 0.0, 1.0)
                        local_complexity = clamp(0.5 * local_density + 0.3 * local_sync + 0.2 * local_subdiv, 0.0, 1.0)
                        cadence_acc[quality]["sum"] += local_complexity
                        cadence_acc[quality]["count"] += 1

                    score_had_data = True

            if score_had_data:
                accepted += 1

            if args.verbose_every > 0 and processed % args.verbose_every == 0:
                print(f"[music21-rhythm-export] processed={processed} accepted={accepted}", flush=True)
        except Exception:
            continue

    fallback = seed_fallback_profiles()
    out_profiles = {}

    for quality in ("major", "minor"):
        has_any = any(metrics[quality][phase]["notes"] > 0 for phase in PHASES)
        if not has_any:
            out_profiles[quality] = fallback[quality]
            print(f"[music21-rhythm-export] {quality} counters empty; seeded fallback profile", flush=True)
            continue

        phase_data = {}
        for phase in PHASES:
            phase_metrics = metrics[quality][phase]
            notes_n = phase_metrics["notes"]
            span = phase_metrics["measureSpan"]
            sync = phase_metrics["syncopated"]
            subdivision_counts = phase_metrics["subdivisions"]

            density = clamp((notes_n / max(1.0, span)) / 3.0, 0.0, 1.0)
            syncopation = clamp(sync / max(1.0, notes_n), 0.0, 1.0)
            unique_subdivisions = len([k for k, v in subdivision_counts.items() if v > 0])
            subdivision_variety = clamp(unique_subdivisions / 6.0, 0.0, 1.0)

            phase_data[phase] = {
                "density": density,
                "syncopation": syncopation,
                "subdivision_variety": subdivision_variety,
            }

        cadence_count = cadence_acc[quality]["count"]
        cadence_complexity = (cadence_acc[quality]["sum"] / cadence_count) if cadence_count > 0 else 0.24

        out_profiles[quality] = build_profile(phase_data, cadence_complexity=cadence_complexity)

    data = {
        "version": 2,
        "source": "music21-derived offline rhythm priors",
        "generatedAt": "auto",
        "major": out_profiles["major"],
        "minor": out_profiles["minor"],
    }

    # derive dorian / mixolydian profiles by interpolating numeric leaves (60/40 mixes)
    data["dorian"] = interpolate_nested(out_profiles["minor"], out_profiles["major"], 0.4)
    data["mixolydian"] = interpolate_nested(out_profiles["major"], out_profiles["minor"], 0.4)

    out_path = pathlib.Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(to_js_assignment_for_rhythm(data), encoding="utf-8")
    print(f"[music21-rhythm-export] wrote rhythm priors to {out_path}", flush=True)


if __name__ == "__main__":
    main()
