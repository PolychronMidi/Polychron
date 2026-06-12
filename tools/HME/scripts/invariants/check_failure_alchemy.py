#!/usr/bin/env python3
"""Validate Phase Omega failure-alchemy workflow metadata."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/failure-alchemy.json"
EXPECTED_OUTCOMES = ["fix", "regression-test", "invariant", "dead-mechanism-deletion"]
EXPECTED_ORDER = [
    "diagnose-exact-failure",
    "smallest-patch",
    "syntax-check",
    "targeted-test",
    "test-invariant-or-deletion",
    "broad-suite",
    "compact-proof-trace",
]


def main() -> int:
    findings: list[str] = []
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("schema") != 1:
        findings.append("failure-alchemy schema must be 1")
    if cfg.get("allowed_outcomes") != EXPECTED_OUTCOMES:
        findings.append("allowed_outcomes must be exactly fix/regression-test/invariant/dead-mechanism-deletion")
    if cfg.get("repair_order") != EXPECTED_ORDER:
        findings.append("repair_order must encode diagnose -> smallest patch -> syntax -> targeted test -> guard/deletion -> broad suite -> trace")
    labels = cfg.get("forbidden_labels")
    if not isinstance(labels, list) or not {"preexisting", "probably", "noted", "later"}.issubset(set(labels)):
        findings.append("forbidden_labels must include preexisting/probably/noted/later")
    if cfg.get("broad_change_requires_green") is not True:
        findings.append("broad_change_requires_green must be true")
    for row in findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
