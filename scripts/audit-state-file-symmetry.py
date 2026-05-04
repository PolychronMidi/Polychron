#!/usr/bin/env python3
"""Writer/reader path-symmetry auditor for shared HME state.

Catches bugs of the shape "writer X writes path A, reader Y reads path B"
where the migration moved one side but not the other. Two real bugs of
this class were caught manually during the runtime/hme/ migration:

  - `_autocommit.sh` wrote `hme-heartbeat-autocommit.ts` while
    `check-heartbeat-freshness.js` read `heartbeat-autocommit.ts`.
  - `buddy_spawn.py` wrote `tmp/hme-buddy-primary.{floor,effort_floor}`
    while `buddy_init.sh` read `runtime/hme/buddy-primary.{floor,...}`.

Heuristic: regex-extract `runtime/hme/` and `tmp/hme-` paths from writes
and reads, normalize, then flag any path with writers-but-no-readers (or
vice versa) where a near-miss path exists in the opposite set.

Limitations: regex-based, won't catch fully dynamic paths. False positives
possible. The goal is monotonic improvement -- new drift surfaces, the
operator resolves.

Exit codes:
  0 -- no asymmetric pairs detected
  1 -- one or more asymmetric pairs flagged
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


# Resolve PROJECT_ROOT from env or script location (scripts/ sits at repo root).
_env = os.environ.get("PROJECT_ROOT")
if _env:
    PROJECT_ROOT = Path(_env)
else:
    PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts",
]
SKIP_DIRS = ("__pycache__", "node_modules", ".git", "out", "dist", "tests")
EXTS = (".py", ".js", ".sh", ".bash", ".ts")

# Write-shape regexes per file extension. Each captures the path token
# immediately AFTER the write directive.
_WRITE_PATTERNS_SHELL = [
    re.compile(r"""(?:>>?|tee)\s+['"]?((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]?"""),
]
_READ_PATTERNS_SHELL = [
    re.compile(r"""(?:cat|head|tail)\s+['"]?((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]?"""),
    re.compile(r"""<\s*['"]?((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]?"""),
    re.compile(r"""\[\s+-[fes]\s+['"]?((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]?"""),
]
_WRITE_PATTERNS_PY = [
    re.compile(r"""open\(\s*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]\s*,\s*['"][wa]"""),
]
_READ_PATTERNS_PY = [
    re.compile(r"""open\(\s*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]\s*\)"""),
    re.compile(r"""open\(\s*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]\s*,\s*['"]r"""),
]
_WRITE_PATTERNS_JS = [
    re.compile(r"""fs\.writeFileSync\(\s*[^,]*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]"""),
    re.compile(r"""fs\.appendFileSync\(\s*[^,]*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]"""),
]
_READ_PATTERNS_JS = [
    re.compile(r"""fs\.readFileSync\(\s*[^,]*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]"""),
    re.compile(r"""fs\.existsSync\(\s*[^)]*['"]((?:runtime/hme|tmp)/[A-Za-z0-9._\-/]+)['"]"""),
]


def _ext_patterns(ext: str):
    if ext in (".sh", ".bash"):
        return _WRITE_PATTERNS_SHELL, _READ_PATTERNS_SHELL
    if ext == ".py":
        return _WRITE_PATTERNS_PY, _READ_PATTERNS_PY
    if ext in (".js", ".ts"):
        return _WRITE_PATTERNS_JS, _READ_PATTERNS_JS
    return [], []


def _scan_file(path: Path) -> tuple[set, set]:
    """Return (writes, reads) sets of normalized path strings."""
    writes, reads = set(), set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return writes, reads
    write_pats, read_pats = _ext_patterns(path.suffix)
    for line in text.splitlines():
        s = line.strip()
        # Skip comment lines to suppress false positives from prose.
        if s.startswith("#") or s.startswith("//") or s.startswith("*"):
            continue
        for pat in write_pats:
            for m in pat.finditer(line):
                if m.group(1):
                    writes.add(m.group(1))
        for pat in read_pats:
            for m in pat.finditer(line):
                if m.group(1):
                    reads.add(m.group(1))
    return writes, reads


def _walk():
    files = []
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for dp, dirs, names in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for n in names:
                ext = os.path.splitext(n)[1]
                if ext not in EXTS:
                    continue
                files.append(Path(dp) / n)
    return files


def _basename_eq(a: str, b: str) -> bool:
    """Same basename, different dir/prefix -- the bug shape we hunt."""
    return os.path.basename(a) == os.path.basename(b)


def _stem_close(a: str, b: str) -> bool:
    """Stems differ by `hme-` prefix or `tmp/` vs `runtime/hme/` axis."""
    sa, sb = os.path.basename(a), os.path.basename(b)
    if sa.startswith("hme-") and sa[4:] == sb: return True
    if sb.startswith("hme-") and sb[4:] == sa: return True
    return False


def main() -> int:
    all_writes: dict[str, list[str]] = {}
    all_reads: dict[str, list[str]] = {}
    for f in _walk():
        rel = str(f.relative_to(PROJECT_ROOT))
        w, r = _scan_file(f)
        for p in w:
            all_writes.setdefault(p, []).append(rel)
        for p in r:
            all_reads.setdefault(p, []).append(rel)

    write_paths = set(all_writes.keys())
    read_paths = set(all_reads.keys())

    findings = []
    for w in sorted(write_paths - read_paths):
        candidates = [r for r in read_paths if _basename_eq(w, r) or _stem_close(w, r)]
        if candidates:
            findings.append(("WRITE-NO-READ", w, all_writes[w], candidates))
    for r in sorted(read_paths - write_paths):
        candidates = [w for w in write_paths if _basename_eq(r, w) or _stem_close(r, w)]
        if candidates:
            findings.append(("READ-NO-WRITE", r, all_reads[r], candidates))

    if not findings:
        print(f"audit-state-file-symmetry: PASS ({len(write_paths)} writes, {len(read_paths)} reads, no asymmetric pairs)")
        return 0
    print(f"audit-state-file-symmetry: FAIL ({len(findings)} asymmetric pair(s))")
    for kind, p, sources, candidates in findings:
        print(f"  {kind}: {p}")
        print(f"    sources: {sources[:3]}{' ...' if len(sources) > 3 else ''}")
        print(f"    near-miss: {candidates[:3]}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
