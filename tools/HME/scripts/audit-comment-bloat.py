#!/usr/bin/env python3
"""Comment-bloat audit. Flags consecutive comment blocks longer than thresholds.

Rule: comment-block of 3+ lines = WARN; 5+ lines = FAIL. Comment-block =
consecutive lines whose stripped content starts with `#` (py/sh) or `//`
(js/ts), or a `/* ... */` block (js/ts).

Why: long inline-comment blocks are DDoC spam shape -- they pad context
without earning the cost. The rule matches doc/templates/AGENTS.md "Inline comments
single-line and terse" -- 1-2 lines is the natural ceiling for a
correctly-written explanation; anything longer belongs in doc/.

Excluded from the scan:
  - shebang line (`#!/...`)
  - section-header comment patterns (single line of `===` / `---` / etc.
    surrounded by content; the pattern itself isn't a real comment block)
  - `# silent-ok: ...`, `# noqa:` --
    annotation conventions, not prose
  - lines inside raw strings / heredocs / docstrings (we'd need a real
    parser to handle these robustly; for now we accept some FP risk on
    files with docstring-embedded `#` lines)

Usage:
  python3 tools/HME/scripts/audit-comment-bloat.py            # human report
  python3 tools/HME/scripts/audit-comment-bloat.py --json     # machine output
  python3 tools/HME/scripts/audit-comment-bloat.py --strict   # exit 1 on any FAIL

Output JSON shape:
  {
    "thresholds": {"warn": 3, "fail": 5},
    "warn":  [{"path": "...", "line": N, "block_len": K}, ...],
    "fail":  [{"path": "...", "line": N, "block_len": K}, ...]
  }
"""
from __future__ import annotations

import json
import io
import os
import re
import sys
import tokenize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loc_ignore import load_patterns, is_exempt  # noqa: E402

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
_DEFAULT_ROOTS = [
    os.path.join(_PROJECT, "src"),
    os.path.join(_PROJECT, "scripts"),
    os.path.join(_PROJECT, "tools", "HME"),
]
_SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "output"}
_EXTS = {".py", ".sh", ".js", ".ts"}

WARN_LINES = int(os.environ.get("COMMENT_BLOAT_WARN", "3"))
FAIL_LINES = int(os.environ.get("COMMENT_BLOAT_FAIL", "5"))
LONG_LINE_CHARS = int(os.environ.get("COMMENT_BLOAT_LONG_LINE", "90"))
# File-top header exemption: every file gets ONE comment block at the
TOP_EXEMPT_MAX = 30

# Annotation-shaped comments aren't prose; don't count toward block length.
_ANNOTATION_PREFIXES = (
    "# silent-ok:", "# FIXME:", "# noqa",
    "# pylint:", "# pyright:", "# type:",
    "# shellcheck", "# ruff:", "# fmt:", "# isort:", "# mypy:",
    "// silent-ok:", "// FIXME:",
    "// eslint-", "// @ts-", "// prettier-ignore", "// noqa",
)

_DIRECTIVE_PREFIXES = (
    "# noqa", "# pylint:", "# pyright:", "# type:",
    "# shellcheck", "# ruff:", "# fmt:", "# isort:", "# mypy:",
    "// eslint-", "// @ts-", "// prettier-ignore", "// noqa",
)

_HEREDOC_START = re.compile(r"<<-?\s*[\"']?([A-Za-z_][A-Za-z0-9_]*)[\"']?")


def _is_comment_line(stripped: str, ext: str) -> bool:
    if not stripped:
        return False
    if ext in (".py", ".sh", ".bash", ".yaml", ".yml", ".toml"):
        if stripped.startswith("#") and not stripped.startswith("#!"):
            return True
    if ext in (".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"):
        if stripped.startswith("//"):
            return True
    return False


def _is_annotation(stripped: str) -> bool:
    return any(stripped.startswith(p) for p in _ANNOTATION_PREFIXES)


def _is_directive(stripped: str) -> bool:
    return any(stripped.startswith(p) for p in _DIRECTIVE_PREFIXES)


def _is_top_directive(stripped: str, ext: str) -> bool:
    # Lines that may legitimately precede the top-of-file doc block
    # without disqualifying the TOP_EXEMPT_MAX exemption.
    if stripped.startswith("#!"):
        return True
    if ext in (".js", ".ts") and stripped in ("'use strict';", '"use strict";'):
        return True
    return False


def _python_full_line_comments(lines: list[str]) -> set[int] | None:
    comments = set()
    try:
        stream = io.StringIO("".join(lines)).readline
        for tok in tokenize.generate_tokens(stream):
            if tok.type != tokenize.COMMENT:
                continue
            if tok.line[:tok.start[1]].strip():
                continue
            comments.add(tok.start[0])
    except tokenize.TokenError:
        return None
    return comments


def _shell_heredoc_lines(lines: list[str]) -> set[int]:
    blocked = set()
    delimiter = None
    for i, raw in enumerate(lines, 1):
        if delimiter:
            blocked.add(i)
            if raw.strip() == delimiter:
                delimiter = None
            continue
        match = _HEREDOC_START.search(raw)
        if match:
            delimiter = match.group(1)
    return blocked


def _comment_scan_sets(lines: list[str], ext: str) -> tuple[set[int] | None, set[int]]:
    if ext == ".py":
        return _python_full_line_comments(lines), set()
    if ext in (".sh", ".bash"):
        return None, _shell_heredoc_lines(lines)
    return None, set()


def _is_scannable_comment(
    line_no: int,
    stripped: str,
    ext: str,
    allowed_lines: set[int] | None,
    blocked_lines: set[int],
) -> bool:
    if line_no in blocked_lines:
        return False
    if allowed_lines is not None and line_no not in allowed_lines:
        return False
    return _is_comment_line(stripped, ext)


def _scan_file(path: str, ext: str) -> list:
    """Yield {line, block_len} for each comment block exceeding WARN_LINES.
    The first comment block at file top (after any shebang) is exempt
    up to TOP_EXEMPT_MAX lines -- file-header docs are legitimate."""
    findings = []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return findings
    allowed_lines, blocked_lines = _comment_scan_sets(lines, ext)
    block_start = None
    block_len = 0
    seen_first_block = False
    seen_non_blank_non_comment = False
    for i, raw in enumerate(lines, 1):
        s = raw.strip()
        if _is_scannable_comment(i, s, ext, allowed_lines, blocked_lines) and not _is_annotation(s):
            if block_start is None:
                block_start = i
                block_len = 1
            else:
                block_len += 1
        else:
            if block_start is not None and block_len >= WARN_LINES:
                top_exempt = (not seen_first_block) and (not seen_non_blank_non_comment) and block_len <= TOP_EXEMPT_MAX
                if not top_exempt:
                    findings.append({"line": block_start, "block_len": block_len})
                seen_first_block = True
            if s and not _is_scannable_comment(i, s, ext, allowed_lines, blocked_lines) and not _is_top_directive(s, ext):
                seen_non_blank_non_comment = True
            block_start = None
            block_len = 0
    if block_start is not None and block_len >= WARN_LINES:
        top_exempt = (not seen_first_block) and (not seen_non_blank_non_comment) and block_len <= TOP_EXEMPT_MAX
        if not top_exempt:
            findings.append({"line": block_start, "block_len": block_len})
    return findings


def _scan_long_comment_lines(path: str, ext: str) -> list:
    """Yield {line, line_len} for each comment line whose raw length is >= LONG_LINE_CHARS. Independent of block-counting rule; annotation-prefixed lines are NOT exempt (long rationale lines belong in doc/ regardless of annotation tag)."""
    findings = []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return findings
    allowed_lines, blocked_lines = _comment_scan_sets(lines, ext)
    for i, raw in enumerate(lines, 1):
        line_no_nl = raw.rstrip("\n")
        stripped = line_no_nl.strip()
        if not _is_scannable_comment(i, stripped, ext, allowed_lines, blocked_lines):
            continue
        if _is_directive(stripped):
            continue
        if len(line_no_nl) >= LONG_LINE_CHARS:
            findings.append({"line": i, "line_len": len(line_no_nl)})
    return findings


def _walk(roots, ignore_patterns):
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            for f in files:
                ext = os.path.splitext(f)[1]
                if ext not in _EXTS:
                    continue
                path = os.path.join(dp, f)
                rel = os.path.relpath(path, _PROJECT)
                if is_exempt(rel, ignore_patterns):
                    continue
                yield path, rel, ext


def main(argv: list) -> int:
    as_json = "--json" in argv
    strict = "--strict" in argv
    ignore_patterns = load_patterns()
    warn_findings = []
    fail_findings = []
    long_line_findings = []
    explicit = []
    if "--files" in argv:
        idx = argv.index("--files")
        for tok in argv[idx + 1:]:
            if tok.startswith("--"):
                break
            explicit.append(tok)
    if explicit:
        # comment-bloat does NOT honor loc-ignore.txt (different concerns).
        # File-top header exemption covers legitimate auto-gen docstrings.
        for path in explicit:
            ext = os.path.splitext(path)[1]
            if ext not in _EXTS or not os.path.isfile(path):
                continue
            rel = os.path.relpath(path, _PROJECT) if path.startswith(_PROJECT) else path
            for f in _scan_file(path, ext):
                entry = {"path": rel, "line": f["line"], "block_len": f["block_len"]}
                if f["block_len"] >= FAIL_LINES:
                    fail_findings.append(entry)
                else:
                    warn_findings.append(entry)
            for f in _scan_long_comment_lines(path, ext):
                long_line_findings.append({"path": rel, "line": f["line"], "line_len": f["line_len"]})
    else:
        for path, rel, ext in _walk(_DEFAULT_ROOTS, ignore_patterns):
            for f in _scan_file(path, ext):
                entry = {"path": rel, "line": f["line"], "block_len": f["block_len"]}
                if f["block_len"] >= FAIL_LINES:
                    fail_findings.append(entry)
                else:
                    warn_findings.append(entry)
            for f in _scan_long_comment_lines(path, ext):
                long_line_findings.append({"path": rel, "line": f["line"], "line_len": f["line_len"]})
    if as_json:
        print(json.dumps({
            "thresholds": {"warn": WARN_LINES, "fail": FAIL_LINES, "long_line_chars": LONG_LINE_CHARS},
            "warn": warn_findings,
            "fail": fail_findings,
            "long_lines": long_line_findings,
        }, indent=2))
    else:
        print(f"audit-comment-bloat: WARN >= {WARN_LINES} lines, FAIL >= {FAIL_LINES} lines, LONG_LINE >= {LONG_LINE_CHARS} chars")
        print(f"  FAIL: {len(fail_findings)}")
        for e in sorted(fail_findings, key=lambda x: -x["block_len"])[:20]:
            print(f"    {e['block_len']:>3}L  {e['path']}:{e['line']}")
        print(f"  WARN: {len(warn_findings)}")
        if len(warn_findings) <= 10:
            for e in sorted(warn_findings, key=lambda x: -x["block_len"]):
                print(f"    {e['block_len']:>3}L  {e['path']}:{e['line']}")
        print(f"  LONG_LINE ERRORS (>= {LONG_LINE_CHARS} chars): {len(long_line_findings)}")
        for e in sorted(long_line_findings, key=lambda x: -x["line_len"])[:20]:
            print(f"    {e['line_len']:>3}c  {e['path']}:{e['line']}")
    if strict and (fail_findings or long_line_findings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
