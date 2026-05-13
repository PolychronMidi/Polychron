#!/usr/bin/env python3
"""Project-wide ASCII enforcement across ALL source extensions.

Strict rule: no non-ASCII chars allowed anywhere in source code.
ASCII (0x20-0x7e) + tab + LF + CR are the only allowed bytes; everything
else is a finding.

No allowlist. No "intentional unicode" exceptions. No emoji exceptions.
The simplest invariant -- "ASCII only" -- is the most enforceable.

Default scan: .py, .js, .sh, .json, .md, .txt under the given roots.
Excludes node_modules, .git, output/, tmp/, log/, __pycache__, venv.

Usage:
    audit-no-non-ascii.py            # default roots: src scripts tools/HME
    audit-no-non-ascii.py path1 path2 ...
    audit-no-non-ascii.py --strict   # exit 1 on any finding
"""
from __future__ import annotations
import argparse
import pathlib
import subprocess
import sys

ALLOWED = {0x09, 0x0a, 0x0d}  # tab, LF, CR
EXTS = {'.py', '.js', '.sh', '.json', '.md', '.txt'}
EXCLUDE_DIRS = {'node_modules', '.git', 'output', 'tmp',
                '__pycache__', 'venv', '.venv', 'log', 'logs',
                'KB', '.pytest_cache', '.claude'}


def _scan_file(f: pathlib.Path) -> list[str]:
    hits = []
    try:
        text = f.read_text(encoding='utf-8', errors='replace')
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


def _is_git_ignored(p: pathlib.Path, project: pathlib.Path) -> bool:
    try:
        res = subprocess.run(
            ['git', '-C', str(project), 'check-ignore', '-q', str(p)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return False
    return res.returncode == 0


def _walk(root: pathlib.Path, project: pathlib.Path) -> list[pathlib.Path]:
    if root.is_file():
        return [] if _is_git_ignored(root, project) else [root]
    out = []
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        if any(part in EXCLUDE_DIRS for part in p.parts):
            continue
        if p.suffix not in EXTS:
            continue
        if _is_git_ignored(p, project):
            continue
        out.append(p)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('paths', nargs='*',
                   help='roots to scan (default: src scripts tools/HME)')
    p.add_argument('--strict', action='store_true',
                   help='exit 1 if any non-ASCII found')
    args = p.parse_args()

    project = pathlib.Path(__file__).resolve().parent.parent
    if args.paths:
        roots = [pathlib.Path(p) for p in args.paths]
    else:
        roots = [project / 'src', project / 'scripts', project / 'tools' / 'HME']

    all_hits = []
    for root in roots:
        for f in _walk(root):
            all_hits.extend(_scan_file(f))

    if all_hits:
        for h in all_hits[:30]:
            print(h)
        if len(all_hits) > 30:
            print(f"... and {len(all_hits) - 30} more")
        return 1 if args.strict else 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
