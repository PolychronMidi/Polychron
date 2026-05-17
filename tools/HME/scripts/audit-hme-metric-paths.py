#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CODE_EXTS = {".js", ".cjs", ".mjs", ".py", ".sh", ".bash"}
SKIP_PARTS = {".git", "node_modules", "runtime", "KB", "__pycache__"}
SCAN_ROOTS = ["tools/HME/scripts", "tools/HME/service", "tools/HME/proxy", "tools/HME/hooks"]
LEGACY_PATTERNS = [
    re.compile(r"src/output/metrics/(?:hme-|kb-staleness|kb-trust|detector-stats|mode-classifier)"),
    re.compile(r"['\"]src['\"]\s*,\s*['\"]output['\"]\s*,\s*['\"]metrics['\"]\s*,\s*['\"](?:hme-|kb-staleness|kb-trust|detector-stats|mode-classifier)"),
]
ALLOW = {
    "tools/HME/scripts/_common.py",
    "tools/HME/scripts/hme_paths.py",
    "tools/HME/proxy/hme_paths.js",
}


def iter_files() -> list[Path]:
    files: list[Path] = []
    for rel in SCAN_ROOTS:
        base = ROOT / rel
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in CODE_EXTS:
                continue
            if set(path.relative_to(ROOT).parts) & SKIP_PARTS:
                continue
            files.append(path)
    return sorted(files)


def audit() -> list[str]:
    issues: list[str] = []
    for path in iter_files():
        rel = path.relative_to(ROOT).as_posix()
        if rel in ALLOW:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for no, line in enumerate(text.splitlines(), 1):
            if any(pat.search(line) for pat in LEGACY_PATTERNS):
                issues.append(f"{rel}:{no}: legacy HME metric path")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Ban legacy HME metric source paths")
    ap.parse_args()
    issues = audit()
    print(f"hme-metric-paths: {'PASS' if not issues else 'FAIL'} ({len(issues)} issue(s))")
    for issue in issues[:80]:
        print(f"  - {issue}")
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
