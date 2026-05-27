#!/usr/bin/env python3
"""Vow: bounded discovery reads. Adapted from imbue:vow_bounded_reads.

Counts consecutive Read/Grep/Glob calls in a session-scoped counter.
When the count exceeds HME_READ_BUDGET (default 15), warn on stderr or
block (exit 2) when HME_READ_BUDGET_ENFORCED=1. Counter resets when
this turn issues a Write/Edit/MultiEdit (companion script handles reset).

Polychron has a Bash polling guard but no Read/Grep/Glob ceiling. This
closes the "I just keep reading without acting" exploration drift.

Usage (called by pretooluse_read.sh / _grep.sh / _glob.sh):
  vow_bounded_reads.py [--reset]

Env knobs:
  HME_READ_BUDGET             default 15
  HME_READ_BUDGET_ENFORCED    1=block at threshold, else warn-only
  HME_SESSION_ID              session id (else fixed-name fallback)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import fcntl  # POSIX-only; Windows degrades to unlocked RMW.
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_TMP = _PROJECT / "tmp"
_DEFAULT_BUDGET = 15


def _counter_path() -> Path:
    sid = os.environ.get("HME_SESSION_ID", "default")
    return _TMP / f"hme-native-read-budget-{sid}.txt"


def _budget() -> int:
    raw = os.environ.get("HME_READ_BUDGET", str(_DEFAULT_BUDGET))
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return _DEFAULT_BUDGET


def _enforced() -> bool:
    return os.environ.get("HME_READ_BUDGET_ENFORCED", "0") == "1"


def _read_modify_write(delta: int = 0, reset: bool = False) -> int:
    """Atomic counter update; returns new value."""
    p = _counter_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.touch(exist_ok=True)
    with open(p, "r+", encoding="utf-8") as f:
        if _HAS_FCNTL:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            except OSError:
                pass  # silent-ok: best-effort fs op
        cur_raw = f.read().strip()
        try:
            cur = int(cur_raw) if cur_raw else 0
        except ValueError:
            cur = 0
        new = 0 if reset else cur + delta
        f.seek(0); f.truncate(0); f.write(str(new))
    return new


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true",
                        help="zero the counter (call from Edit/Write hook)")
    args = parser.parse_args(argv)

    if args.reset:
        _read_modify_write(reset=True)
        return 0

    new = _read_modify_write(delta=1)
    budget = _budget()
    if new <= budget:
        return 0

    msg = (
        f"BOUNDED-READS VOW: {new} consecutive Read/Grep/Glob this turn (budget={budget}). "
        f"Switch to acting -- the exploration is drifting. Reset on next Edit/Write/MultiEdit."
    )
    if _enforced():
        sys.stderr.write(f"BLOCKED: {msg}\n")
        return 2
    sys.stderr.write(f"[bounded-reads warn] {msg}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
