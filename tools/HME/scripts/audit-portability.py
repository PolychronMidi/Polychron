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
STRING_IMPORT_RE = re.compile(
    r"(?:require\s*\(\s*|import\s*\(\s*|"
    r"import\s+[^;\n]*?\s+from\s+|import\s+)"
    r"['\"]([^'\"]+)['\"]"
)
PY_FROM_RE = re.compile(r"^\s*from\s+([.\w]+)\s+import\s+", re.M)
PY_IMPORT_RE = re.compile(r"^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)", re.M)


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


def import_specs(text: str) -> list[str]:
    specs = [m.group(1) for m in STRING_IMPORT_RE.finditer(text)]
    specs.extend(m.group(1) for m in PY_FROM_RE.finditer(text))
    specs.extend(m.group(1) for m in PY_IMPORT_RE.finditer(text))
    return specs


def spec_as_repo_path(spec: str) -> Path:
    return Path(spec.lstrip(".").replace(".", "/"))


def spec_points_under(root: Path, file_path: Path, spec: str, bases: list[Path]) -> bool:
    candidates = []
    if spec.startswith(".") or spec.startswith("/"):
        candidates.append((file_path.parent / spec).resolve())
    else:
        candidates.append((root / spec).resolve())
        candidates.append((root / spec_as_repo_path(spec)).resolve())
    for candidate in candidates:
        for base in bases:
            try:
                candidate.relative_to(base.resolve())
                return True
            except ValueError:
                continue
    return False


def imports_under(root: Path, file_path: Path, text: str, bases: list[Path]) -> bool:
    return any(
        spec_points_under(root, file_path, spec, bases)
        for spec in import_specs(text)
    )


def audit(root: Path) -> tuple[bool, list[str]]:
    cfg = load_adapter(root)
    issues: list[str] = []
    for doc in project_docs(root, cfg):
        if not doc.is_file():
            issues.append(f"missing project doc: {rel(root, doc)}")
    hme_root = root / "tools" / "HME"
    src_roots = source_roots(root, cfg)
    for path in iter_files(root, hme_root):
        r = rel(root, path)
        if any(part in HME_ALLOW_PARTS for part in path.relative_to(hme_root).parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if imports_under(root, path, text, src_roots):
            issues.append(f"HME core imports project source: {r}")
    for src_root in src_roots:
        for path in iter_files(root, src_root):
            text = path.read_text(encoding="utf-8", errors="ignore")
            if imports_under(root, path, text, [hme_root]):
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
