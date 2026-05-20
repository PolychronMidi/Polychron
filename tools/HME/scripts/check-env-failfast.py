#!/usr/bin/env python3
"""Fail on every inline fallback for keys declared in .env.example."""
from __future__ import annotations

import re
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


def findings() -> list[dict]:
    keys = declared_env_keys()
    out: list[dict] = []
    for path, rel in candidate_files(ROOT):
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            if "env-fallback-ok" in line:
                continue
            for pattern in PATTERNS:
                for match in pattern.finditer(line):
                    key = match.group(1)
                    if key in keys:
                        out.append({
                            "rel": rel,
                            "lineno": lineno,
                            "key": key,
                            "line": line.strip(),
                        })
    return out


def main() -> int:
    rows = findings()
    if rows:
        for row in rows:
            print(
                f"{row['rel']}:{row['lineno']}: inline fallback for declared env key "
                f"{row['key']}: {row['line']}"
            )
        return 1
    print("env fail-fast ok: 0 inline fallbacks for declared keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
