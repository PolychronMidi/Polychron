"""Single source of truth for LOC counting across the project.

Both `scripts/audit-core-principles.py` (subsystem-level rollup) and
`tools/HME/scripts/detectors/boyscout_loc.py` (per-turn touched-file gate)
import from here so the LOC threshold (CLAUDE.md: <=350) means the same
thing in both. Previously they used different counters (cLOC vs raw
`wc -l`), producing the contradiction "audit says PASS, detector says
FAIL" on the same file.

Counts NON-BLANK, NON-COMMENT lines per the file's extension. Quick, not
AST-exact -- discounts:
  - blank lines (any extension)
  - full-line `//` comments (.js / .ts)
  - full-line `#` comments (.py / .sh / .bash)
  - JSDoc-continuation `*` lines (.js / .ts)
"""
from __future__ import annotations

import os


def cloc(path: str) -> int:
    ext = os.path.splitext(path)[1]
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                if ext in (".js", ".ts"):
                    if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
                        continue
                if ext in (".py", ".sh", ".bash"):
                    if s.startswith("#") and not s.startswith("#!"):
                        continue
                n += 1
    except OSError:
        return 0
    return n
