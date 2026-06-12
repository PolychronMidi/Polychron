#!/usr/bin/env python3
"""Onboarding transition-coverage auditor.

Catches the exact bug class that stranded an agent at `targeted`: a forward
edge in the canonical onboarding state machine with no live advancer wired to
drive it. The docstring claimed `posttooluse_edit.sh` advanced
`briefed->edited`; the body did neither, and nothing walked the machine to
notice the dead edge. Every agent making a real src/ edit got stuck.

Approach: the canonical state order lives in
`config/onboarding_states.json`. Each adjacent forward edge (state[i] ->
state[i+1]) MUST have at least one advancer that lands the later state.
Advancers come from two runtimes:

  * Shell hooks -- `_onb_advance_to <state>` / `_onb_set_state <state>` calls
    under tools/HME/hooks/.
  * Python chain dispatch -- `set_state("<state>")` calls in
    onboarding_chain_dispatch.py (the `_advance` table) and the boot
    auto-chain.

An edge whose later state is never the argument of any advancer is a dead
transition: documented, reachable by the gate that *blocks* before it, but
with no mechanism to ever leave the earlier state. That is a trap.

`boot` needs no inbound advancer (sessionstart arms it). Every other state
must be landable.

Exit codes:
  0 -- every forward edge has >=1 advancer that lands the later state
  1 -- one or more dead transitions (later state never advanced-to)
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_env = os.environ.get("PROJECT_ROOT")
PROJECT_ROOT = Path(_env) if _env else Path(__file__).resolve().parents[3]

STATES_JSON = PROJECT_ROOT / "tools" / "HME" / "config" / "onboarding_states.json"
HOOKS_DIR = PROJECT_ROOT / "tools" / "HME" / "hooks"
DISPATCH_PY = (
    PROJECT_ROOT / "tools" / "HME" / "service" / "server" / "onboarding_chain_dispatch.py"
)

# Shell: `_onb_advance_to edited` / `_onb_set_state reviewed`.
_SHELL_ADVANCE_RE = re.compile(r"_onb_(?:advance_to|set_state)\s+([a-z_]+)")
# Python: `set_state("targeted")` / `set_state('graduated')`.
_PY_SET_STATE_RE = re.compile(r"""set_state\(\s*['"]([a-z_]+)['"]\s*\)""")


def _load_states() -> list[str]:
    with open(STATES_JSON, encoding="utf-8") as f:
        return json.load(f)["states"]


def _landed_states() -> dict[str, list[str]]:
    """Map each state -> list of source locations that advance INTO it."""
    landed: dict[str, list[str]] = {}

    def _record(state: str, where: str) -> None:
        landed.setdefault(state, []).append(where)

    if HOOKS_DIR.exists():
        for dp, dirs, names in os.walk(HOOKS_DIR):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for n in names:
                if not n.endswith((".sh", ".bash")):
                    continue
                p = Path(dp) / n
                # Skip the helper that DEFINES the verbs (it names states in
                # the canonical fallback array, not as live advance calls).
                if n == "_onboarding.sh":
                    continue
                try:
                    text = p.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                rel = str(p.relative_to(PROJECT_ROOT))
                for line in text.splitlines():
                    s = line.lstrip()
                    if s.startswith("#"):
                        continue
                    for m in _SHELL_ADVANCE_RE.finditer(line):
                        _record(m.group(1), rel)

    if DISPATCH_PY.exists():
        try:
            text = DISPATCH_PY.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
        rel = str(DISPATCH_PY.relative_to(PROJECT_ROOT))
        for line in text.splitlines():
            s = line.lstrip()
            if s.startswith("#"):
                continue
            for m in _PY_SET_STATE_RE.finditer(line):
                _record(m.group(1), rel)

    return landed


def main() -> int:
    verbose = "--verbose" in sys.argv
    states = _load_states()
    landed = _landed_states()

    if verbose:
        for st in states:
            print(f"  {st}: {landed.get(st, [])}")

    # boot is armed by sessionstart, never advanced-to. graduated is a valid
    # landing (learn). Every forward edge state[i+1] for i>=0 must be landable.
    dead = []
    for i in range(len(states) - 1):
        later = states[i + 1]
        if later not in landed:
            dead.append((states[i], later))

    if not dead:
        print(
            f"audit-onboarding-transitions: PASS "
            f"({len(states) - 1} forward edge(s), every later state has a live advancer)"
        )
        return 0

    print(f"audit-onboarding-transitions: FAIL ({len(dead)} dead transition(s))")
    for earlier, later in dead:
        print(f"  DEAD-EDGE: {earlier} -> {later}")
        print(f"    no _onb_advance_to/_onb_set_state/set_state lands '{later}'")
        print(f"    agents reaching '{earlier}' can never advance -- wire an advancer")
    return 1


if __name__ == "__main__":
    sys.exit(main())
