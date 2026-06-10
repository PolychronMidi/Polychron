#!/usr/bin/env python3
"""Validate artifact lifecycle lattice and tracked runtime policy."""
from __future__ import annotations

import fnmatch
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/artifact-lifecycle.json"
REQUIRED_CLASSES = {"source", "generated", "runtime", "metric", "proof", "transcript", "ephemeral", "fixture", "migration-baseline", "retired"}


def _match(pattern: str, rel: str) -> bool:
    return fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel, pattern.rstrip("/**"))


def main() -> int:
    findings: list[str] = []
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    classes = cfg.get("classes") if isinstance(cfg, dict) else None
    if cfg.get("schema") != 1:
        findings.append("artifact-lifecycle schema must be 1")
    if not isinstance(classes, dict):
        findings.append("classes must be object")
        classes = {}
    missing_classes = sorted(REQUIRED_CLASSES - set(classes))
    if missing_classes:
        findings.append(f"missing lifecycle classes: {', '.join(missing_classes)}")
    for name, row in sorted(classes.items()):
        if not isinstance(row, dict):
            findings.append(f"{name}: class row must be object")
            continue
        pats = row.get("patterns")
        if not isinstance(pats, list) or not pats or not all(isinstance(p, str) and p for p in pats):
            findings.append(f"{name}: patterns must be nonempty string list")
        if not isinstance(row.get("policy"), str) or not row["policy"].strip():
            findings.append(f"{name}: policy must be nonempty string")
    allow = set(cfg.get("tracked_runtime_allowlist") or [])
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"]).decode("utf-8", "surrogateescape").split("\0")
    patterns = [(name, pat) for name, row in classes.items() if isinstance(row, dict) for pat in (row.get("patterns") or [])]
    for rel in [x for x in tracked if x]:
        matched = [name for name, pat in patterns if _match(pat, rel)]
        if not matched:
            findings.append(f"unclassified tracked path: {rel}")
            continue
        if "runtime" in matched and rel not in allow and not any(name in matched for name in ("metric", "proof", "fixture")):
            findings.append(f"tracked runtime path not allowlisted: {rel}")
    for row in findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
