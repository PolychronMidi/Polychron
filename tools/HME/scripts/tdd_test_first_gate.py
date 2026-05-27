#!/usr/bin/env python3
"""TDD test-first gate. Blocks impl-file Edit/Write when no sibling test exists.

Adapted from claude-night-market imbue:tdd_bdd_gate.py. Polychron-specific
deviations: opt-in via HME_TDD_GATE=1 (shadow-mode default = warn-only);
project-specific impl<->test mapping (foo.py <-> test_foo.py OR foo_test.py;
foo.js <-> foo.test.js); skip vendored/generated/exempt paths.

Exit codes:
  0  pass (test exists, file is not impl, or shadow-mode)
  2  block (impl file lacks corresponding test AND HME_TDD_GATE=1)

Usage (called from pretooluse hook bash wrappers):
  HME_TDD_GATE=1 python3 tdd_test_first_gate.py --file <abs-path>
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Files that need tests. Lives outside skill/agent/doc files (those are prose).
_IMPL_EXTS = {".py", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"}

# Test-file mappings: for each impl extension, the patterns that satisfy the gate.
_TEST_PATTERNS = {
    ".py": ("test_{stem}.py", "{stem}_test.py"),
    ".js": ("{stem}.test.js", "test_{stem}.js"),
    ".ts": ("{stem}.test.ts", "test_{stem}.ts"),
    ".jsx": ("{stem}.test.jsx",),
    ".tsx": ("{stem}.test.tsx",),
    ".mjs": ("{stem}.test.mjs",),
    ".cjs": ("{stem}.test.cjs",),
}

# Skip these path segments entirely. Mirrors the project's loc-ignore + linter exempts.
_SKIP_DIRS = {"__pycache__", "node_modules", ".git", ".venv", "venv", "dist", "build"}

# Files that ARE tests / fixtures / config -- not impl, no gate.
_NOT_IMPL_BASENAMES = {
    "conftest.py", "__init__.py", "setup.py",
    "vitest.config.js", "jest.config.js", "rollup.config.js",
}


def _is_skipped(path: Path, project_root: Path) -> bool:
    parts = set(path.parts)
    if parts & _SKIP_DIRS:
        return True
    name = path.name
    if name.startswith("test_") or name.endswith("_test.py"):
        return True
    if ".test." in name or ".spec." in name:
        return True
    if name in _NOT_IMPL_BASENAMES:
        return True
    return False


def _is_impl_file(path: Path) -> bool:
    if path.suffix not in _IMPL_EXTS:
        return False
    if "tests" in path.parts or "test" in path.parts:
        return False
    return True


def _candidate_test_paths(impl: Path) -> list[Path]:
    patterns = _TEST_PATTERNS.get(impl.suffix, ())
    out: list[Path] = []
    parent = impl.parent
    stem = impl.stem
    for pat in patterns:
        out.append(parent / pat.format(stem=stem))
        # Also check sibling tests/ directory (Python convention).
        out.append(parent / "tests" / pat.format(stem=stem))
        out.append(parent.parent / "tests" / pat.format(stem=stem))
    return out


def _has_test(impl: Path) -> bool:
    return any(p.is_file() for p in _candidate_test_paths(impl))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="absolute path of file being written")
    args = parser.parse_args(argv)

    enabled = os.environ.get("HME_TDD_GATE", "0") == "1"
    project_root = Path(os.environ.get("PROJECT_ROOT") or
                        Path(__file__).resolve().parents[3])

    fp = Path(args.file)
    if not fp.is_absolute():
        fp = (project_root / fp).resolve()

    if _is_skipped(fp, project_root):
        return 0
    if not _is_impl_file(fp):
        return 0

    # Allow EDITS to existing files; only NEW impl files need a test first.
    # (Iron Law applies at file birth, not every micro-edit; matches imbue's intent.)
    if fp.exists():
        return 0

    if _has_test(fp):
        return 0

    expected = sorted({p.name for p in _candidate_test_paths(fp)})
    msg = (
        f"TDD GATE: new implementation file {fp.relative_to(project_root)} has no "
        f"corresponding test. Iron Law: write the failing test first, then the impl. "
        f"Expected one of: {', '.join(expected[:3])}. "
    )
    if not enabled:
        sys.stderr.write(f"[tdd_gate shadow] {msg}\n")
        return 0

    sys.stderr.write(f"BLOCKED: {msg}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
