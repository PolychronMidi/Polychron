#!/usr/bin/env python3
"""Writer/reader path-symmetry auditor for shared HME state.

Catches bugs of the shape "writer X writes path A, reader Y reads path B"
where the migration moved one side but not the other. Two real bugs of
this class were caught manually during the runtime/hme/ migration:

  - `_autocommit.sh` wrote `hme-heartbeat-autocommit.ts` while
    `check-heartbeat-freshness.js` read `heartbeat-autocommit.ts`.
  - A retired subagent router wrote one namespace while its status reader
    read another.

Approach: scan non-comment lines for path basenames in `runtime/hme/<name>`
and `tmp/hme-<name>` shapes (handles shell interpolation, Path/path.join
joins, etc.). Classify each line as a write or read by surrounding I/O
keywords (`>`, `tee`, `writeFileSync`, `write_text`, `cat`, `readFileSync`,
`read_text`, etc.). Flag basenames that appear ONLY as writes or ONLY as
reads when a near-miss basename exists in the opposite set.

Limitations: regex-based, won't catch fully dynamic paths. False positives
possible; a `--verbose` flag dumps the full set so the operator can sanity
check. Goal is monotonic improvement -- new drift surfaces, operator resolves.

Exit codes:
  0 -- no asymmetric pairs detected
  1 -- one or more asymmetric pairs flagged
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_env = os.environ.get("PROJECT_ROOT")
PROJECT_ROOT = Path(_env) if _env else Path(__file__).resolve().parent.parent
SCAN_ROOTS = [PROJECT_ROOT / "tools" / "HME", PROJECT_ROOT / "scripts"]
SKIP_DIRS = ("__pycache__", "node_modules", ".git", "out", "dist", "tests")
EXTS = (".py", ".js", ".sh", ".bash", ".ts")

# Match the basename portion. Captured group is normalized: the leading
_PATH_RE = re.compile(
    r"""(?:runtime/hme/|tmp/hme-)([A-Za-z0-9][A-Za-z0-9._\-]*)"""
)
# Bare `hme-FOO.ext` in a string literal -- catches the heartbeat-bug shape
_BARE_HME_RE = re.compile(
    r"""['"]hme-([A-Za-z0-9][A-Za-z0-9._\-]*\.(?:ts|json|sid|txt|env|flag|pid|lock|count|score|err|out|state|heartbeat|watermark))['"]"""
)

# Path.join / pathlib joins: `path.join(X, 'runtime', 'hme', 'foo.sid')`
# or `_PROJECT / 'runtime' / 'hme' / 'foo'`. Match the trailing literal.
_JOIN_RUNTIME_RE = re.compile(
    r"""(?:'runtime'|"runtime")\s*[,)/]\s*(?:'hme'|"hme")\s*[,)/]\s*['"]([A-Za-z0-9][A-Za-z0-9._\-]*)['"]"""
)
_JOIN_TMP_RE = re.compile(
    r"""(?:'tmp'|"tmp")\s*[,)/]\s*['"]hme-([A-Za-z0-9][A-Za-z0-9._\-]*)['"]"""
)

# I/O keyword sets per language. Order: more-specific first.
_WRITE_KW_SHELL = (">>", ">", "tee ", "rm -f ", "rm ")
_READ_KW_SHELL = ("cat ", "head ", "tail ", "< ", "[ -f ", "[ -e ", "[ -s ", "grep ")
_WRITE_KW_PY = (".write_text", ".write(", ", \"w", ", 'w", ", \"a", ", 'a")
_READ_KW_PY = (".read_text", ".read()", ", \"r", ", 'r", ".is_file()", ".exists()")
_WRITE_KW_JS = ("writeFileSync", "appendFileSync", "createWriteStream")
_READ_KW_JS = ("readFileSync", "existsSync", "createReadStream", "statSync")


def _kws(ext: str) -> tuple[tuple, tuple]:
    if ext in (".sh", ".bash"):
        return _WRITE_KW_SHELL, _READ_KW_SHELL
    if ext == ".py":
        return _WRITE_KW_PY, _READ_KW_PY
    if ext in (".js", ".ts"):
        return _WRITE_KW_JS, _READ_KW_JS
    return (), ()


def _is_comment(line: str, ext: str) -> bool:
    s = line.lstrip()
    if not s:
        return False
    if ext in (".py", ".sh", ".bash"):
        return s.startswith("#") and not s.startswith("#!")
    if ext in (".js", ".ts"):
        return s.startswith("//") or s.startswith("*")
    return False


def _extract_basenames(line: str) -> list[str]:
    out = []
    for m in _PATH_RE.finditer(line):
        out.append(m.group(1))
    for m in _JOIN_RUNTIME_RE.finditer(line):
        out.append(m.group(1))
    for m in _JOIN_TMP_RE.finditer(line):
        out.append(m.group(1))
    for m in _BARE_HME_RE.finditer(line):
        out.append(m.group(1))
    return out


def _scan_file(path: Path) -> tuple[set, set]:
    """File-level classification: basenames mentioned in non-comment lines
    are attributed to the file's own I/O kinds (writes anywhere in the file
    AND/OR reads anywhere). Coarse but conservative: false-positives hide
    asymmetries (symmetry overstated), never invent them.
    """
    writes, reads = set(), set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return writes, reads
    ext = path.suffix
    write_kws, read_kws = _kws(ext)
    if not write_kws:
        return writes, reads
    file_has_w = False
    file_has_r = False
    seen: set[str] = set()
    for line in text.splitlines():
        if _is_comment(line, ext):
            continue
        if any(kw in line for kw in write_kws):
            file_has_w = True
        if any(kw in line for kw in read_kws):
            file_has_r = True
        for b in _extract_basenames(line):
            seen.add(b)
    if file_has_w:
        writes.update(seen)
    if file_has_r:
        reads.update(seen)
    return writes, reads


def _walk():
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for dp, dirs, names in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for n in names:
                if os.path.splitext(n)[1] in EXTS:
                    yield Path(dp) / n


def _near_miss(name: str, candidates: set) -> list[str]:
    """A near-miss differs only by the migration's signature axes:
    `hme-` prefix vs no-prefix (the heartbeat bug shape), or `-` vs `.`
    suffix axis (errors-lastread vs errors-lastread.proxy)."""
    out = []
    for c in candidates:
        if c == name:
            continue
        # `hme-` prefix swap.
        if ("hme-" + c) == name or ("hme-" + name) == c:
            out.append(c)
            continue
        # `-` <-> `.` swap on a same-length stem.
        if len(c) == len(name) and c.replace("-", ".") == name.replace("-", "."):
            out.append(c)
    return out


def main() -> int:
    verbose = "--verbose" in sys.argv
    all_writes: dict[str, list[str]] = {}
    all_reads: dict[str, list[str]] = {}
    for f in _walk():
        rel = str(f.relative_to(PROJECT_ROOT))
        w, r = _scan_file(f)
        for p in w:
            all_writes.setdefault(p, []).append(rel)
        for p in r:
            all_reads.setdefault(p, []).append(rel)

    write_set = set(all_writes)
    read_set = set(all_reads)

    if verbose:
        print(f"writes ({len(write_set)}): {sorted(write_set)}")
        print(f"reads  ({len(read_set)}): {sorted(read_set)}")

    findings = []
    for w in sorted(write_set - read_set):
        nm = _near_miss(w, read_set)
        if nm:
            findings.append(("WRITE-NO-READ", w, all_writes[w], nm))
    for r in sorted(read_set - write_set):
        nm = _near_miss(r, write_set)
        if nm:
            findings.append(("READ-NO-WRITE", r, all_reads[r], nm))

    if not findings:
        print(f"audit-state-file-symmetry: PASS ({len(write_set)} writes, {len(read_set)} reads, no asymmetric pairs)")
        return 0
    print(f"audit-state-file-symmetry: FAIL ({len(findings)} asymmetric pair(s))")
    for kind, p, sources, candidates in findings:
        print(f"  {kind}: {p}")
        print(f"    sources: {sources[:3]}{' ...' if len(sources) > 3 else ''}")
        print(f"    near-miss in opposite set: {candidates}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
