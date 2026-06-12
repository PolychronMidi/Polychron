#!/usr/bin/env python3
"""Guard the source-grep invariant seam: every RULES key must be enforced.

The recurring subversion shape is "a guard exists but observes nothing, or a
reference points at a guard that does not exist" -- the gap between the letter
(a rule is defined) and the intent (a rule actually runs over the codebase).

Two failure modes this closes:

  orphan rule   -- a key in check_source_grep_invariant.py RULES that NO
                   invariant shard references. The pattern exists but nothing
                   ever executes it, so the ban it encodes is silently inert.

  dangling ref  -- an invariant shard runs `check_source_grep_invariant.py X`
                   where X is not a defined RULES key. The battery crashes (or,
                   worse, is excused) instead of enforcing anything.

Emitting any line means the seam is open. Empty output == bijection holds.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CHECKER = ROOT / "tools/HME/scripts/invariants/check_source_grep_invariant.py"
SHARD_DIR = ROOT / "tools/HME/config/invariants"

# Rule keys intentionally invocable by humans/tests but not wired to a shard.
# Keep empty; every entry here is a hole we are choosing to tolerate, so it must
ALLOWED_ORPHANS: set[str] = set()


def defined_rule_keys() -> set[str]:
    text = CHECKER.read_text(encoding="utf-8")
    # Top-level RULES dict keys: 4-space indented "key": [
    return set(re.findall(r'^\s{4}"([a-z0-9-]+)":\s*\[', text, re.M))


def shard_referenced_keys() -> set[str]:
    refs: set[str] = set()
    for shard in SHARD_DIR.glob("*.json"):
        for m in re.findall(r"check_source_grep_invariant\.py ([a-z0-9-]+)", shard.read_text(encoding="utf-8")):
            refs.add(m)
    return refs


def main() -> int:
    defined = defined_rule_keys()
    referenced = shard_referenced_keys()

    orphans = sorted((defined - referenced) - ALLOWED_ORPHANS)
    dangling = sorted(referenced - defined)

    for key in orphans:
        print(f"orphan source-grep rule (defined, no shard references it -> observes nothing): {key}")
    for key in dangling:
        print(f"dangling shard reference (invariant runs '{key}', no such RULES key -> enforces nothing): {key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
