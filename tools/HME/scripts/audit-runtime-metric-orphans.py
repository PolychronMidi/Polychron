#!/usr/bin/env python3
from __future__ import annotations

import argparse
import time
from pathlib import Path

from hme_paths import COMPOSITION_METRICS_DIR, HME_METRICS_DIR, is_hme_metric_name


def _iter_legacy() -> list[Path]:
    base = COMPOSITION_METRICS_DIR
    if not base.exists():
        return []
    out: list[Path] = []
    for path in base.rglob("*"):
        if path.is_file() and is_hme_metric_name(*path.relative_to(base).parts):
            out.append(path)
    return sorted(out)


def audit() -> tuple[list[str], list[str]]:
    stale: list[str] = []
    legacy: list[str] = []
    for path in _iter_legacy():
        rel = path.relative_to(COMPOSITION_METRICS_DIR)
        target = HME_METRICS_DIR / rel
        legacy.append(str(path))
        try:
            old_m = path.stat().st_mtime
            new_m = target.stat().st_mtime if target.exists() else 0
        except OSError:
            continue
        if old_m > new_m + 5:
            age = int((time.time() - old_m) // 60)
            stale.append(f"{rel} legacy newer than runtime ({age}m old)")
    return legacy, stale


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit legacy HME metric orphans")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    legacy, stale = audit()
    verdict = "PASS" if not stale else "FAIL" if args.strict else "WARN"
    print(f"runtime-metric-orphans: {verdict} legacy={len(legacy)} stale={len(stale)}")
    for item in stale[:30]:
        print(f"  - {item}")
    return 1 if args.strict and stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
