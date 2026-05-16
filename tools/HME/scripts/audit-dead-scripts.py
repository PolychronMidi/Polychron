#!/usr/bin/env python3
"""Audit HME scripts for unclassified dead entrypoints."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
SCRIPTS = ROOT / "tools" / "HME" / "scripts"

MANUAL_ENTRYPOINTS = {
    "blank-debug-ls": "operator view for tmp/blank-debug dumps",
    "bulk-fix-unnamed-except.py": "manual codemod paired with check-unnamed-except",
    "controlled-incoherence.py": "manual perturbation drill",
    "exploration-rate-tuner.py": "manual telemetry summarizer",
    "finetune-arbiter.py": "training scaffold; not safe as automatic job",
    "formatter-ab.py": "experimental formatter harness",
    "llamacpp_monitor.py": "operator live health probe",
    "predictive-hooks.py": "offline hook-signal analysis",
    "routing_ready.py": "manual post-restart routing readiness probe; /home/jah/Polychron/i/hme action=routing_ready uses the shared server formatter",
    "satisfaction_analyzer.py": "operator report over satisfaction_capture output",
    "self-improvement-scout.py": "offline proposal generator",
    "track-refactor-amplification.py": "offline git-history analysis",
}

IGNORED_SUFFIXES = {".html", ".json"}


def _tracked() -> list[str]:
    out = subprocess.check_output(
        ["git", "ls-files", "tools/HME/scripts"], cwd=ROOT, text=True
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def _detector_modules() -> set[str]:
    reg = SCRIPTS / "detectors" / "registry.json"
    data = json.loads(reg.read_text())
    return {f"tools/HME/scripts/detectors/{d['module']}.py" for d in data["detectors"]}


def _patterns(rel: str) -> list[str]:
    base = os.path.basename(rel)
    stem = os.path.splitext(base)[0]
    pats = [rel, base]
    if re.match(r"^[A-Za-z_]\w*$", stem):
        pats.extend([f"import {stem}", f"from {stem}", f".{stem} import"])
    return list(dict.fromkeys(pats))


def _has_external_ref(rel: str) -> bool:
    for pat in _patterns(rel):
        try:
            out = subprocess.check_output(
                ["git", "grep", "-n", "-F", pat, "--", "."],
                cwd=ROOT, text=True, stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            continue
        for line in out.splitlines():
            if line.split(":", 1)[0] != rel:
                return True
    return False


def main() -> int:
    detector_modules = _detector_modules()
    findings: list[str] = []
    for rel in _tracked():
        path = ROOT / rel
        if "/fixtures/" in rel or path.suffix in IGNORED_SUFFIXES:
            continue
        if rel in detector_modules:
            continue
        if _has_external_ref(rel):
            continue
        base = path.name
        if base in MANUAL_ENTRYPOINTS:
            continue
        findings.append(rel)
    if findings:
        print("Unclassified unreferenced HME scripts:")
        for rel in findings:
            print(f"  {rel}")
        print("Add a real caller, delete it, or classify it in MANUAL_ENTRYPOINTS with a reason.")
        return 1
    print(f"audit-dead-scripts: clean ({len(MANUAL_ENTRYPOINTS)} manual entrypoint(s) classified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
