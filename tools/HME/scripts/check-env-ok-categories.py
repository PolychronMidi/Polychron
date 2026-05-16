#!/usr/bin/env python3
"""Require every env-ok waiver to carry an auditable reason category."""
from __future__ import annotations

import sys
from pathlib import Path

CATEGORIES = (
    "subprocess",
    "runtime/test",
    "sandbox/root",
    "feature flag",
    "bootstrap",
    "scoped",
    "set by _safety.sh",
    "torch runtime",
    "interactive",
    "dashboard auth",
    "service port",
)

SKIP_PARTS = {"__pycache__"}


def _scan(root: Path) -> list[str]:
    findings: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in {".py", ".sh", ".js"}:
            continue
        if SKIP_PARTS & set(path.parts):
            continue
        rel = path.as_posix()
        if rel.endswith("check-env-ok-categories.py"):
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if "env-ok" not in line:
                continue
            reason = line.split("env-ok", 1)[1].lower()
            if not any(cat in reason for cat in CATEGORIES):
                findings.append(f"{rel}:{lineno}: env-ok lacks category: {line.strip()}")
    return findings


def main() -> int:
    roots = [Path(arg) for arg in sys.argv[1:]] or [Path("tools/HME")]
    findings: list[str] = []
    for root in roots:
        findings.extend(_scan(root))
    if findings:
        print("\n".join(findings))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
