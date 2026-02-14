#!/usr/bin/env python3
"""
Export music21-derived harmonic progression priors into the project's runtime JS table.

Usage:
  python scripts/music21/export_harmonic_priors.py \
    --output src/composers/chord/harmonicPriorsData.js \
    --limit 220

Requires:
  pip install music21
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
from collections import Counter
from typing import Dict, List, Optional

from music21 import chord, corpus, roman


PHASES = ("opening", "development", "climax", "resolution")


FALLBACK_WINDOWS = {
    "major": [
        ["I", "IV", "V", "I"],
        ["I", "V", "vi", "IV"],
        ["ii", "V", "I", "vi"],
        ["I", "vi", "IV", "V"],
    ],
    "minor": [
        ["i", "iv", "V", "i"],
        ["i", "VII", "VI", "V"],
        ["i", "VI", "III", "VII"],
        ["ii", "V", "i", "iv"],
    ],
}


def normalize_roman(figure: str) -> Optional[str]:
    if not isinstance(figure, str) or not figure:
        return None
    m = re.match(r"([b#]?[ivIV]+)", figure)
    if not m:
        return None
    base = m.group(1)
    suffix = "7" if "7" in figure else ""
    return f"{base}{suffix}"


def classify_cadence(romans: List[str]) -> str:
    if len(romans) < 2:
        return "none"
    last = romans[-1]
    prev = romans[-2]

    if re.match(r"^[IViv]+", last):
        if re.match(r"^[Vv]+", prev):
            return "authentic"
        if re.match(r"^[IViv]+", prev):
            return "plagal"
    if re.match(r"^[Vv]+", last):
        return "half"
    if re.match(r"^[Vv]+", prev) and re.match(r"^[VvIi]+", last):
        return "deceptive"
    return "none"


def phase_weights_for_pattern(cadence: str, cadential: bool) -> Dict[str, float]:
    base = {
        "opening": 1.0,
        "development": 1.0,
        "climax": 1.0,
        "resolution": 1.0,
    }
    if cadence == "authentic":
        base["resolution"] *= 1.35
        base["climax"] *= 1.2
        base["opening"] *= 0.85
    elif cadence == "plagal":
        base["resolution"] *= 1.2
        base["opening"] *= 1.15
        base["climax"] *= 0.8
    elif cadence == "deceptive":
        base["climax"] *= 1.3
        base["development"] *= 1.15
        base["resolution"] *= 0.75
    elif cadence == "half":
        base["development"] *= 1.15
        base["climax"] *= 1.15
        base["resolution"] *= 0.8

    if cadential:
        base["resolution"] *= 1.05

    return {k: round(v, 3) for k, v in base.items()}


def compact_name(romans: List[str], index: int) -> str:
    raw = "_".join(romans)
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "", raw)
    if not cleaned:
        return f"pattern_{index}"
    return f"p_{cleaned}_{index}"


def extract_quality_mode(k) -> str:
    mode = str(getattr(k, "mode", "major") or "major").lower()
    return "minor" if mode in {"minor", "aeolian", "dorian", "phrygian", "locrian"} else "major"


def iter_scores(limit: int, source: str = "chorales"):
    if source == "chorales":
        try:
            chorale_iter = corpus.chorales.Iterator()
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize chorales iterator: {exc}") from exc

        yielded = 0
        for score in chorale_iter:
            yield score
            yielded += 1
            if yielded >= limit:
                break
        return

    score_paths = list(corpus.getCorePaths())
    if not score_paths:
        raise RuntimeError("music21 corpus has no available core paths")
    for p in score_paths[:limit]:
        try:
            yield corpus.parse(p)
        except Exception:
            continue


def _bounded_score_excerpt(score, max_measures: int):
    if not isinstance(max_measures, int) or max_measures <= 0:
        return score
    try:
        excerpt = score.measures(1, max_measures)
        if excerpt is not None:
            return excerpt
    except Exception:
        pass
    return score


def _collect_roman_stream(score, analyzed_key, window_size: int, max_chords_per_score: int, use_chordify: bool, max_measures: int) -> List[str]:
    romans: List[str] = []

    try:
        existing_chords = score.recurse().getElementsByClass(chord.Chord)
        for ch in existing_chords:
            if len(ch.pitches) < 3:
                continue
            rn = roman.romanNumeralFromChord(ch, analyzed_key)
            normalized = normalize_roman(rn.figure)
            if normalized:
                romans.append(normalized)
            if len(romans) >= max_chords_per_score:
                return romans
    except Exception:
        pass

    if len(romans) >= window_size:
        return romans
    if not use_chordify:
        return romans

    scoped = _bounded_score_excerpt(score, max_measures=max_measures)
    chordified = scoped.chordify()
    chord_events = chordified.recurse().getElementsByClass(chord.Chord)
    for ch in chord_events:
        if len(ch.pitches) < 3:
            continue
        rn = roman.romanNumeralFromChord(ch, analyzed_key)
        normalized = normalize_roman(rn.figure)
        if normalized:
            romans.append(normalized)
        if len(romans) >= max_chords_per_score:
            break

    return romans


def extract_windows(
    limit: int,
    window_size: int = 4,
    source: str = "chorales",
    use_chordify: bool = True,
    max_measures: int = 48,
    max_chords_per_score: int = 400,
    verbose_every: int = 25,
) -> Dict[str, Counter]:
    counters = {
        "major": Counter(),
        "minor": Counter(),
    }

    processed = 0
    accepted = 0
    for score in iter_scores(limit, source=source):
        processed += 1
        try:
            analyzed_key = score.analyze("key")
            quality = extract_quality_mode(analyzed_key)
            romans = _collect_roman_stream(
                score=score,
                analyzed_key=analyzed_key,
                window_size=window_size,
                max_chords_per_score=max_chords_per_score,
                use_chordify=use_chordify,
                max_measures=max_measures,
            )
            if len(romans) < window_size:
                if verbose_every > 0 and processed % verbose_every == 0:
                    print(f"[music21-export] processed={processed} accepted={accepted} quality={quality} (insufficient romans)", flush=True)
                continue
            for i in range(0, len(romans) - window_size + 1):
                window = tuple(romans[i:i + window_size])
                counters[quality][window] += 1
            accepted += 1
            if verbose_every > 0 and processed % verbose_every == 0:
                print(f"[music21-export] processed={processed} accepted={accepted} quality={quality}", flush=True)
        except Exception:
            continue

    return counters


def seed_fallback_counter(quality: str) -> Counter:
    patterns = FALLBACK_WINDOWS.get(quality)
    if not patterns:
        raise RuntimeError(f"No fallback windows configured for quality={quality}")
    c = Counter()
    for idx, window in enumerate(patterns, start=1):
        c[tuple(window)] += len(patterns) - idx + 1
    return c


def build_profile(counter: Counter, top_n: int = 10) -> Dict:
    if not counter:
        raise RuntimeError("No progression windows extracted; check corpus availability/limit")

    top = counter.most_common(top_n)
    total = sum(count for _, count in top)
    patterns = {}
    phase_weights = {phase: {} for phase in PHASES}

    for idx, (window, count) in enumerate(top, start=1):
        romans = list(window)
        cadence = classify_cadence(romans)
        cadential = cadence != "none"
        name = compact_name(romans, idx)
        base_weight = max(0.2, round((count / total) * top_n, 3))

        patterns[name] = {
            "romans": romans,
            "baseWeight": base_weight,
            "cadence": cadence,
            "cadential": cadential,
        }

        per_phase = phase_weights_for_pattern(cadence, cadential)
        for phase in PHASES:
            phase_weights[phase][name] = per_phase[phase]

    return {
        "patterns": patterns,
        "phaseWeights": phase_weights,
    }


def to_js_assignment(data: Dict) -> str:
    pretty = json.dumps(data, indent=2)
    return f"HARMONIC_PRIOR_TABLES = {pretty};\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Export music21 progression priors to JS")
    parser.add_argument("--output", default="src/composers/chord/harmonicPriorsData.js", help="Output JS file path")
    parser.add_argument("--limit", type=int, default=180, help="Max scores to scan")
    parser.add_argument("--top", type=int, default=10, help="Patterns per quality")
    parser.add_argument("--window-size", type=int, default=4, help="Roman progression window size")
    parser.add_argument("--source", choices=["chorales", "core"], default="chorales", help="Corpus source: chorales is safer/faster")
    parser.add_argument("--skip-chordify", action="store_true", help="Skip chordify fallback and use only existing chord events")
    parser.add_argument("--max-measures", type=int, default=48, help="Max measures to chordify per score (<=0 disables slicing)")
    parser.add_argument("--max-chords-per-score", type=int, default=320, help="Hard cap romanized chords per score")
    parser.add_argument("--verbose-every", type=int, default=25, help="Print progress every N processed scores (0 disables)")
    args = parser.parse_args()

    print(
        f"[music21-export] source={args.source} limit={args.limit} window={args.window_size} "
        f"skip_chordify={args.skip_chordify} max_measures={args.max_measures} max_chords={args.max_chords_per_score}",
        flush=True,
    )

    counters = extract_windows(
        limit=args.limit,
        window_size=args.window_size,
        source=args.source,
        use_chordify=not args.skip_chordify,
        max_measures=args.max_measures,
        max_chords_per_score=args.max_chords_per_score,
        verbose_every=args.verbose_every,
    )

    if not counters["major"]:
        print("[music21-export] major corpus windows empty, seeding fallback windows", flush=True)
        counters["major"] = seed_fallback_counter("major")
    if not counters["minor"]:
        print("[music21-export] minor corpus windows empty, seeding fallback windows", flush=True)
        counters["minor"] = seed_fallback_counter("minor")

    data = {
        "version": 1,
        "source": "music21-derived offline harmonic priors",
        "generatedAt": "auto",
        "major": build_profile(counters["major"], top_n=args.top),
        "minor": build_profile(counters["minor"], top_n=args.top),
    }

    out_path = pathlib.Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(to_js_assignment(data), encoding="utf-8")

    print(f"[music21-export] wrote harmonic priors to {out_path}", flush=True)


if __name__ == "__main__":
    main()
