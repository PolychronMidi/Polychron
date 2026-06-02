#!/usr/bin/env python3
"""Central env fail-fast invariants and env-template authority."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SELF_REL = Path(__file__).resolve().relative_to(ROOT).as_posix()
ENV_TEMPLATE_REL = "doc/templates/.env.example"
ENV_TEMPLATE = ROOT / ENV_TEMPLATE_REL
ROOT_ENV = ROOT / ".env"
ROOT_ENV_EXAMPLE = ROOT / ".env.example"
EXTS = {".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash"}
SKIP_DIRS = {".git", "node_modules", "runtime", "tmp", "log", ".pytest_cache", "__pycache__"}
SKIP_PREFIXES = (
    "src/output/",
    "tools/HME/KB/",
    "tools/HME/session-state.json",
)
AUTHORITY_RE = re.compile(r"doc/templates/\.env\.example|\.env\.example|example\.env")
PATTERNS = [
    re.compile(r"process\.env\.([A-Z0-9_]+)\s*(?:\|\||\?\?)"),
    re.compile(r"process\.env\s*\[\s*['\"]([A-Z0-9_]+)['\"]\s*\]\s*(?:\|\||\?\?)"),
    re.compile(r"os\.environ\.get\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\bgetenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\$\{([A-Z0-9_]+)(?::-|-)"),
]
ENV_INDEX_RE = re.compile(r"os\.environ\[\s*['\"]([A-Z0-9_]+)['\"]\s*\]")
ENV_EXCEPT_RE = re.compile(r"^\s*except\s+(?:\(?\s*)?(KeyError|LookupError|Exception|BaseException)\b")
ENV_LITERAL_FALLBACK_RE = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*=|return)\s*"
    r"(?:['\"].*['\"]|None|False|True|\d+|\{\}|\[\])\s*(?:#.*)?$"
)
ENV_KEY_RE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
_AUTHORITY_NEEDLES = [m.encode("utf-8") for m in ("doc/templates/.env.example", ".env.example", "example.env")]
_AUTHORITY_TAIL = max(len(x) for x in _AUTHORITY_NEEDLES) - 1


def tracked_files(root: Path = ROOT) -> list[str]:
    raw = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"])
    return [p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


# Keys consumed outside tracked Python/JS/shell source: native runtime libraries
# (OpenMP/torch read OMP_* at C level) or vendored external services (omniroute
DEAD_ENV_ALLOWLIST = {
    "OMP_NUM_THREADS",
    "CALL_LOG_PIPELINE_CAPTURE_STREAM_CHUNKS",
    "CALL_LOG_PIPELINE_MAX_SIZE_KB",
}
# env-name fragments built by f-string / template-literal interpolation, e.g.
# f"{provider}_DAILY_LIMIT_{label}". A declared key containing one of these is
_DYN_NAME_RE = re.compile(r"""(?:f["']|`)[^"'`\n]*\{[^}]+\}[^"'`\n]*["'`]""")
# A dynamic-family fragment must be a COMPOUND token (>=2 underscore-joined
# words, length >= 6) -- e.g. DAILY_LIMIT, RPM_LIMIT, MODEL_T. Generic single
_DYN_SEG_RE = re.compile(r"[A-Z0-9]+(?:_[A-Z0-9]+)+")


def dynamic_name_fragments(files: list[str]) -> set[str]:
    frags: set[str] = set()
    for path, _rel in candidate_files(files):
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in _DYN_NAME_RE.finditer(text):
            literal = re.sub(r"\{[^}]+\}", "\x00", m.group(0))
            for seg in _DYN_SEG_RE.findall(literal):
                if len(seg) >= 6:
                    frags.add(seg)
    return frags


def intra_env_referenced(env_path: Path) -> set[str]:
    refs: set[str] = set()
    if not env_path.is_file():
        return refs
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        for m in re.finditer(r"\$\{?([A-Z_][A-Z0-9_]*)\}?", line):
            refs.add(m.group(1))
    return refs


def above_marker_keys(env_path: Path) -> set[str]:
    keys: set[str] = set()
    if not env_path.is_file():
        return keys
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if MARKER in line:
            break
        m = ENV_KEY_RE.match(line.strip())
        if m:
            keys.add(m.group(1))
    return keys


MARKER = "SECRETS ABOVE THIS LINE"


def dead_env_key_rows(files: list[str]) -> list[str]:
    declared = parse_env_keys(ENV_TEMPLATE) if ENV_TEMPLATE.is_file() else set()
    if not declared:
        return []
    code = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path, _rel in candidate_files(files)
    )
    dyn_frags = dynamic_name_fragments(files)
    intra = intra_env_referenced(ENV_TEMPLATE) | intra_env_referenced(ROOT_ENV)
    by_value = above_marker_keys(ROOT_ENV)
    dead: list[str] = []
    for key in sorted(declared):
        if key in DEAD_ENV_ALLOWLIST or key in intra or key in by_value:
            continue
        if re.search(r"(?<![A-Za-z0-9_])" + re.escape(key) + r"(?![A-Za-z0-9_])", code):
            continue
        if any(frag in key for frag in dyn_frags):
            continue
        dead.append(key)
    return dead


def parse_env_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = ENV_KEY_RE.match(line)
        if match:
            keys.add(match.group(1))
    return keys


def declared_env_keys(root: Path = ROOT) -> set[str]:
    return parse_env_keys(root / ENV_TEMPLATE_REL)


def _contains_authority_reference(path: Path) -> bool:
    tail = b""
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            data = tail + chunk
            if any(needle in data for needle in _AUTHORITY_NEEDLES):
                return True
            tail = data[-_AUTHORITY_TAIL:] if _AUTHORITY_TAIL else b""
    return False


def authority_reference_rows(files: list[str]) -> list[dict]:
    rows: list[dict] = []
    for rel in files:
        if rel == SELF_REL or rel == ENV_TEMPLATE_REL:
            continue
        path = ROOT / rel
        if not path.is_file() or not _contains_authority_reference(path):
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for match in AUTHORITY_RE.finditer(line):
                rows.append({"rel": rel, "lineno": lineno, "ref": match.group(0)})
    return rows


def env_contract_rows() -> list[str]:
    rows: list[str] = []
    if not ROOT_ENV.is_file():
        rows.append("missing required root .env")
    if ROOT_ENV_EXAMPLE.exists():
        rows.append("root .env.example must not exist")
    if not ENV_TEMPLATE.is_file():
        rows.append(f"env template missing at {ENV_TEMPLATE_REL}")
    if rows or not ROOT_ENV.is_file() or not ENV_TEMPLATE.is_file():
        return rows
    declared = parse_env_keys(ENV_TEMPLATE)
    actual = parse_env_keys(ROOT_ENV)
    missing = sorted(declared - actual)
    if missing:
        head = ", ".join(missing[:40])
        tail = f" ... {len(missing) - 40} more" if len(missing) > 40 else ""
        rows.append(f"root .env missing declared key(s): {head}{tail}")
    return rows


def candidate_files(files: list[str]):
    for rel in files:
        path = ROOT / rel
        if not path.is_file() or path.suffix.lower() not in EXTS:
            continue
        if rel.startswith(SKIP_PREFIXES):
            continue
        if SKIP_DIRS & set(Path(rel).parts):
            continue
        yield path, rel


def _try_except_fallback_rows(rel: str, lines: list[str], keys: set[str]) -> list[dict]:
    out: list[dict] = []
    for idx, line in enumerate(lines):
        if line.strip() != "try:":
            continue
        env_keys: set[str] = set()
        except_idx: int | None = None
        for j in range(idx + 1, min(len(lines), idx + 16)):
            probe = lines[j]
            for match in ENV_INDEX_RE.finditer(probe):
                key = match.group(1)
                if key in keys:
                    env_keys.add(key)
            if ENV_EXCEPT_RE.match(probe):
                except_idx = j
                break
        if not env_keys or except_idx is None:
            continue
        handler = lines[except_idx + 1:min(len(lines), except_idx + 9)]
        if not any(ENV_LITERAL_FALLBACK_RE.match(h) for h in handler):
            continue
        for key in sorted(env_keys):
            out.append({"rel": rel, "lineno": idx + 1, "key": key, "line": "try/except fallback around os.environ[...]"})
    return out


def inline_fallback_rows(files: list[str], keys: set[str]) -> list[dict]:
    out: list[dict] = []
    for path, rel in candidate_files(files):
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        for lineno, line in enumerate(lines, 1):
            for pattern in PATTERNS:
                for match in pattern.finditer(line):
                    key = match.group(1)
                    if key in keys:
                        out.append({"rel": rel, "lineno": lineno, "key": key, "line": line.strip()})
        out.extend(_try_except_fallback_rows(rel, lines, keys))
    return out


def findings() -> tuple[list[dict], list[str], list[dict], list[str]]:
    files = tracked_files()
    authority_rows = authority_reference_rows(files)
    env_rows = env_contract_rows()
    keys = parse_env_keys(ENV_TEMPLATE) if ENV_TEMPLATE.is_file() else set()
    return authority_rows, env_rows, inline_fallback_rows(files, keys), dead_env_key_rows(files)


def main() -> int:
    authority_rows, env_rows, fallback_rows, dead_rows = findings()
    failed = False
    for key in dead_rows:
        failed = True
        print(
            f"env contract failed: declared key {key} has no consumer "
            f"(remove from {ENV_TEMPLATE_REL} + root .env, or add to DEAD_ENV_ALLOWLIST "
            f"in {SELF_REL} if consumed by a native/external/dynamic path)"
        )
    for row in authority_rows:
        failed = True
        print(
            f"{row['rel']}:{row['lineno']}: env-template reference {row['ref']!r} "
            f"is only allowed in {SELF_REL}"
        )
    for row in env_rows:
        failed = True
        print(f"env contract failed: {row}")
    for row in fallback_rows:
        failed = True
        print(
            f"{row['rel']}:{row['lineno']}: inline fallback for declared env key "
            f"{row['key']}: {row['line']}"
        )
    if failed:
        return 1
    print("env fail-fast ok: central references clean; root .env complete; 0 inline fallbacks; 0 dead keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
