#!/usr/bin/env python3
"""Fail on newly introduced inline fallbacks for keys declared in .env.example.

Existing legacy fallbacks are grandfathered by comparing the working tree to
HEAD. This keeps pre-commit strict without a giant waiver manifest.
"""
from __future__ import annotations

from collections import Counter
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_TEMPLATE = ROOT / "doc" / "templates" / ".env.example"
EXTS = {".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash"}
SKIP_DIRS = {".git", "node_modules", "runtime", "tmp", "log", ".pytest_cache", "__pycache__"}
SKIP_PREFIXES = (
    "src/output/",
    "tools/HME/KB/",
    "tools/HME/session-state.json",
)
PATTERNS = [
    re.compile(r"process\.env\.([A-Z0-9_]+)\s*(?:\|\||\?\?)"),
    re.compile(r"process\.env\[['\"]([A-Z0-9_]+)['\"]\]\s*(?:\|\||\?\?)"),
    re.compile(r"os\.environ\.get\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\bgetenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\$\{([A-Z0-9_]+)(?::-|-)"),
]


def declared_env_keys() -> set[str]:
    keys: set[str] = set()
    for raw in ENV_TEMPLATE.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key:
            keys.add(key)
    return keys


def candidate_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in EXTS:
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith(SKIP_PREFIXES):
            continue
        if SKIP_DIRS & set(Path(rel).parts):
            continue
        yield path, rel


def _head_text(rel: str) -> str:
    try:
        out = subprocess.run(
            ["git", "show", f"HEAD:{rel}"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return ""
    return out.stdout if out.returncode == 0 else ""


def _scan_text(rel: str, text: str, keys: set[str]) -> list[dict]:
    out: list[dict] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if "env-fallback-ok" in line:
            continue
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                key = match.group(1)
                if key in keys:
                    stripped = line.strip()
                    out.append({
                        "rel": rel,
                        "lineno": lineno,
                        "key": key,
                        "line": stripped,
                    })
    return out


def findings() -> list[dict]:
    keys = declared_env_keys()
    out: list[dict] = []
    for path, rel in candidate_files(ROOT):
        out.extend(_scan_text(rel, path.read_text(encoding="utf-8", errors="replace"), keys))
    return out


def baseline_findings() -> list[dict]:
    keys = declared_env_keys()
    out: list[dict] = []
    for _path, rel in candidate_files(ROOT):
        out.extend(_scan_text(rel, _head_text(rel), keys))
    return out


def _signature(row: dict) -> tuple[str, str, str]:
    return (str(row["rel"]), str(row["key"]), str(row["line"]))


def main() -> int:
    rows = findings()
    baseline = Counter(_signature(row) for row in baseline_findings())
    seen: Counter[tuple[str, str, str]] = Counter()
    problems: list[str] = []
    for row in rows:
        sig = _signature(row)
        seen[sig] += 1
        if seen[sig] <= baseline.get(sig, 0):
            continue
        problems.append(
            f"{row['rel']}:{row['lineno']}: new inline fallback for declared env key {row['key']}: {row['line']}"
        )
    if problems:
        print("\n".join(problems))
        return 1
    print(f"env fail-fast ok: {len(rows)} legacy fallback(s) grandfathered from HEAD, 0 new")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
