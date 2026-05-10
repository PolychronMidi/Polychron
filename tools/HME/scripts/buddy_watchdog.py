#!/usr/bin/env python3
"""Buddy primary watchdog. Adapted from egregore:watchdog.

Periodically checks the active buddy primary's health. When the recorded sid
no longer corresponds to a resumable Claude Code transcript, OR the transcript
has been silent for HME_BUDDY_MAX_SILENCE_S, the watchdog clears the primary
pointer so the next SessionStart spawns a fresh inaugural primary.

Polychron's BUDDY_HANDOFF tracks the primary in runtime/hme/buddy-primary.sid
but has no crash-recovery: a dead primary stays dead until a human notices.
This watchdog closes that gap. Composes existing buddy_handoff.py + transcript
discovery; adds no new state.

Usage:
  buddy_watchdog.py                # one check + exit
  buddy_watchdog.py --loop         # continuous; sleep HME_BUDDY_WATCHDOG_INTERVAL_S between checks
  buddy_watchdog.py --max-silence  # transcript silence threshold seconds (default 1800)

Env knobs:
  HME_BUDDY_MAX_SILENCE_S=1800        primary stale after this many seconds of transcript silence
  HME_BUDDY_WATCHDOG_INTERVAL_S=120   --loop sleep between checks
  HME_BUDDY_WATCHDOG_DISABLED=1       no-op the watchdog
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_PRIMARY_SID = _PROJECT / "runtime" / "hme" / "buddy-primary.sid"
_LEGACY_SID = _PROJECT / "runtime" / "hme" / "buddy.sid"
_DEFAULT_MAX_SILENCE = int(os.environ.get("HME_BUDDY_MAX_SILENCE_S", "1800"))
_DEFAULT_INTERVAL = int(os.environ.get("HME_BUDDY_WATCHDOG_INTERVAL_S", "120"))


def _read_primary_sid() -> str | None:
    if not _PRIMARY_SID.is_file():
        return None
    sid = _PRIMARY_SID.read_text(encoding="utf-8").strip()
    return sid or None


def _transcript_path(sid: str) -> Path | None:
    """Locate the Claude Code transcript JSONL for a sid. Mirrors
    buddy_dispatch_status._transcript_path_for_sid logic."""
    home = Path(os.environ.get("HOME", "/home/jah"))
    projects = home / ".claude" / "projects"
    if not projects.is_dir():
        return None
    for proj_dir in projects.iterdir():
        candidate = proj_dir / f"{sid}.jsonl"
        if candidate.is_file():
            return candidate
    return None


def _check_primary(max_silence_s: int) -> str:
    """Return one of: 'no_primary', 'healthy', 'transcript_missing', 'silent'."""
    sid = _read_primary_sid()
    if not sid:
        return "no_primary"
    tp = _transcript_path(sid)
    if tp is None:
        return "transcript_missing"
    age_s = time.time() - tp.stat().st_mtime
    if age_s > max_silence_s:
        return "silent"
    return "healthy"


def _clear_primary() -> None:
    """Remove primary pointers so the next SessionStart spawns fresh.
    Mirrors buddy_handoff._retire's clear logic, minus the senior-pool move."""
    for p in (_PRIMARY_SID, _PRIMARY_SID.with_suffix(".floor"),
              _PRIMARY_SID.with_suffix(".effort_floor"),
              _LEGACY_SID, _LEGACY_SID.with_suffix(".floor"),
              _LEGACY_SID.with_suffix(".effort_floor")):
        try:
            p.unlink()
        except (OSError, FileNotFoundError):
            pass


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true",
                        help="continuous watchdog; sleep HME_BUDDY_WATCHDOG_INTERVAL_S")
    parser.add_argument("--max-silence", type=int, default=_DEFAULT_MAX_SILENCE)
    parser.add_argument("--interval", type=int, default=_DEFAULT_INTERVAL)
    args = parser.parse_args(argv)

    if os.environ.get("HME_BUDDY_WATCHDOG_DISABLED") == "1":
        print("buddy_watchdog: disabled via env")
        return 0

    while True:
        status = _check_primary(args.max_silence)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if status in ("transcript_missing", "silent"):
            sys.stderr.write(f"[{ts}] buddy_watchdog: primary status={status}; clearing pointer\n")
            _clear_primary()
        else:
            sys.stderr.write(f"[{ts}] buddy_watchdog: status={status}\n")
        if not args.loop:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
