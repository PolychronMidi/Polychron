#!/usr/bin/env python3
"""Stop-level AI-slop detector. Adapted subset of scribe:slop-detector.

Three checks on files Edit/Written this turn:
  1. Identity leaks (P0): "As a (large )?language model", "as of my training cutoff",
     "I cannot provide" -- AI self-reference left in committed text.
  2. Bare TODO/FIXME without an issue link (#NNN): unattributed deferred work.
  3. Unbacked claims (README only): production-ready/scalable/fast/secure/battle-
     tested/blazing-fast without same-repo evidence (CI workflow / benchmarks /
     test count). Claim-without-evidence is the README slop class.

Verdicts:
  ok          no slop in this turn's edits
  slop_scan   one or more files have a P0 finding

Env knobs:
  SLOP_SCAN_DISABLED=1   bypass entirely (escape hatch)
  SLOP_SCAN_README_ONLY_CLAIMS=0  also scan non-README docs for unbacked claims

Usage: slop_scan.py <transcript_path>
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, event_content  # noqa: E402

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])

_IDENTITY_LEAK_RE = re.compile(
    r"\b(as a (large )?language model|"
    r"as of my (training|knowledge) cutoff|"
    r"i (cannot|can'?t) (provide|comply|access|fulfill)|"
    r"i (am|'m) just an? ai|"
    r"i don'?t have (real-?time|access to))\b",
    re.IGNORECASE,
)

# Bare TODO/FIXME requires `:` or `(` after to distinguish deferred-work markers
_BARE_TODO_RE = re.compile(
    r"(^|[^A-Za-z0-9_])(TODO|FIXME|XXX|HACK)\s*[:(]"
    r"(?![^\n]*\(#?[A-Z]*-?\d+\))"
    r"(?![^\n]*github\.com/[^/\s]+/[^/\s]+/issues/\d+)",
)

# Quality claims that demand evidence (per CONSTITUTION rule 5). Require an
_CLAIM_RE = re.compile(
    r"\b(production[- ]?ready|battle[- ]?tested|"
    r"(blazing|lightning|super)[- ]?fast|highly scalable|enterprise[- ]?grade|"
    r"world[- ]?class|state[- ]?of[- ]the[- ]?art|"
    r"industry[- ]?leading|best[- ]in[- ]?class)\b",
    re.IGNORECASE,
)
_EVIDENCE_NEAR_RE = re.compile(
    r"(\.github/workflows/|tests?/|benchmark|"
    r"\d+\s+tests?|coverage|ci\b|see (`?\w+`?:?\s*\w+))",
    re.IGNORECASE,
)

_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
# Core instruction templates legitimately quote patterns this detector matches.
_SKIP_PATH_PARTS = {"__pycache__", "node_modules", ".git", "tools/HME/KB/devlog"}
_SKIP_EXACT_PATHS = {
    "doc/templates/TODO.md",
    "tools/HME/scripts/detectors/slop_scan.py",
    "AGENTS.md",
}


def is_skipped_path(fp: Path) -> bool:
    """Public helper: True iff fp matches the detector's exclusion list.
    Tiered-audit and other direct-invocation callers use this so they don't
    re-flag templates and self-quoting source files. Mirrors the in-line
    check in _collect_edited_files."""
    s = str(fp)
    if any(seg in s for seg in _SKIP_PATH_PARTS):
        return True
    try:
        rel = str(fp.relative_to(_PROJECT))
    except ValueError:
        return False
    return rel in _SKIP_EXACT_PATHS

# Filename-with-TODO false-positive guard: TODO.md, FIXME.txt, etc. are filenames.
_TODO_FILENAME_RE = re.compile(r"\.(md|txt|rst|adoc|html?|json|ya?ml)\b", re.IGNORECASE)


def _is_in_code_fence(text: str, pos: int) -> bool:
    """True if pos is inside a markdown ``` ... ``` block."""
    fence_count = text[:pos].count("\n```")
    return fence_count % 2 == 1


def _is_in_quoted_string(line: str, match_start_in_line: int) -> bool:
    """True if the match position is inside `'...'` or `"..."` on the same line."""
    before = line[:match_start_in_line]
    # Count unescaped quotes before the match position.
    dq = before.count('"') - before.count('\\"')
    sq = before.count("'") - before.count("\\'")
    return (dq % 2 == 1) or (sq % 2 == 1)


def _collect_edited_files(events: list) -> list[Path]:
    out: list[Path] = []
    for ev in events:
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("name") not in _WORK_TOOLS:
                continue
            inp = block.get("input") or {}
            fp = inp.get("file_path")
            if isinstance(fp, str) and fp:
                p = Path(fp)
                if not p.is_absolute():
                    p = _PROJECT / p
                if any(seg in str(p) for seg in _SKIP_PATH_PARTS):
                    continue
                try:
                    rel = str(p.relative_to(_PROJECT))
                    if rel in _SKIP_EXACT_PATHS:
                        continue
                except ValueError:
                    pass  # silent-ok: best-effort parse
                out.append(p)
    return out


def _line_excerpt(text: str, pos: int) -> tuple[str, int]:
    """Return (line_text, match_start_within_line) for the line containing pos."""
    line_start = text.rfind("\n", 0, pos) + 1
    line_end = text.find("\n", pos)
    if line_end == -1:
        line_end = len(text)
    return text[line_start:line_end], pos - line_start


def _scan_identity(text: str) -> list[str]:
    hits = []
    for m in _IDENTITY_LEAK_RE.finditer(text):
        if _is_in_code_fence(text, m.start()):
            continue
        line, in_line = _line_excerpt(text, m.start())
        if _is_in_quoted_string(line, in_line):
            continue
        line_n = text[: m.start()].count("\n") + 1
        hits.append(f"line {line_n}: \"{m.group(0)}\"")
        if len(hits) >= 3:
            break
    return hits


def _scan_bare_todo(text: str) -> list[str]:
    hits = []
    for m in _BARE_TODO_RE.finditer(text):
        if _is_in_code_fence(text, m.start()):
            continue
        line, in_line = _line_excerpt(text, m.start())
        if _is_in_quoted_string(line, in_line):
            continue
        # Filename guard: TODO.md, FIXME.txt etc. are paths, not deferred work.
        after_match = line[in_line + len(m.group(0)):]
        if _TODO_FILENAME_RE.match(after_match):
            continue
        line_n = text[: m.start()].count("\n") + 1
        line_excerpt = line.strip()[:100]
        hits.append(f"line {line_n}: {line_excerpt}")
        if len(hits) >= 3:
            break
    return hits


def _scan_unbacked_claims(text: str, fp: Path) -> list[str]:
    if os.environ.get("SLOP_SCAN_README_ONLY_CLAIMS", "1") == "1":
        if fp.name.upper() not in ("README.MD", "README"):
            return []
    hits = []
    for m in _CLAIM_RE.finditer(text):
        line_n = text[: m.start()].count("\n") + 1
        # Look for evidence within +/- 10 lines
        line_start = text.rfind("\n", 0, m.start()) + 1
        # Get context: 5 lines before, 5 after
        before_chunk = text[max(0, line_start - 500): line_start]
        after_chunk = text[m.end(): m.end() + 500]
        if _EVIDENCE_NEAR_RE.search(before_chunk + after_chunk):
            continue
        hits.append(f"line {line_n}: \"{m.group(0)}\" (no evidence within +/- 500 chars)")
        if len(hits) >= 3:
            break
    return hits


def main() -> int:
    if os.environ.get("SLOP_SCAN_DISABLED") == "1":
        print("ok")
        return 0
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    files = _collect_edited_files(events)
    if not files:
        print("ok")
        return 0
    findings: list[str] = []
    for fp in files:
        if not fp.is_file():
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(fp.relative_to(_PROJECT)) if str(fp).startswith(str(_PROJECT)) else str(fp)
        for h in _scan_identity(text):
            findings.append(f"  IDENTITY-LEAK {rel} {h}")
        for h in _scan_bare_todo(text):
            findings.append(f"  BARE-TODO {rel} {h}")
        for h in _scan_unbacked_claims(text, fp):
            findings.append(f"  UNBACKED-CLAIM {rel} {h}")
    if findings:
        sys.stderr.write("slop_scan findings:\n" + "\n".join(findings[:10]) + "\n")
        print("slop_scan")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
