"""Shared helpers for the stop-hook / PreToolUse behavioral detector scripts.

Each detector parses the current turn from the transcript, evaluates a
predicate, and prints a verdict. This module is the small shared surface those
scripts import:

    transcript_arg(argv)         -- transcript path from argv (or None)
    load_turn(loader)            -- load the turn via a detector-supplied loader
    emit_stats(verdict, detail)  -- append a detector-stats telemetry row,
        deriving the detector name from the calling module (single source of
        truth; see _detector_stats.emit_stats).
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def transcript_arg(argv: list[str] | None = None) -> str | None:
    args = sys.argv if argv is None else argv
    return args[1] if len(args) >= 2 else None


def load_turn(loader, argv: list[str] | None = None):
    path = transcript_arg(argv)
    if path is None:
        return None
    return loader(path)


def emit_stats(verdict: str, detail: str = "") -> None:
    from _detector_stats import emit_stats as _emit_stats
    _emit_stats(None, verdict, detail)
