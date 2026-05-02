#!/usr/bin/env python3
"""Project-wide ASCII enforcement.

Disallow EVERY non-ASCII character in source. ASCII (0x20-0x7e) + tab
+ newline + CR are allowed; everything else is a finding.

Strings genuinely needing unicode must use \\uXXXX escapes so they're
visible in diffs. NO allowlist. No "intentional unicode". No emoji
exceptions. No em-dash, arrow, or Greek-letter exceptions either.

This is intentionally strict: copy-paste from chat clients silently
introduces NBSP, curly quotes, zero-width spaces, and BOM that break
regex matching and diff cleanly. The simplest invariant -- "ASCII
only" -- is the most enforceable.

Mirrors the JS no-non-ascii ESLint rule (scripts/eslint-rules/no-non-ascii.js)
which has the same posture for .js files.

Exits 0 + empty stdout when clean. One-per-line `path:line:col: char` format
on hits.
"""
from __future__ import annotations
import pathlib
import sys

ALLOWED = {0x09, 0x0a, 0x0d}  # tab, LF, CR


def _scan_file(f: pathlib.Path) -> list[str]:
    hits = []
    try:
        text = f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return hits
    for lineno, line in enumerate(text.splitlines(), 1):
        for col, ch in enumerate(line, 1):
            c = ord(ch)
            if c in ALLOWED:
                continue
            if 0x20 <= c <= 0x7e:
                continue
            hits.append(f"{f}:{lineno}:{col}: {ch!r} (U+{c:04X})")
    return hits


def main() -> int:
    paths = sys.argv[1:] or ["tools/HME/service"]
    all_hits = []
    for p in paths:
        path = pathlib.Path(p)
        files = [path] if path.is_file() else list(path.rglob("*.py"))
        for f in files:
            all_hits.extend(_scan_file(f))
    if all_hits:
        for h in all_hits[:30]:
            print(h)
        if len(all_hits) > 30:
            print(f"... and {len(all_hits) - 30} more")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
