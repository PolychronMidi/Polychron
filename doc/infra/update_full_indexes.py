#!/usr/bin/env python3
"""Ensure *_full.md docs carry a compact top navigation index."""
from __future__ import annotations

import argparse
import os
import re
import subprocess
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
    lines = [START, "## Navigation", ""]
    for level, title, anchor in items:
        indent = "  " * max(0, level - 2)
        lines.append(f"{indent}- [{title}](#{anchor})")
    lines.append(END)
    return "\n".join(lines) + "\n"


def strip_nav(text: str) -> str:
    pattern = re.compile(rf"\n?{re.escape(START)}.*?{re.escape(END)}\n?", re.S)
    return pattern.sub("\n", text).lstrip("\n")


def insert_nav(text: str, nav: str) -> str:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("## "):
            return "\n".join(lines[:i]).rstrip() + "\n\n" + nav + "\n" + "\n".join(lines[i:]).lstrip("\n") + "\n"
    return text.rstrip() + "\n\n" + nav


def repo_root() -> Path:
    try:
        root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
        return Path(root)
    except Exception:
        return Path.cwd()


def git_paths(root: Path) -> set[str]:
    try:
        raw = subprocess.check_output(["git", "ls-files"], cwd=root, text=True)
    except Exception:
        return set()
    paths = {line.strip() for line in raw.splitlines() if line.strip()}
    for item in list(paths):
        parent = Path(item).parent
        while str(parent) != ".":
            paths.add(parent.as_posix() + "/")
            parent = parent.parent
    return paths


def path_target(raw: str, known: set[str]) -> str | None:
    if raw.startswith(("http://", "https://", "#")) or "\n" in raw:
        return None
    candidates = [raw, raw.lstrip("./")]
    if raw.endswith("/"):
        candidates.append(raw.rstrip("/"))
    else:
        candidates.append(raw + "/")
    for c in candidates:
        if c in known:
            return c
    return None


def rel_link(doc_path: Path, target: str, root: Path) -> str:
    clean = target.rstrip("/")
    rel = os.path.relpath(root / clean, start=(root / doc_path).parent)
    rel = Path(rel).as_posix()
    return rel + ("/" if target.endswith("/") else "")


def autolink_paths(text: str, doc_path: Path, known: set[str], root: Path) -> str:
    out: list[str] = []
    in_fence = False
    code_re = re.compile(r"`([^`]+)`")
    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or START in line or END in line:
            out.append(line)
            continue
        def repl(m: re.Match[str]) -> str:
            end = m.end()
            if m.start() > 0 and line[m.start() - 1] == "[" and line[end:end + 2] == "](":
                return m.group(0)
            target = path_target(m.group(1), known)
            if not target:
                return m.group(0)
            return f"[`{m.group(1)}`]({rel_link(doc_path, target, root)})"
        out.append(code_re.sub(repl, line))
    return "\n".join(out) + "\n"


def update_text(text: str, levels: set[int], doc_path: Path, known: set[str], root: Path) -> str:
    clean = strip_nav(text)
    clean = autolink_paths(clean, doc_path, known, root)
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
    ap.add_argument("--levels", default="2,3,4,5,6", help="heading levels to index, comma-separated")
    args = ap.parse_args(argv)
    levels = {int(x) for x in args.levels.split(",") if x.strip()}
    root = repo_root()
    known = git_paths(root)
    changed: list[Path] = []
    for path in full_docs(Path(args.root)):
        before = path.read_text(encoding="utf-8")
        after = update_text(before, levels, path, known, root)
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
