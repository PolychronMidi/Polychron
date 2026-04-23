"""Coherence timeseries — every selftest run appends a row here.

Point-in-time probes (selftest, health) are photographs. This module
turns them into a filmstrip so three temporal failure modes become
detectable:

  1. Slow drift — probe X PASSes but its measurement (e.g. GPU residual
     MB, error-log count, chunks_indexed) has degraded monotonically
     over N runs. The system is getting worse even though no single
     run flags a failure.

  2. New-failure-class alert — a probe that PASSed for M runs just
     flipped WARN/FAIL. The regression is fresh; investigate before
     the failure class hardens into "normal."

  3. Coverage entropy — out of N registered probes, only K have EVER
     caught a real issue in history. The other N-K may be dead weight
     or waiting for their moment; explicit coverage tracking prevents
     the selftest suite from growing into ritual.

File: output/metrics/hme-coherence-timeseries.jsonl
Format: one JSON object per line, newest at end. Each row:
  {
    "ts": 1745000000.0,
    "hci": 95,
    "n_pass": 18, "n_fail": 0, "n_warn": 2,
    "probes": {
      "daemon uniqueness": {"status": "PASS", "detail": "..."},
      ...
    }
  }
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("HME")

_MAX_ROWS = 1000  # hard cap; older rows trimmed on write


def _timeseries_path(project_root: str) -> Path:
    return Path(project_root) / "output" / "metrics" / "hme-coherence-timeseries.jsonl"


def _parse_result_line(line: str) -> tuple[str, str, str]:
    """Parse a selftest result string like 'PASS: daemon uniqueness -- detail'
    into (status, name, detail). Returns ('UNKNOWN', line, '') for unrecognized."""
    line = line.strip()
    for status in ("PASS", "FAIL", "WARN", "INFO", "NEW", "ERR"):
        prefix = status + ":"
        if line.startswith(prefix):
            remainder = line[len(prefix):].strip()
            if " -- " in remainder:
                name, detail = remainder.split(" -- ", 1)
                return status, name.strip(), detail.strip()
            return status, remainder, ""
    return "UNKNOWN", line, ""


def record_run(project_root: str, hci: int | None, result_lines: Iterable[str]) -> None:
    """Append one row to the timeseries. Never raises — coherence logging
    must not break selftest itself."""
    try:
        probes: dict[str, dict] = {}
        n_pass = n_fail = n_warn = 0
        for line in result_lines:
            status, name, detail = _parse_result_line(line)
            if status == "UNKNOWN" or not name:
                continue
            probes[name] = {"status": status, "detail": detail[:200]}
            if status == "PASS":
                n_pass += 1
            elif status == "FAIL":
                n_fail += 1
            elif status == "WARN":
                n_warn += 1

        row = {
            "ts": round(time.time(), 3),
            "hci": hci,
            "n_pass": n_pass,
            "n_fail": n_fail,
            "n_warn": n_warn,
            "probes": probes,
        }
        path = _timeseries_path(project_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Read existing rows, trim to last _MAX_ROWS-1, append new row.
        existing: list[str] = []
        if path.exists():
            with path.open(encoding="utf-8") as f:
                existing = f.readlines()
        existing = existing[-(_MAX_ROWS - 1):]
        with path.open("w", encoding="utf-8") as f:
            f.writelines(existing)
            f.write(json.dumps(row) + "\n")
    except Exception as e:
        logger.warning(f"coherence_timeseries: record_run failed: {type(e).__name__}: {e}")


def load_rows(project_root: str, tail: int = 50) -> list[dict]:
    """Load the most recent `tail` rows. Returns [] on any error."""
    try:
        path = _timeseries_path(project_root)
        if not path.exists():
            return []
        with path.open(encoding="utf-8") as f:
            lines = f.readlines()[-tail:]
        return [json.loads(ln) for ln in lines if ln.strip()]
    except Exception as e:
        logger.debug(f"coherence_timeseries: load_rows failed: {e}")
        return []


def detect_drift(project_root: str, min_runs: int = 5) -> list[str]:
    """Return human-readable drift alerts.

    - new-FAIL: probe was PASS for >=3 of last 5 runs, now FAIL/WARN.
    - flipped-recovery: probe was FAIL/WARN, now PASS (informational).
    - monotone-degrade: TODO once probes carry numeric payloads
      (observability-of-observability upgrade).
    """
    alerts: list[str] = []
    rows = load_rows(project_root, tail=min_runs + 1)
    if len(rows) < min_runs:
        return alerts  # not enough history yet
    current = rows[-1]["probes"]
    history = rows[-min_runs - 1:-1]
    # Collect per-probe historical status.
    per_probe_hist: dict[str, list[str]] = {}
    for h in history:
        for name, info in h.get("probes", {}).items():
            per_probe_hist.setdefault(name, []).append(info.get("status", "UNKNOWN"))
    for name, cur_info in current.items():
        cur_status = cur_info.get("status", "UNKNOWN")
        hist_statuses = per_probe_hist.get(name, [])
        if len(hist_statuses) < 3:
            continue
        was_passing = hist_statuses.count("PASS") >= max(3, len(hist_statuses) - 1)
        if was_passing and cur_status in ("FAIL", "WARN"):
            alerts.append(
                f"new-regression: {name} flipped {hist_statuses[-1]}→{cur_status} "
                f"after {len(hist_statuses)} PASSes (fresh regression — investigate now)"
            )
        was_failing = hist_statuses.count("PASS") == 0 and len(hist_statuses) >= 3
        if was_failing and cur_status == "PASS":
            alerts.append(
                f"recovered: {name} now PASS after {len(hist_statuses)} consecutive non-PASS runs"
            )
    return alerts


def coverage_entropy(project_root: str, tail: int = 100) -> dict:
    """Return (total_probes_seen, n_probes_that_ever_failed, dead_weight_list).

    Probes that have never failed in the last `tail` runs may be dead
    weight — they may never catch a real issue, or the failure class
    they guard against became architecturally impossible. Worth auditing
    periodically via the retirement pattern.
    """
    rows = load_rows(project_root, tail=tail)
    if not rows:
        return {"total": 0, "ever_failed": 0, "dead_weight": []}
    all_probes: set[str] = set()
    ever_failed: set[str] = set()
    for r in rows:
        for name, info in r.get("probes", {}).items():
            all_probes.add(name)
            if info.get("status") in ("FAIL", "WARN"):
                ever_failed.add(name)
    dead_weight = sorted(all_probes - ever_failed)
    return {
        "total": len(all_probes),
        "ever_failed": len(ever_failed),
        "dead_weight": dead_weight,
    }
