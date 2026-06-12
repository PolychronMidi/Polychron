#!/usr/bin/env python3
"""Ensure migration baselines only shrink and never hide new findings."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SOURCE_CHECK = ROOT / "tools/HME/scripts/invariants/check_source_grep_invariant.py"


def _load_source_checker():
    spec = importlib.util.spec_from_file_location("source_check", SOURCE_CHECK)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SOURCE_CHECK}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _check(rule: str) -> int:
    mod = _load_source_checker()
    stats = mod._baseline_stats(rule)
    problems: list[str] = []
    if stats["new_count"]:
        problems.append(f"{rule}: {stats['new_count']} unbaselined finding(s)")
    if stats["baseline_count"] > stats["initial_count"]:
        problems.append(
            f"{rule}: baseline grew {stats['baseline_count']} > initial {stats['initial_count']}"
        )
    if stats["stale_baseline_count"]:
        problems.append(f"{rule}: {stats['stale_baseline_count']} stale baseline hash(es); refresh baseline")
    if problems:
        print("\n".join(problems))
        return 1
    return 0


def main() -> int:
    rule = sys.argv[1] if len(sys.argv) == 2 else "no-hardcoded-metrics-path"
    return _check(rule)


if __name__ == "__main__":
    raise SystemExit(main())
