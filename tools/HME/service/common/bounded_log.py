"""Bounded append-only log helper.

Consolidates three near-duplicate `_maybe_trim_append` implementations
(hme_http_store.py, synthesis_pipeline.py, synthesis_reasoning.py) into a
single function. Every JSONL/log append site that used to grow unbounded
now calls `maybe_trim_append(path, max_lines)` after its write — O(1)
hot path (counter + divisibility check), real work fires every N writes.

When a file exceeds `max_lines`, the tail half is kept (i.e., we drop
the oldest half). Atomic replace via `.trim.tmp` so a crash mid-trim
doesn't leave a corrupt file.

Design notes:
  - Per-path counter lives in module-level dict (process-local, reset
    on worker restart — acceptable; the file re-fills fast enough that
    a fresh counter catches up within the next full cycle).
  - Check cadence = `check_every` (default 200). Smaller = more trim
    overhead; larger = longer worst-case overshoot. 200 is the empirical
    sweet spot: <10ms trim cost, ≤ 200 lines overshoot.
  - `max_lines` applies AT TRIM TIME only. A file is allowed to reach
    `max_lines + check_every - 1` between checks. Callers who need
    stricter bounds should pass a lower cap; not a correctness issue.
  - Trim is NOT thread-safe at the OS-level (two workers writing the
    same file could race on replace). Accept this — HME runs a single
    worker per port, so the write path is single-writer by construction.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("HME")

_COUNTERS: dict[str, int] = {}

DEFAULT_CHECK_EVERY = 200
# Sensible default cap — 20k JSONL lines is ~5MB for typical entry sizes.
DEFAULT_MAX_LINES = 20_000


def maybe_trim_append(path: str | Path, max_lines: int = DEFAULT_MAX_LINES,
                       check_every: int = DEFAULT_CHECK_EVERY) -> None:
    """Call AFTER writing a line to an append-only file. Every `check_every`
    calls (per-path), if the file exceeds `max_lines`, rewrite it with the
    tail half only.

    Silent on any OS error (best-effort observability — callers should
    already have the write succeed or handle its failure before us)."""
    key = str(path)
    _COUNTERS[key] = _COUNTERS.get(key, 0) + 1
    if _COUNTERS[key] % check_every != 0:
        return
    try:
        with open(key, "rb") as f:
            total = sum(buf.count(b"\n") for buf in iter(lambda: f.read(65536), b""))
    except OSError:
        return
    if total <= max_lines:
        return
    keep = max_lines // 2
    tmp_path = key + ".trim.tmp"
    try:
        with open(key, "r", encoding="utf-8", errors="replace") as src, \
             open(tmp_path, "w", encoding="utf-8") as dst:
            buf: list[str] = []
            for line in src:
                buf.append(line)
                if len(buf) > keep:
                    buf.pop(0)
            dst.writelines(buf)
        os.replace(tmp_path, key)
    except OSError as _trim_err:
        logger.debug(f"bounded_log trim {key}: {type(_trim_err).__name__}: {_trim_err}")
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
