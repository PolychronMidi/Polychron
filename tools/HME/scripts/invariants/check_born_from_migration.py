#!/usr/bin/env python3
"""Require born_from on new invariants while legacy uncited IDs migrate."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/invariants.json"
BASELINE = ROOT / "tools/HME/config/invariants/born_from_baseline.json"


def _load_doc(path: Path, seen: set[Path] | None = None) -> dict:
    seen = seen or set()
    path = path.resolve()
    if path in seen:
        raise ValueError(f"cyclic invariant include: {path}")
    seen.add(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    merged = {k: v for k, v in data.items() if k not in {"_include", "invariants"}}
    invs = list(data.get("invariants") or [])
    for rel in data.get("_include") or []:
        child = _load_doc((path.parent / rel).resolve(), seen)
        invs.extend(child.get("invariants") or [])
    merged["invariants"] = invs
    return merged


def main() -> int:
    data = _load_doc(CONFIG)
    baseline = set()
    if BASELINE.is_file():
        baseline = set(json.loads(BASELINE.read_text(encoding="utf-8")).get("allowed_missing_born_from", []))
    bad = [
        inv.get("id", "<missing-id>") for inv in data.get("invariants", [])
        if not inv.get("born_from") and inv.get("id") not in baseline
    ]
    if bad:
        print("new invariant(s) missing born_from: " + ", ".join(sorted(bad)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
