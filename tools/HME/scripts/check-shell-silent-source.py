#!/usr/bin/env python3
"""Ban silent-swallow patterns on `source` lines in shell hooks.

The exact bug this session caught: _safety.sh:6 used
    source $(…)/.env 2>/dev/null || true
and the path was wrong (`../..` vs `../../../..`). The `|| true` swallowed
the file-not-found, so every hook for months ran with PROJECT_ROOT unset.
That cascaded into broken auto-commit, broken PROJECT_ROOT-dependent
paths in a dozen downstream hooks, etc.

Rule: any `source X` line referencing a file that is CRITICAL
infrastructure (helpers, env, safety preamble) must fail loud —
specifically must NOT suffix with `2>/dev/null || true` or any variant
that swallows the outcome.

Allowed:
    source helpers/_safety.sh
    [ -f X ] && source X        # explicit guard OK
    source X 2>err.log || exit 1  # explicit failure routing OK

Banned:
    source X 2>/dev/null || true
    source X 2>/dev/null; true
    source X || true
    source X 2>/dev/null

Exit 0 = clean, non-0 = violations (shell_output_empty invariant PASS/FAIL).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Paths/patterns that are LOAD-BEARING infrastructure. Silent source failure
# for these hides broken hook state. Extend as needed.
INFRA_MARKERS = (
    "_safety.sh",
    "_nexus.sh",
    "_onboarding.sh",
    "_tab_helpers.sh",
    ".env",          # env file sourcing
    "helpers/",      # any helpers dir path
    "_safe",         # safety helpers
)


def is_infra_source(line: str) -> bool:
    """Does this line source one of the infrastructure files?"""
    # Match `source X` or `. X` (bash-dot form).
    m = re.match(r'\s*(?:source|\.)\s+(?P<target>\S[^;&|]*)', line)
    if not m:
        return False
    target = m.group("target").strip()
    return any(marker in target for marker in INFRA_MARKERS)


def has_silent_swallow(line: str) -> bool:
    """Does this line swallow errors? `|| true`, `2>/dev/null` (alone or
    combined with `|| true`) swallow the outcome and hide broken state."""
    stripped = line.split("#", 1)[0]  # ignore trailing comments
    if re.search(r'\|\|\s*true(\s*;|\s*$)', stripped):
        return True
    # `2>/dev/null` alone is mildly OK only if followed by `|| exit` / `|| return`
    # / an explicit failure route. Bare `2>/dev/null` on a source line = bug.
    if "2>/dev/null" in stripped and not re.search(r'\|\|\s*(exit|return|false|_emit|echo.*WARNING)', stripped):
        return True
    return False


def scan_file(path: Path) -> list[str]:
    violations: list[str] = []
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return violations
    for lineno, line in enumerate(text.splitlines(), 1):
        if not is_infra_source(line):
            continue
        if has_silent_swallow(line):
            violations.append(
                f"{path}:{lineno}: silent `source` of infrastructure file — "
                f"remove `2>/dev/null || true` / `|| true` so missing or broken "
                f"infra fails loud. Line: {line.strip()[:120]}"
            )
    return violations


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tools/HME/hooks")
    if not root.is_dir():
        print(f"ERROR: {root} is not a directory", file=sys.stderr)
        return 2
    violations: list[str] = []
    for sh in root.rglob("*.sh"):
        violations.extend(scan_file(sh))
    for v in sorted(violations):
        print(v)
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
