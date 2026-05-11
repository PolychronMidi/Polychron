#!/usr/bin/env python3
"""Buddy primary watchdog. Adapted from egregore:watchdog (semantics differ).

Polychron's buddy primary is a sid POINTER, not a long-lived process; consults
spawn `claude --resume <sid>` per call. So "process crash" doesn't apply.
The structural failure mode is "transcript file missing" -- Claude Code purged
the JSONL OR the sid was wrong from the start. This watchdog clears the
pointer in only that case so the next SessionStart spawns fresh.

Note: silence is NOT a failure signal. A primary with no recent consults is
healthy-but-idle, not dead. Clearing on silence would orphan accumulated
context unnecessarily.

Usage:
  buddy_watchdog.py             # one check + exit
  buddy_watchdog.py --loop      # continuous; sleep HME_BUDDY_WATCHDOG_INTERVAL_S between checks

Env knobs:
  HME_BUDDY_WATCHDOG_INTERVAL_S=300   --loop sleep between checks (default 5min)
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
_DEFAULT_INTERVAL = int(os.environ.get("HME_BUDDY_WATCHDOG_INTERVAL_S", "300"))


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


def _check_primary() -> str:
    """Return one of: 'no_primary', 'healthy', 'transcript_missing', 'stale_prewarm'.
    Silence is NOT a failure -- idle primaries with valid transcripts are healthy.
    stale_prewarm fires when SPEC.md mtime > buddy transcript birth (pre-warm context drift)."""
    sid = _read_primary_sid()
    if not sid:
        return "no_primary"
    tp = _transcript_path(sid)
    if tp is None:
        return "transcript_missing"
    try:
        spec = _PROJECT / "doc" / "templates" / "SPEC.md"
        if spec.is_file() and spec.stat().st_mtime > tp.stat().st_mtime + 60:
            return "stale_prewarm"
    except OSError:
        pass  # silent-ok: best-effort fs op
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
            pass  # silent-ok: best-effort fs op


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true",
                        help="continuous watchdog; sleep HME_BUDDY_WATCHDOG_INTERVAL_S")
    parser.add_argument("--interval", type=int, default=_DEFAULT_INTERVAL)
    args = parser.parse_args(argv)

    if os.environ.get("HME_BUDDY_WATCHDOG_DISABLED") == "1":
        print("buddy_watchdog: disabled via env")
        return 0

    while True:
        status = _check_primary()
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if status == "transcript_missing":
            sys.stderr.write(f"[{ts}] buddy_watchdog: primary status={status}; clearing pointer\n")
            _clear_primary()
        elif status == "stale_prewarm":
            sys.stderr.write(f"[{ts}] buddy_watchdog: status=stale_prewarm -- SPEC.md changed since buddy spawn; "
                             f"consults may reason from stale Goal/Architecture. Consider retire+respawn for fresh pre-warm.\n")
        else:
            sys.stderr.write(f"[{ts}] buddy_watchdog: status={status}\n")
        if not args.loop:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
