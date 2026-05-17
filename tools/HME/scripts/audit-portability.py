#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

THIS = Path(__file__).resolve()
REPO_ROOT = THIS.parents[3]
sys.path.insert(0, str(THIS.parent))
from project_adapter import load_adapter, source_roots, project_docs  # noqa: E402

CODE_EXTS = {".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash"}
SKIP_PARTS = {"node_modules", "__pycache__", ".git", "runtime", "KB"}
HME_ALLOW_PARTS = {"adapters", "tests"}
SRC_IMPORT_RE = re.compile(r"(?:require\(|from\s+|import\s+).*['\"](?:\.\./)*src[/'\"]")
HME_IMPORT_RE = re.compile(
    r"(?:require\s*\(|import\s+.*from\s+|from\s+)[\"'][^\"']*tools[\\/]HME|"
    r"from\s+tools\.HME"
)


def iter_files(root: Path, base: Path):
    if not base.exists():
        return
    for path in base.rglob("*"):
        if not path.is_file() or path.suffix not in CODE_EXTS:
            continue
        rel_parts = set(path.relative_to(root).parts)
        if rel_parts & SKIP_PARTS:
            continue
        yield path


def rel(root: Path, path: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def audit(root: Path) -> tuple[bool, list[str]]:
    cfg = load_adapter(root)
    issues: list[str] = []
    for doc in project_docs(root, cfg):
        if not doc.is_file():
            issues.append(f"missing project doc: {rel(root, doc)}")
    hme_root = root / "tools" / "HME"
    for path in iter_files(root, hme_root):
        r = rel(root, path)
        if any(part in HME_ALLOW_PARTS for part in path.relative_to(hme_root).parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if SRC_IMPORT_RE.search(text):
            issues.append(f"HME core imports project source: {r}")
    for src_root in source_roots(root, cfg):
        for path in iter_files(root, src_root):
            text = path.read_text(encoding="utf-8", errors="ignore")
            if HME_IMPORT_RE.search(text):
                issues.append(f"project source imports HME internals: {rel(root, path)}")
    hme_metrics = root / "tools" / "HME" / "runtime" / "metrics"
    if str(hme_metrics).startswith(str(root / "src")):
        issues.append("HME metrics dir must not live under src/")
    return not issues, issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit HME/project portability boundaries")
    ap.add_argument("--root", default=str(REPO_ROOT))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    ok, issues = audit(root)
    if args.json:
        import json
        print(json.dumps({"ok": ok, "issues": issues}, indent=2))
    else:
        print(f"portable-boundary: {'PASS' if ok else 'FAIL'} ({len(issues)} issue(s))")
        for issue in issues[:40]:
            print(f"  - {issue}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
