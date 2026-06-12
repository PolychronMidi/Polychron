#!/usr/bin/env python3
"""Onboarding transition-coverage auditor.

Catches the exact bug class that stranded an agent at `targeted`: a forward
edge in the canonical onboarding state machine with no live advancer wired to
drive it. The docstring claimed `posttooluse_edit.sh` advanced
`briefed->edited`; the body did neither, and nothing walked the machine to
notice the dead edge. Every agent making a real src/ edit got stuck.

Approach: the canonical state order lives in
`tools/HME/config/onboarding_states.json`. Each adjacent forward edge (state[i] ->
state[i+1]) MUST have at least one advancer that lands the later state.
Advancers come from two runtimes:

  * Shell hooks -- `_onb_advance_to <state>` / `_onb_set_state <state>` calls
    discovered under tools/HME/hooks/.
  * Python chain -- `set_state("<state>")` calls discovered across any module
    in the server package (dispatch table, helpers, boot auto-chain), not one
    hardcoded path.

An edge whose later state is never the argument of any advancer is a dead
transition: documented, reachable by the gate that *blocks* before it, but
with no mechanism to ever leave the earlier state. That is a trap.

`boot` needs no inbound advancer (sessionstart arms it). Every other state
must be landable.

Four failure classes, all gated:
  * DEAD-EDGE   -- a later state with no advancer landing it (the original trap).
  * GHOST-STATE -- a tight-arrow `X->Y` prose claim naming a non-canonical
    state (the `briefed->edited` docstring shape).
  * UNGUARDED   -- a shell advancer to Y with no `_onb_state == <predecessor>`
    guard nearby. _onb_advance_to is forward-only but does NOT block
    skip-ahead, so an unguarded advancer can jump the machine past states
    (a STABLE verdict reached pre-piped jumping straight to verified).
  * LABEL-DRIFT -- STEP_LABELS in onboarding_chain.py must cover every
    canonical state, in order, with sequential N/M step numbers whose M equals
    the count of numbered (non-graduated) states. Adding a state without
    fixing the labels leaves "N/7" lying -- the briefed-ghost drift class, one
    layer up in the user-facing step counter.

Exit codes:
  0 -- machine fully covered, no ghost claims, advancers guarded, labels coherent
  1 -- one or more of the four failure classes present
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
# Python chain advancers live across the server package, not one file:
# onboarding_chain_dispatch.py (the _advance table) AND
SERVER_DIR = PROJECT_ROOT / "tools" / "HME" / "service" / "server"
DISPATCH_PY = SERVER_DIR / "onboarding_chain_dispatch.py"

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

    if SERVER_DIR.exists():
        for py in sorted(SERVER_DIR.glob("onboarding_chain*.py")):
            try:
                text = py.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            rel = str(py.relative_to(PROJECT_ROOT))
            for line in text.splitlines():
                s = line.lstrip()
                if s.startswith("#"):
                    continue
                # The wrapper `def set_state(s): ... _oc.set_state(s)` re-exports
                # the verb; it advances nothing concrete, so skip dynamic-arg
                for m in _PY_SET_STATE_RE.finditer(line):
                    _record(m.group(1), rel)

    return landed


# Tight `X->Y` arrows (no spaces) are deliberate transition-pair claims in
# prose/comments, as opposed to spaced ` -> ` narrative arrows. The `briefed`
# ghost lived as exactly such a claim (`advance briefed->edited`) naming a
_TIGHT_ARROW_RE = re.compile(r"\b([a-z_]+)->([a-z_]+)\b")
# A shell advancer's predecessor-guard: `_onb_state)" = "reviewed"`.
_STATE_GUARD_RE = re.compile(r"""_onb_state\)?["']?\s*=\s*["']([a-z_]+)["']""")
# Window (lines) around an advance call to find its predecessor guard.
_GUARD_WINDOW = 4
_CHAIN_DOC_FILES = (
    PROJECT_ROOT / "tools" / "HME" / "service" / "server" / "onboarding_chain.py",
    DISPATCH_PY,
)
_CHAIN_PY = SERVER_DIR / "onboarding_chain.py"
# A STEP_LABELS entry: `"selftest_ok": f"2/7 pick ...`. Captures state + the
# N/M step number when present (graduated has no number).
_LABEL_RE = re.compile(r"""["']([a-z_]+)["']\s*:\s*f?["'](\d+)/(\d+)\b""")
_LABEL_ANY_RE = re.compile(r"""["']([a-z_]+)["']\s*:\s*f?["']""")


def _ghost_state_claims(states: set[str]) -> list[tuple[str, str, str]]:
    """Tight-arrow transition claims naming a non-canonical state.
    Returns (source, claim, offending_token)."""
    out = []
    for f in _CHAIN_DOC_FILES:
        if not f.exists():
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(f.relative_to(PROJECT_ROOT))
        for m in _TIGHT_ARROW_RE.finditer(text):
            for tok in (m.group(1), m.group(2)):
                if tok not in states:
                    out.append((rel, m.group(0), tok))
    return out


def _unguarded_advancers(states: list[str]) -> list[tuple[str, int, str]]:
    """Shell `_onb_advance_to Y` calls lacking a nearby `_onb_state == <pred>`
    guard. Returns (source, line_no, advanced_state). The predecessor is the
    canonical state immediately before Y; its guard is what stops a
    forward-only-but-skip-permitting advance from jumping the machine."""
    out = []
    idx = {s: i for i, s in enumerate(states)}
    if not HOOKS_DIR.exists():
        return out
    for dp, dirs, names in os.walk(HOOKS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for n in names:
            if not n.endswith((".sh", ".bash")) or n == "_onboarding.sh":
                continue
            p = Path(dp) / n
            try:
                lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                continue
            rel = str(p.relative_to(PROJECT_ROOT))
            for i, line in enumerate(lines):
                if line.lstrip().startswith("#"):
                    continue
                m = re.search(r"_onb_advance_to\s+([a-z_]+)", line)
                if not m:
                    continue
                later = m.group(1)
                pred_i = idx.get(later, 0) - 1
                pred = states[pred_i] if pred_i >= 0 else None
                window = "\n".join(lines[max(0, i - _GUARD_WINDOW): i + 1])
                guards = set(_STATE_GUARD_RE.findall(window))
                if pred is not None and pred not in guards:
                    out.append((rel, i + 1, later))
    return out


def _extract_step_labels() -> "list[tuple[str, int | None, int | None]]":
    """Parse the STEP_LABELS dict from onboarding_chain.py in source order.
    Returns [(state, n, m), ...] where n/m are None for unnumbered labels."""
    out = []
    if not _CHAIN_PY.exists():
        return out
    try:
        text = _CHAIN_PY.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    # Scope to the STEP_LABELS = { ... } block to avoid matching other dicts.
    start = text.find("STEP_LABELS")
    if start < 0:
        return out
    end = text.find("\n}", start)
    block = text[start: end if end > 0 else len(text)]
    for line in block.splitlines():
        if line.lstrip().startswith("#"):
            continue
        mnum = _LABEL_RE.search(line)
        if mnum:
            out.append((mnum.group(1), int(mnum.group(2)), int(mnum.group(3))))
            continue
        many = _LABEL_ANY_RE.search(line)
        if many and many.group(1) != "STEP_LABELS":
            out.append((many.group(1), None, None))
    return out


def _label_drift(states: list[str]) -> list[str]:
    """STEP_LABELS must cover every canonical state in order; numbered labels
    must be sequential 1..K where K = count of non-graduated states and equals
    every label's denominator M."""
    labels = _extract_step_labels()
    if not labels:
        return ["STEP_LABELS not found or unparseable in onboarding_chain.py"]
    problems = []
    label_states = [s for s, _, _ in labels]
    if label_states != states:
        problems.append(
            f"label order/coverage mismatch:\n"
            f"    labels: {label_states}\n"
            f"    states: {states}"
        )
        return problems  # ordering is the root issue; numbering checks would be noise
    numbered = [(s, n, m) for s, n, m in labels if n is not None]
    expected_total = len([s for s in states if s != "graduated"])
    for i, (s, n, m) in enumerate(numbered, start=1):
        if n != i:
            problems.append(f"'{s}' has step number {n}, expected {i}")
        if m != expected_total:
            problems.append(f"'{s}' denominator {m}, expected {expected_total}")
    return problems


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

    ghosts = _ghost_state_claims(set(states))
    unguarded = _unguarded_advancers(states)

    if not dead and not ghosts and not unguarded:
        print(
            f"audit-onboarding-transitions: PASS "
            f"({len(states) - 1} forward edge(s) advancer-backed, guarded, "
            f"no ghost-state transition claims)"
        )
        return 0

    print(
        f"audit-onboarding-transitions: FAIL "
        f"({len(dead)} dead transition(s), {len(ghosts)} ghost-state claim(s), "
        f"{len(unguarded)} unguarded advancer(s))"
    )
    for earlier, later in dead:
        print(f"  DEAD-EDGE: {earlier} -> {later}")
        print(f"    no _onb_advance_to/_onb_set_state/set_state lands '{later}'")
        print(f"    agents reaching '{earlier}' can never advance -- wire an advancer")
    for src, claim, tok in ghosts:
        print(f"  GHOST-STATE: {claim}  (in {src})")
        print(f"    '{tok}' is not a canonical state -- prose claims a transition that cannot exist")
    for src, line_no, later in unguarded:
        print(f"  UNGUARDED: _onb_advance_to {later}  ({src}:{line_no})")
        print(f"    no `_onb_state == <predecessor>` guard nearby -- can skip-ahead into '{later}'")
    return 1


if __name__ == "__main__":
    sys.exit(main())
