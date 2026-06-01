#!/usr/bin/env python3
"""Cross-file impact analysis for staged + unstaged changes.

Adapted from pensive:blast-radius. No code-knowledge-graph dependency;
uses git diff to find changed files, extracts top-level identifiers
(Python def/class, JS export), and greps for those identifiers across
src/ + tools/ + lab/ to estimate cross-file impact.

Usage:
  i/audit blast                # analyze staged + unstaged changes
  i/audit blast --base HEAD~3  # against an explicit base
  i/audit blast --json         # JSON output
  i/audit blast --top N        # show top N most-impacted files (default 15)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_SCAN_DIRS = ("src", "tools", "lab")
_PY_DEF_RE = re.compile(r"^\s*(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]+)", re.MULTILINE)
_JS_EXPORT_RE = re.compile(
    r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]+)",
    re.MULTILINE,
)
_MIN_IDENT_LEN = 5  # avoid 1-3 char names that grep too broadly
_SKIP_NAMES = {"main", "init", "test", "setup", "run", "handle", "build", "load", "save"}


def _changed_files(base: str | None) -> list[Path]:
    args = ["git", "-C", str(_PROJECT), "diff", "--name-only"]
    if base:
        args.append(base)
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=10)
        if proc.returncode != 0:
            return []
        files = [_PROJECT / ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
        return [f for f in files if f.is_file()]
    except (OSError, subprocess.SubprocessError):
        return []


def _identifiers(fp: Path) -> set[str]:
    try:
        text = fp.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return set()
    out: set[str] = set()
    if fp.suffix == ".py":
        out.update(m.group(1) for m in _PY_DEF_RE.finditer(text))
    elif fp.suffix in (".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"):
        out.update(m.group(1) for m in _JS_EXPORT_RE.finditer(text))
    return {n for n in out if len(n) >= _MIN_IDENT_LEN and n not in _SKIP_NAMES}


def _grep(idents: set[str], skip_files: set[Path]) -> dict[Path, set[str]]:
    if not idents:
        return {}
    pattern = "|".join(rf"\b{re.escape(i)}\b" for i in idents)
    args = ["grep", "-rEln", "--include=*.py", "--include=*.js", "--include=*.ts",
            "--include=*.mjs", "--include=*.cjs", "--include=*.jsx", "--include=*.tsx",
            "-e", pattern]
    args.extend([str(_PROJECT / d) for d in _SCAN_DIRS if (_PROJECT / d).is_dir()])
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return {}
    impact: dict[Path, set[str]] = defaultdict(set)
    for line in proc.stdout.splitlines():
        fp = Path(line.strip())
        if not fp.is_file() or fp in skip_files:
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for ident in idents:
            if re.search(rf"\b{re.escape(ident)}\b", text):
                impact[fp].add(ident)
    return impact


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Cross-file blast-radius analyzer")
    parser.add_argument("--base", default=None,
                        help="git base ref (default: working tree vs index+HEAD)")
    parser.add_argument("--top", type=int, default=15)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    changed = _changed_files(args.base)
    if not changed:
        print("blast-radius: no changed files vs " + (args.base or "working tree"))
        return 0

    all_idents: set[str] = set()
    per_file_idents: dict[Path, set[str]] = {}
    for fp in changed:
        idents = _identifiers(fp)
        if idents:
            per_file_idents[fp] = idents
            all_idents |= idents

    if not all_idents:
        print(f"blast-radius: {len(changed)} file(s) changed; no exported identifiers detected.")
        return 0

    impact = _grep(all_idents, set(changed))
    ranked = sorted(impact.items(), key=lambda kv: (-len(kv[1]), str(kv[0])))[: args.top]

    if args.json:
        print(json.dumps({
            "changed": [str(f.relative_to(_PROJECT)) for f in changed],
            "exported_identifiers": sorted(all_idents),
            "impact": [
                {"file": str(f.relative_to(_PROJECT)), "hits": sorted(idents)}
                for f, idents in ranked
            ],
        }, indent=2))
        return 0

    print(f"blast-radius: {len(changed)} changed file(s), {len(all_idents)} exported identifier(s)")
    for fp, idents in per_file_idents.items():
        rel = fp.relative_to(_PROJECT) if str(fp).startswith(str(_PROJECT)) else fp
        print(f"  exports from {rel}: {', '.join(sorted(idents)[:6])}"
              + (f" (+{len(idents) - 6} more)" if len(idents) > 6 else ""))
    print()
    if not ranked:
        print("  no cross-file references found in src/ tools/ lab/")
        return 0
    print(f"impact (top {len(ranked)}):")
    for fp, idents in ranked:
        rel = fp.relative_to(_PROJECT) if str(fp).startswith(str(_PROJECT)) else fp
        sample = ", ".join(sorted(idents)[:3])
        more = f" (+{len(idents) - 3})" if len(idents) > 3 else ""
        print(f"  {len(idents):>3} hits  {rel}  [{sample}{more}]")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
