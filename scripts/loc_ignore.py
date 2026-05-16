"""Shared loader for config/loc-ignore.txt -- gitignore-style patterns
that exempt files from the LOC target declared in doc/templates/doc/templates/AGENTS.md.

Single source of truth for LOC exemptions. Consumed by:
  - scripts/audit-core-principles.py (P5 audit)
  - tools/HME/service/.../evolution_evolve.py (i/evolve focus=loc)

JS/Node consumers (scripts/report-src-loc.js) implement the same
gitignore-style match logic locally -- keep that mirror in sync if you
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
    match).

    Loud on missing file: every consumer of loc_ignore expects exemptions
    to be respected. A missing config used to silently produce an empty
    pattern list, which made every previously-exempt file fail the LOC
    audit. Refuse to silently disable the project's exemption layer --
    the operator should know if the config is gone."""
    if ignore_file is None:
        ignore_file = _project_root() / "config" / "loc-ignore.txt"
    if not ignore_file.exists():
        raise FileNotFoundError(
            f"loc_ignore: expected config at {ignore_file} -- refusing "
            f"to return an empty pattern list (would invalidate every "
            f"exemption silently). Restore the file or pass an explicit "
            f"ignore_file= argument to load_patterns()."
        )
    out: list[tuple[re.Pattern[str], bool]] = []
    for raw in ignore_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        body = line[1:] if negate else line
        out.append((_compile_pattern(body), negate))
    return out


_RATIONALE_RE = re.compile(
    r"#\s*rationale:\s*(.+?)\s*$",
    re.IGNORECASE,
)


def _parse_kv(s: str) -> dict[str, str]:
    """Parse `key=value; key=value` into a dict."""
    out: dict[str, str] = {}
    for chunk in s.split(";"):
        chunk = chunk.strip()
        if not chunk or "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def load_with_rationale(
    ignore_file: Path | None = None,
) -> list[dict]:
    """Return [{pattern, negate, rationale}] for every non-comment line.

    `rationale` is a dict parsed from the most-recent `# rationale: ...`
    comment line preceding the pattern. Empty dict if no rationale was
    declared. Used by audit-loc.py to surface intent + revisit-when
    triggers in the report -- see the architectural-rationale-diary
    rationale at the top of loc-ignore.txt.

    Decoupled from load_patterns() so callers that only need match
    behavior don't pay the cost of comment scanning.
    """
    if ignore_file is None:
        ignore_file = _project_root() / "config" / "loc-ignore.txt"
    if not ignore_file.exists():
        raise FileNotFoundError(
            f"loc_ignore.load_with_rationale: expected config at "
            f"{ignore_file}. Same fail-loud rationale as load_patterns()."
        )
    out: list[dict] = []
    pending_rationale: dict[str, str] = {}
    for raw in ignore_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            # Blank line -- clears any pending rationale that wasn't paired
            pending_rationale = {}
            continue
        if line.startswith("#"):
            m = _RATIONALE_RE.match(line)
            if m:
                pending_rationale = _parse_kv(m.group(1))
            continue
        negate = line.startswith("!")
        body = line[1:] if negate else line
        out.append({
            "pattern": body,
            "negate": negate,
            "rationale": dict(pending_rationale),
        })
    return out


def is_exempt(rel_path: str, patterns: list[tuple[re.Pattern[str], bool]]) -> bool:
    """Test if rel_path matches any non-negated pattern. Negations
    reverse a prior match (last-wins, gitignore-style)."""
    matched = False
    for regex, negate in patterns:
        if regex.search(rel_path):
            matched = not negate
    return matched
