#!/usr/bin/env python3
"""Verify generated music21 priors outputs are complete and structurally valid."""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Dict, List


REQUIRED_MODES = ("major", "minor", "dorian", "mixolydian")

OUTPUT_SPECS = [
    {
        "label": "melodic",
        "path": "src/composers/voice/melodicPriorsData.js",
        "variable": "MELODIC_PRIOR_TABLES",
        "generator": "scripts/music21/export_melodic_priors.py",
        "mode_fields": ("phaseDegreeWeights", "tendencyWeights"),
    },
    {
        "label": "voice-leading",
        "path": "src/composers/voice/voiceLeadingPriorsData.js",
        "variable": "VOICE_LEADING_PRIOR_TABLES",
        "generator": "scripts/music21/export_voice_leading_priors.py",
        "mode_fields": ("phaseIntervalWeights", "phaseDirectionWeights", "tendencyWeights"),
    },
    {
        "label": "rhythm",
        "path": "src/rhythm/rhythmPriorsData.js",
        "variable": "RHYTHM_PRIOR_TABLES",
        "generator": "scripts/music21/export_rhythm_priors.py",
        "mode_fields": ("phaseMethodWeights", "levelPhaseMultipliers", "cadentialMethodWeights"),
    },
    {
        "label": "harmonic",
        "path": "src/composers/chord/harmonicPriorsData.js",
        "variable": "HARMONIC_PRIOR_TABLES",
        "generator": "scripts/music21/export_harmonic_priors.py",
        "mode_fields": ("patterns", "phaseWeights"),
    },
]


def parse_generated_data(path: pathlib.Path, variable: str, generator: str) -> Dict:
    if not path.exists():
        raise RuntimeError(f"missing file: {path}")

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    expected_header = f"// GENERATED FILE - DO NOT EDIT. Run: {generator}"

    if not lines or lines[0].strip() != expected_header:
        raise RuntimeError(f"invalid header in {path}; expected '{expected_header}'")

    if "generateModeSpecific" in text or "//fart" in text:
        raise RuntimeError(f"stale runtime patch artifact found in {path}")

    assignment = "\n".join(lines[1:]).strip()
    prefix = f"{variable} = "
    if not assignment.startswith(prefix):
        raise RuntimeError(f"invalid assignment prefix in {path}; expected '{variable} = ...' on line 2")
    if not assignment.endswith(";"):
        raise RuntimeError(f"missing trailing semicolon in {path}")

    payload = assignment[len(prefix):-1]
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON parse failed in {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"top-level data is not an object in {path}")
    return data


def verify_spec(spec: Dict) -> List[str]:
    errors: List[str] = []
    path = pathlib.Path(spec["path"])

    try:
        data = parse_generated_data(path, spec["variable"], spec["generator"])
    except RuntimeError as exc:
        return [str(exc)]

    if data.get("version") != 2:
        errors.append(f"{path}: expected version=2, got {data.get('version')}")

    if not isinstance(data.get("source"), str) or "music21-derived offline" not in data.get("source", ""):
        errors.append(f"{path}: source field missing/invalid")

    if "generatedAt" not in data:
        errors.append(f"{path}: generatedAt field missing")

    mode_fields = spec["mode_fields"]
    for mode in REQUIRED_MODES:
        mode_value = data.get(mode)
        if not isinstance(mode_value, dict):
            errors.append(f"{path}: mode '{mode}' missing or not an object")
            continue
        for field in mode_fields:
            if field not in mode_value:
                errors.append(f"{path}: mode '{mode}' missing field '{field}'")
            elif not isinstance(mode_value[field], dict):
                errors.append(f"{path}: mode '{mode}' field '{field}' is not an object")
            elif len(mode_value[field]) == 0:
                errors.append(f"{path}: mode '{mode}' field '{field}' is empty")

    return errors


def main() -> None:
    all_errors: List[str] = []

    print("[music21-verify] verifying generated priors outputs...", flush=True)
    for spec in OUTPUT_SPECS:
        errors = verify_spec(spec)
        if errors:
            all_errors.extend(errors)
            print(f"[music21-verify] FAIL: {spec['label']}", flush=True)
        else:
            print(f"[music21-verify] PASS: {spec['label']}", flush=True)

    if all_errors:
        print("[music21-verify] validation failed:", flush=True)
        for err in all_errors:
            print(f"  - {err}", flush=True)
        sys.exit(1)

    print("[music21-verify] all priors outputs verified", flush=True)


if __name__ == "__main__":
    main()
