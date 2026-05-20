#!/usr/bin/env python3
"""Fail if active source uses inline fallback for a key declared in .env.example."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_TEMPLATE = ROOT / "doc" / "templates" / ".env.example"
WAIVER_PATH = ROOT / "tools" / "HME" / "config" / "env-fallback-waivers.json"
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


def _finding_hash(rel: str, key: str, line: str) -> str:
    payload = f"{rel}\0{key}\0{line.strip()}".encode("utf-8", "replace")
    return hashlib.sha256(payload).hexdigest()


def load_waivers() -> dict[str, dict]:
    if not WAIVER_PATH.exists():
        return {}
    data = json.loads(WAIVER_PATH.read_text(encoding="utf-8"))
    rows = data.get("waivers") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise SystemExit(f"invalid waiver manifest at {WAIVER_PATH}: expected object with waivers[]")
    out: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        digest = str(row.get("hash") or "")
        reason = str(row.get("reason") or "").strip()
        if not digest or not reason:
            raise SystemExit(f"invalid waiver in {WAIVER_PATH}: hash and reason required")
        out[digest] = row
    return out


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
                        stripped = line.strip()
                        out.append({
                            "rel": rel,
                            "lineno": lineno,
                            "key": key,
                            "line": stripped,
                            "hash": _finding_hash(rel, key, stripped),
                        })
    return out


def main() -> int:
    rows = findings()
    waivers = load_waivers()
    current_hashes = {row["hash"] for row in rows}
    problems: list[str] = []
    for row in rows:
        if row["hash"] in waivers:
            continue
        problems.append(
            f"{row['rel']}:{row['lineno']}: inline fallback for declared env key {row['key']}: {row['line']}"
        )
    stale = sorted(set(waivers) - current_hashes)
    for digest in stale[:50]:
        row = waivers[digest]
        problems.append(
            f"stale env-fallback waiver {digest}: {row.get('path', '<unknown>')} {row.get('key', '<unknown>')}"
        )
    if len(stale) > 50:
        problems.append(f"... {len(stale) - 50} more stale env-fallback waiver(s)")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"env fail-fast ok: {len(rows)} classified legacy fallback(s), 0 unclassified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
