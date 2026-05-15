#!/usr/bin/env python3
"""Ensure *_full.md docs carry a compact top navigation index."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

START = "<!-- doc-infra-nav:start -->"
END = "<!-- doc-infra-nav:end -->"
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def slug(text: str, used: dict[str, int]) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text).lower()
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[^a-z0-9 _.-]", "", text)
    base = re.sub(r"[\s_.-]+", "-", text).strip("-") or "section"
    n = used.get(base, 0)
    used[base] = n + 1
    return base if n == 0 else f"{base}-{n}"


def headings(text: str, levels: set[int]) -> list[tuple[int, str, str]]:
    in_nav = False
    used: dict[str, int] = {}
    out: list[tuple[int, str, str]] = []
    for line in text.splitlines():
        if line.strip() == START:
            in_nav = True
            continue
        if line.strip() == END:
            in_nav = False
            continue
        if in_nav:
            continue
        m = HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        title = m.group(2).strip()
        if level == 1 or title.lower() == "navigation" or level not in levels:
            continue
        out.append((level, title, slug(title, used)))
    return out


def render_nav(items: list[tuple[int, str, str]]) -> str:
    links = " · ".join(f"[{title}](#{anchor})" for _level, title, anchor in items)
    return f"{START} **Navigation:** {links} {END}\n"


def strip_nav(text: str) -> str:
    pattern = re.compile(rf"\n?{re.escape(START)}.*?{re.escape(END)}\n?", re.S)
    return pattern.sub("\n", text).lstrip("\n")


def insert_nav(text: str, nav: str) -> str:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("## "):
            return "\n".join(lines[:i]).rstrip() + "\n\n" + nav + "\n" + "\n".join(lines[i:]).lstrip("\n") + "\n"
    return text.rstrip() + "\n\n" + nav


def update_text(text: str, levels: set[int]) -> str:
    clean = strip_nav(text)
    items = headings(clean, levels)
    if not items:
        return clean.rstrip() + "\n"
    return insert_nav(clean, render_nav(items))


def full_docs(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*_full.md") if p.is_file())


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default="doc", help="documentation root")
    ap.add_argument("--check", action="store_true", help="fail if files need updates")
    ap.add_argument("--levels", default="2", help="heading levels to index, comma-separated")
    args = ap.parse_args(argv)
    levels = {int(x) for x in args.levels.split(",") if x.strip()}
    changed: list[Path] = []
    for path in full_docs(Path(args.root)):
        before = path.read_text(encoding="utf-8")
        after = update_text(before, levels)
        if before == after:
            continue
        changed.append(path)
        if not args.check:
            path.write_text(after, encoding="utf-8")
    if changed:
        for path in changed:
            print(path)
        return 1 if args.check else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
