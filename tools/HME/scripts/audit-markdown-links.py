#!/usr/bin/env python3
"""Markdown-link integrity audit. Catches broken relative links across doc/.

Scans .md files under doc/, README.md, and tools/HME/ for markdown
inline links `[text](path)` and reports any whose target doesn't resolve.

Resolves relative paths against the source file's directory. Skips:
  - HTTP/HTTPS URLs
  - mailto: / tel: links
  - Pure-anchor links (`#section`)
  - Image links (`![alt](path)`) -- treated same as text links

Exit codes:
  0 -- no broken links
  1 -- broken links found (with --strict)

Usage:
  python3 tools/HME/scripts/audit-markdown-links.py            # human report
  python3 tools/HME/scripts/audit-markdown-links.py --json
  python3 tools/HME/scripts/audit-markdown-links.py --strict
"""
from __future__ import annotations

import json
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
# `KB/devlog` holds frozen archive snapshots -- intentional historical
_SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "output", "devlog"}
_SCAN_ROOTS = [
    os.path.join(_PROJECT, "doc"),
    os.path.join(_PROJECT, "tools", "HME"),
]
_EXTRA_FILES = [
    os.path.join(_PROJECT, "README.md"),
]


def _is_skipped_target(target: str) -> bool:
    if target.startswith(("http://", "https://", "mailto:", "tel:", "ftp://")):
        return True
    if target.startswith("#"):
        return True
    return False


def _resolve(source_file: str, target: str) -> str:
    target_no_anchor = target.split("#", 1)[0].split("?", 1)[0]
    if not target_no_anchor:
        return ""  # pure-anchor link; already filtered above
    if target_no_anchor.startswith("/"):
        return os.path.join(_PROJECT, target_no_anchor.lstrip("/"))
    return os.path.normpath(
        os.path.join(os.path.dirname(source_file), target_no_anchor)
    )


def _walk_md_files():
    for f in _EXTRA_FILES:
        if os.path.isfile(f):
            yield f
    for root in _SCAN_ROOTS:
        if not os.path.isdir(root):
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if f.endswith(".md"):
                    yield os.path.join(dp, f)


def _scan_file(path: str) -> list:
    findings = []
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return findings
    for line_no, line in enumerate(content.split("\n"), 1):
        for m in _LINK_RE.finditer(line):
            target = m.group(1)
            if _is_skipped_target(target):
                continue
            resolved = _resolve(path, target)
            if not resolved:
                continue
            if not os.path.exists(resolved):
                rel_src = os.path.relpath(path, _PROJECT)
                findings.append({
                    "source": rel_src,
                    "line": line_no,
                    "target": target,
                    "resolved": os.path.relpath(resolved, _PROJECT),
                })
    return findings


def main(argv: list) -> int:
    as_json = "--json" in argv
    strict = "--strict" in argv
    all_broken = []
    for path in _walk_md_files():
        all_broken.extend(_scan_file(path))
    if as_json:
        print(json.dumps({"broken": all_broken, "count": len(all_broken)}, indent=2))
    else:
        print(f"audit-markdown-links: {len(all_broken)} broken link(s)")
        for b in all_broken[:50]:
            print(f"  {b['source']}:{b['line']}  ({b['target']}) -> {b['resolved']}")
        if len(all_broken) > 50:
            print(f"  ... ({len(all_broken) - 50} more)")
    if strict and all_broken:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
