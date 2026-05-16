#!/usr/bin/env python3
"""Audit the public HME surface.

This is the single guard for two drift classes:
  - doc/ top-level stays deliberately small
  - public i/* command names stay in sync with the registry and do not
    resurrect retired wrappers

Exit 0 with no stdout when --quiet is passed and the surface is clean.
Print violations on stdout and exit 1 on drift.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

PROJECT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
DOC_TOP_FILES = {"HME.md", "composition.md", "self-coherence-full.md", "composition-full.md"}
DOC_TOP_DIRS = {"infra", "templates", "theory"}

RETIRED_WRAPPERS = {"consult", "handoff", "chain", "todo", "hme-admin", "hme-read", "read"}
RETIRED_PUBLIC_RE = re.compile(
    r"\bi/(?:consult|handoff|chain|todo|hme-admin|hme-read|read)\b"
)
RETIRED_CALLABLE_RE = re.compile(
    r"\b(?:read\(target|read\(mode|read\(before\)|hme_admin\(|"
    r"mcp__HME__(?:read|todo|consult|handoff|chain)\b)"
)


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _doc_files() -> list[Path]:
    out = [PROJECT / "README.md", PROJECT / "AGENTS.md"]
    doc = PROJECT / "doc"
    if doc.is_dir():
        out.extend(sorted(p for p in doc.rglob("*.md") if "devlog" not in p.parts))
    return [p for p in out if p.is_file()]


def _check_doc_root(issues: list[str]) -> None:
    doc = PROJECT / "doc"
    if not doc.is_dir():
        issues.append("doc/ directory missing")
        return
    files = {p.name for p in doc.iterdir() if p.is_file() and not p.name.startswith(".")}
    dirs = {p.name for p in doc.iterdir() if p.is_dir() and not p.name.startswith(".")}
    extra_files = sorted(files - DOC_TOP_FILES)
    missing_files = sorted(DOC_TOP_FILES - files)
    extra_dirs = sorted(dirs - DOC_TOP_DIRS)
    missing_dirs = sorted(DOC_TOP_DIRS - dirs)
    for name in extra_files:
        issues.append(f"doc root has unmerged file: doc/{name}")
    for name in missing_files:
        issues.append(f"doc root missing required file: doc/{name}")
    for name in extra_dirs:
        issues.append(f"doc root has unapproved directory: doc/{name}")
    for name in missing_dirs:
        issues.append(f"doc root missing required directory: doc/{name}")


def _check_i_registry(issues: list[str]) -> None:
    i_dir = PROJECT / "i"
    reg_path = PROJECT / "tools" / "HME" / "i_registry.json"
    if not i_dir.is_dir():
        issues.append("i/ directory missing")
        return
    try:
        reg = _load_json(reg_path)
    except (OSError, ValueError) as exc:
        issues.append(f"i registry unreadable: {exc}")
        return
    scripts = {
        p.name for p in i_dir.iterdir()
        if p.is_file() and not p.name.startswith(".")
    }
    commands = set((reg.get("commands") or {}).keys())
    for name in sorted(scripts - commands):
        issues.append(f"i/{name} exists but is not in i_registry.json")
    for name in sorted(commands - scripts):
        issues.append(f"i_registry.json lists missing wrapper: i/{name}")
    for name in sorted((scripts | commands) & RETIRED_WRAPPERS):
        issues.append(f"retired wrapper still public: i/{name}")

    serialized = json.dumps(reg, sort_keys=True)
    for hit in RETIRED_PUBLIC_RE.findall(serialized):
        issues.append(f"i_registry.json references retired public wrapper: {hit}")


def _check_invocation_map(issues: list[str]) -> None:
    path = PROJECT / "tools" / "HME" / "config" / "tool-invocations.json"
    try:
        data = _load_json(path)
    except (OSError, ValueError) as exc:
        issues.append(f"tool invocation map unreadable: {exc}")
        return
    tools = data.get("tools") or {}
    expected = {
        ("hme_admin", "i"): "i/hme admin action=<ACTION>",
        ("read", "i"): "Read",
        ("hme_todo", "i"): "TodoWrite",
    }
    for (tool, key), value in expected.items():
        got = (tools.get(tool) or {}).get(key)
        if got != value:
            issues.append(
                f"tool-invocations.json {tool}.{key} = {got!r}; expected {value!r}"
            )
    serialized = json.dumps(data, sort_keys=True)
    for match in RETIRED_PUBLIC_RE.findall(serialized):
        issues.append(f"tool-invocations.json references retired wrapper: {match}")


def _check_public_docs(issues: list[str]) -> None:
    for path in _doc_files():
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(PROJECT)
        for lineno, line in enumerate(text.splitlines(), start=1):
            if RETIRED_PUBLIC_RE.search(line):
                issues.append(f"{rel}:{lineno}: retired public wrapper reference")
            if RETIRED_CALLABLE_RE.search(line):
                issues.append(f"{rel}:{lineno}: internal callable leaked into public docs")


def main(argv: list[str]) -> int:
    quiet = "--quiet" in argv
    issues: list[str] = []
    _check_doc_root(issues)
    _check_i_registry(issues)
    _check_invocation_map(issues)
    _check_public_docs(issues)
    if issues:
        for issue in issues:
            print(issue)
        return 1
    if not quiet:
        print("audit-public-surface: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
