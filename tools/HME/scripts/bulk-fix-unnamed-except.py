#!/usr/bin/env python3
"""Rewrite `except Exception:` (unnamed, non-pass body) to `except Exception as _err:` + debug log.

Reads check-unnamed-except.py output from stdin or runs the checker itself.
Rewrites each offending except clause in-place using line offsets from the check script.
Uses static file:line labels — never scrapes surrounding code.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]  # Polychron/
CHECKER = pathlib.Path(__file__).parent / "check-unnamed-except.py"

HIT_RE = re.compile(r"^(?P<path>[^:]+):(?P<line>\d+): except Exception:$")
EXCEPT_LINE_RE = re.compile(r"^(?P<indent>\s*)except Exception:\s*(#.*)?$")


def get_hits() -> list[tuple[pathlib.Path, int]]:
    result = subprocess.run(
        [sys.executable, str(CHECKER)],
        capture_output=True,
        text=True,
    )
    hits = []
    for line in result.stdout.splitlines():
        m = HIT_RE.match(line)
        if not m:
            continue
        path = pathlib.Path(m.group("path"))
        if not path.is_absolute():
            path = ROOT / path
        lineno = int(m.group("line"))
        hits.append((path, lineno))
    return hits


def fix_file(path: pathlib.Path, linenos: list[int]) -> int:
    """Rewrite named except clauses in the file. Returns number of changes made."""
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    changed = 0
    for lineno in sorted(linenos, reverse=True):
        idx = lineno - 1  # 0-based
        if idx >= len(lines):
            continue
        m = EXCEPT_LINE_RE.match(lines[idx])
        if not m:
            # Already fixed by a previous iteration or misdetected — skip.
            continue
        indent = m.group("indent")
        label = f"{path.name}:{lineno}"
        body_indent = indent + "    "
        new_except = f"{indent}except Exception as _err:\n"
        new_log = f'{body_indent}logger.debug(f"unnamed-except {label}: {{type(_err).__name__}}: {{_err}}")\n'
        # Insert the log line after the except clause.
        lines[idx] = new_except
        lines.insert(idx + 1, new_log)
        changed += 1
    path.write_text("".join(lines), encoding="utf-8")
    return changed


def main() -> int:
    hits = get_hits()
    if not hits:
        print("No unnamed-except violations found.")
        return 0

    # Group by file.
    by_file: dict[pathlib.Path, list[int]] = {}
    for path, lineno in hits:
        by_file.setdefault(path, []).append(lineno)

    total = 0
    for path, linenos in sorted(by_file.items()):
        n = fix_file(path, linenos)
        print(f"  {path.relative_to(ROOT)}: {n} fix(es)")
        total += n

    print(f"\nTotal: {total} exception handlers renamed and logged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
