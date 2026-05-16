#!/usr/bin/env python3
"""DocIntegrity audit (PAI v6.3.0 import #6).

Walks markdown files under doc/, src/, scripts/, tools/HME/ and
validates every cross-reference link of the form `[text](path)` or
`[text](path#anchor)` resolves to an existing file. Findings:

  - broken file ref       link target file does not exist
  - broken anchor         file exists but no `## anchor` heading matches
  - external-shaped       link looks like a path but uses ./ or ../
                          patterns the audit can't resolve cheaply

External http(s) URLs are ignored. Link targets starting with `#`
(same-doc anchors) are ignored. Code-fenced spans are skipped.

Usage:
    audit-doc-integrity.py             # default roots
    audit-doc-integrity.py --strict    # exit 1 on any finding
    audit-doc-integrity.py path/...    # custom roots
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parent.parent)

_DEFAULT_ROOTS = [
    _PROJECT / "doc",
    _PROJECT / "src",
    _PROJECT / "scripts",
    _PROJECT / "tools" / "HME",
]

_EXCLUDE_DIRS = {"node_modules", ".git", "output", "tmp",
                 "__pycache__", "venv", ".venv", "log", "logs",
                 # KB/devlog entries are timestamped frozen records of
                 "devlog"}

# Markdown link: [text](target). target may include #anchor and trailing
# whitespace before close paren is rare. Captures inner text and target.
_LINK_RE = re.compile(r"\[([^\]\n]+?)\]\(([^)\n]+?)\)")
_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+?`")


def _strip_codespans(text: str) -> str:
    text = _FENCE_RE.sub(" ", text)
    text = _INLINE_CODE_RE.sub(" ", text)
    return text


def _resolve(link: str, doc_path: Path) -> tuple[Path, str]:
    """Split target into (file path, anchor). Return absolute file path
    plus the anchor token (or '')."""
    if "#" in link:
        target, anchor = link.split("#", 1)
    else:
        target, anchor = link, ""
    target = target.strip()
    if not target:
        return doc_path, anchor  # same-doc anchor, treated as resolved
    p = (doc_path.parent / target).resolve()
    return p, anchor


def _heading_anchors(file_path: Path) -> set[str]:
    """Read a markdown file and return the set of ATX-style heading
    slugs (lowercase, dash-separated). Used to validate #anchor links."""
    out: set[str] = set()
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for line in text.splitlines():
        m = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if not m:
            continue
        slug = re.sub(r"[^\w\s-]", "", m.group(1).lower())
        slug = re.sub(r"\s+", "-", slug).strip("-")
        if slug:
            out.add(slug)
    return out


def _check_file(md: Path) -> list[str]:
    findings: list[str] = []
    try:
        text = _strip_codespans(md.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return findings
    for m in _LINK_RE.finditer(text):
        target = m.group(2).strip()
        if (target.startswith(("http://", "https://", "mailto:", "tel:"))
                or target.startswith("#")
                or target.startswith("data:")):
            continue
        # Skip pure URL fragments and image embeds with anchor-only refs.
        path, anchor = _resolve(target, md)
        if not path.exists():
            findings.append(
                f"{md.relative_to(_PROJECT)}: broken file ref -> {target}"
            )
            continue
        if anchor and path.suffix == ".md":
            slugs = _heading_anchors(path)
            if anchor.lower() not in slugs:
                findings.append(
                    f"{md.relative_to(_PROJECT)}: broken anchor "
                    f"#{anchor} in {path.relative_to(_PROJECT)}"
                )
    return findings


def _walk(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix == ".md" else []
    out: list[Path] = []
    if not root.is_dir():
        return out
    for p in root.rglob("*.md"):
        if any(part in _EXCLUDE_DIRS for part in p.parts):
            continue
        out.append(p)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("paths", nargs="*",
                   help="roots to scan (default: doc/ src/ scripts/ tools/HME/)")
    p.add_argument("--strict", action="store_true",
                   help="exit 1 if any cross-reference is broken")
    args = p.parse_args()

    roots = [Path(x) for x in args.paths] if args.paths else _DEFAULT_ROOTS
    findings: list[str] = []
    file_count = 0
    for root in roots:
        for md in _walk(root):
            file_count += 1
            findings.extend(_check_file(md))

    if findings:
        for f in findings[:50]:
            print(f)
        if len(findings) > 50:
            print(f"... and {len(findings) - 50} more")
        print(f"audit-doc-integrity: {len(findings)} broken refs across "
              f"{file_count} markdown files")
        return 1 if args.strict else 0
    print(f"audit-doc-integrity: clean ({file_count} markdown files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
