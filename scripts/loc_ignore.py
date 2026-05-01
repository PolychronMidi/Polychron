"""Shared loader for config/loc-ignore.txt — gitignore-style patterns
that exempt files from the LOC target declared in CLAUDE.md.

Single source of truth for LOC exemptions. Consumed by:
  - scripts/audit-core-principles.py (P5 audit)
  - tools/HME/service/.../evolution_evolve.py (i/evolve focus=loc)

JS/Node consumers (scripts/report-src-loc.js) implement the same
gitignore-style match logic locally — keep that mirror in sync if you
extend the syntax here.
"""
from __future__ import annotations

import os
import re
from pathlib import Path


def _project_root() -> Path:
    pr = os.environ.get("PROJECT_ROOT")
    if pr:
        return Path(pr)
    return Path(__file__).resolve().parents[1]


def _compile_pattern(pat: str) -> re.Pattern[str]:
    """Convert a gitignore-style line into a regex matching `relPath`.
    Supports: `*` (any non-slash), trailing `/` (directory), exact-match.
    """
    body = pat
    if body.endswith("/"):
        body = body[:-1]
        escaped = re.escape(body).replace(r"\*", "[^/]*")
        return re.compile(rf"(^|/){escaped}(/|$)")
    escaped = re.escape(body).replace(r"\*", "[^/]*")
    return re.compile(rf"(^|/){escaped}$")


def load_patterns(ignore_file: Path | None = None) -> list[tuple[re.Pattern[str], bool]]:
    """Return [(compiled_regex, negate_flag), ...]. negate_flag is True
    when the line starts with `!` (a negation that reverses any earlier
    match). Empty list if the file is missing."""
    if ignore_file is None:
        ignore_file = _project_root() / "config" / "loc-ignore.txt"
    if not ignore_file.exists():
        return []
    out: list[tuple[re.Pattern[str], bool]] = []
    for raw in ignore_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        body = line[1:] if negate else line
        out.append((_compile_pattern(body), negate))
    return out


def is_exempt(rel_path: str, patterns: list[tuple[re.Pattern[str], bool]]) -> bool:
    """Test if rel_path matches any non-negated pattern. Negations
    reverse a prior match (last-wins, gitignore-style)."""
    matched = False
    for regex, negate in patterns:
        if regex.search(rel_path):
            matched = not negate
    return matched
