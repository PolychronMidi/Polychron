#!/usr/bin/env python3
"""Substrate pre-turn briefing from precomputed metrics.

Extracted from sessionstart.sh inline heredoc; the inline form forced
heredoc-quoting gymnastics that introduced regressions. Invoked by the
BG worker driving hme-substrate-brief.cache.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _load(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def main() -> int:
    metrics_dir = Path(os.environ["METRICS_DIR"])
    na = _load(metrics_dir / "hme-next-actions.json")
    con = _load(metrics_dir / "hme-consensus.json")
    dr = _load(metrics_dir / "hme-legendary-drift.json")
    n_act = na.get("total_actions", 0)
    bits = [
        f'substrate: consensus={con.get("mean", "?")} '
        f'stdev={con.get("stdev", "?")} '
        f'drift={dr.get("drift_score", "?")} '
        f'actions={n_act}'
    ]
    if n_act > 0:
        for a in (na.get("actions") or [])[:3]:
            bits.append(f'  -> [{a.get("source", "?")}] {a.get("id", "?")}')
    sys.stdout.write("\n".join(bits) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
