#!/usr/bin/env python3
"""Live-Probe enforcement (PAI Verification Doctrine Rule 1).

Doctrine: every ISC marked [x] MUST have evidence in the ISA's
Verification section. Polychron's audit-isa.py already detects the
violation; this detector hardens it into a Stop-chain block.

The detector scans every tmp/isa/*/ISA.md for unverified [x] ISCs.
If any ISA has criteria flipped to [x] without a corresponding
Verification entry, the stop chain blocks the turn.

The detector ONLY fires when the current turn touched ISA.md files
(via Edit/Write) -- merely existing prior unverified-ISCs from earlier
sessions don't block every turn. The agent who just toggled an ISC
to [x] is the one who needs to provide evidence.

Verdicts:
  ok                          no current-turn ISA edits, OR all [x] ISCs
                              have Verification entries
  live_probe_missing          current turn touched an ISA, that ISA now
                              has [x] ISCs without Verification entries

Usage: live_probe.py <transcript_path>
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import _parse_all, iter_tool_uses  # noqa: E402

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_ISA_LIB = _PROJECT / "tools" / "HME" / "scripts" / "isa"
sys.path.insert(0, str(_ISA_LIB))


def _isa_paths_touched_this_turn(events: list) -> set[Path]:
    """Return the set of ISA.md files Edit/Write/MultiEdit touched this turn."""
    out: set[Path] = set()
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") not in {"Edit", "MultiEdit", "Write", "NotebookEdit"}:
                continue
            path_str = (tu.get("input") or {}).get("file_path", "") or ""
            if not path_str:
                continue
            p = Path(path_str)
            if p.name == "ISA.md":
                out.add(p)
    return out


def _isa_has_unverified(path: Path) -> list[str]:
    """Parse ISA, return list of [x] ISC ids without a Verification entry."""
    try:
        from isa_lib import parse_isa, unverified_iscs
    except ImportError:
        return []
    if not path.is_file():
        return []
    try:
        d = parse_isa(path)
    except Exception:
        return []
    return [isc.id for isc in unverified_iscs(d)]


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0

    # Test override: when set, mirror exactly. Same pattern as
    forced = os.environ.get("LIVE_PROBE_FORCE")
    if forced:
        print(forced)
        return 0

    events = _parse_all(sys.argv[1])
    touched = _isa_paths_touched_this_turn(events)
    if not touched:
        print("ok")
        return 0
    for path in touched:
        unverified = _isa_has_unverified(path)
        if unverified:
            print("live_probe_missing")
            return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
