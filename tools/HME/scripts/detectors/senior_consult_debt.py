#!/usr/bin/env python3
"""Detect "design-space changes shipped without consulting senior" — the
exact anti-pattern that motivated this detector's existence.

The buddy paradigm rests on two-way collaboration. When a turn touches
files in the buddy/handoff design space (`buddy_handoff.py`,
`buddy_init.sh`, `buddy_spawn.py`, `buddy_dispatcher.py`, the open-questions
in `BUDDY_SYSTEM.md`, the `i/consult` and `i/handoff` wrappers) but
NEVER invokes `i/consult`, the operator's design intent gets bypassed
silently. This detector flips the default from "consulting is opt-in"
to "checkpointing is opt-out for this code area" — the behavioral
inversion proposed by 0e7fbf4d during a review consult.

First fire is informational (verdict surfaces in detector output but
the Stop chain doesn't block on it). If the pattern keeps recurring,
elevate the verdict to a hard block.

Usage: senior_consult_debt.py <transcript_path>
Output: "ok" if no debt, "consult-debt" if design-space changes
without an i/consult invocation in the same turn.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_uses, load_turn_events  # noqa: E402

# Files whose edits ought to be checkpointed against the buddy. Matched
# as a substring at the end of the path so absolute and relative paths
# both hit. Add to this list as the buddy paradigm grows new components.
_DESIGN_SPACE = (
    "tools/HME/scripts/buddy_handoff.py",
    "tools/HME/scripts/buddy_dispatcher.py",
    "tools/HME/scripts/buddy_spawn.py",
    "tools/HME/hooks/helpers/buddy_init.sh",
    "tools/HME/hooks/lifecycle/stop/post_hooks.sh",
    "doc/BUDDY_SYSTEM.md",
    "i/consult",
    "i/handoff",
)


def _touches_design_space(path: str) -> bool:
    if not path:
        return False
    return any(path.endswith(target) or path.endswith("/" + target)
               or path == target for target in _DESIGN_SPACE)


def _is_consult_invocation(cmd: str) -> bool:
    """Match `i/consult ...` invocations whether direct or piped/chained.
    The wrapper accepts `sid=`, `primary=`, `buddy=`, `senior=` aliases —
    we don't care which form was used, only that the command ran."""
    if not cmd:
        return False
    return ("i/consult" in cmd
            and ("sid=" in cmd or "primary=" in cmd
                 or "buddy=" in cmd or "senior=" in cmd))


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    touched_design_space = False
    consulted = False
    for event in load_turn_events(sys.argv[1]):
        for tu in iter_tool_uses(event):
            name = tu["name"]
            if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                fp = tu["input"].get("file_path", "")
                if _touches_design_space(fp):
                    touched_design_space = True
            elif name == "Bash":
                cmd = tu["input"].get("command", "")
                if _is_consult_invocation(cmd):
                    consulted = True
    if touched_design_space and not consulted:
        print("consult-debt")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
