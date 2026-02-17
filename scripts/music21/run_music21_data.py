#!/usr/bin/env python3
"""Run all music21 data exporters and then verify generated outputs."""

from __future__ import annotations

import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]

STEPS = [
    "scripts/music21/export_harmonic_priors.py",
    "scripts/music21/export_melodic_priors.py",
    "scripts/music21/export_rhythm_priors.py",
    "scripts/music21/export_voice_leading_priors.py",
    "scripts/music21/verify_priors_outputs.py",
]


def run_step(script_rel_path: str) -> None:
    cmd = [sys.executable, script_rel_path]
    pretty_cmd = subprocess.list2cmdline(cmd)
    print(f"[music21-data] running: {pretty_cmd}", flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    print("[music21-data] starting full export + verify pipeline", flush=True)
    for script_path in STEPS:
        run_step(script_path)
    print("[music21-data] complete", flush=True)


if __name__ == "__main__":
    main()
