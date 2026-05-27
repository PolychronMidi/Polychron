#!/usr/bin/env python3
"""Cross-check `tools/HME/runtime/INVENTORY.md` against the actual filesystem.

Locks the doc-as-contract: every file in `tools/HME/runtime/` must have a row
in INVENTORY.md, and every documented file must have either a writer in
the codebase or a non-zero presence on disk. New state files added to
the runtime tree without inventory rows surface as drift; abandoned
inventory rows for deleted writers also surface.

The inventory table format is the markdown columns:
  | File | Writer | Reader(s) | Lifecycle | Stale-criterion |

`File` cells may use `{a,b,c}` brace-expansion or comma-separated names
to cover multiple files. Lockfile companions (`.lock`) and similar
satellites are accepted whether explicit or not.

Exit codes:
  0 -- no drift
  1 -- inventory drift detected
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_env = os.environ.get("PROJECT_ROOT")
PROJECT_ROOT = Path(_env) if _env else Path(__file__).resolve().parents[3]
RUNTIME_DIR = PROJECT_ROOT / "tools" / "HME" / "runtime"
INVENTORY = RUNTIME_DIR / "INVENTORY.md"
SCAN_ROOTS = [PROJECT_ROOT / "tools" / "HME", PROJECT_ROOT / "scripts"]
SKIP_DIRS = ("__pycache__", "node_modules", ".git", "out", "dist")
EXTS = (".py", ".js", ".sh", ".bash", ".ts")

# Implicit allowed files (lockfiles, watermarks not separately documented).
_IMPLICIT_OK = ("INVENTORY.md",)


def _expand_braces(spec: str) -> list[str]:
    """`autocommit.{counter,last-success,fail,lock}` -> 4 filenames."""
    m = re.match(r"^([^{]*)\{([^}]+)\}(.*)$", spec)
    if not m:
        return [spec]
    prefix, alts, suffix = m.group(1), m.group(2), m.group(3)
    return [prefix + a.strip() + suffix for a in alts.split(",")]


def _parse_inventory_files() -> set[str]:
    """Pull file basenames from the INVENTORY.md table's `File` column."""
    if not INVENTORY.exists():
        print(f"audit-inventory-drift: INVENTORY.md not found at {INVENTORY}", file=sys.stderr)
        return set()
    text = INVENTORY.read_text(encoding="utf-8")
    files: set[str] = set()
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) < 5:
            continue
        first = cols[0]
        # Brace-expand BEFORE comma-splitting so `foo.{a,b,c}` doesn't get
        # broken at the inner commas.
        for tok in re.findall(r"`([^`]+)`", first):
            for expanded in _expand_braces(tok):
                for part in expanded.split(","):
                    p = part.strip()
                    if p:
                        files.add(p)
    return files


def _list_runtime_files() -> set[str]:
    if not RUNTIME_DIR.is_dir():
        return set()
    out: set[str] = set()
    for p in RUNTIME_DIR.iterdir():
        if p.is_file():
            out.add(p.name)
    return out


def _grep_basename(name: str) -> list[str]:
    """Find files in scan roots that mention `name` -- proxy for has-writer."""
    hits = []
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if os.path.splitext(f)[1] not in EXTS:
                    continue
                fp = Path(dp) / f
                try:
                    if name in fp.read_text(encoding="utf-8", errors="ignore"):
                        hits.append(str(fp.relative_to(PROJECT_ROOT)))
                        if len(hits) >= 3:
                            return hits
                except OSError:
                    continue
    return hits


def main() -> int:
    documented = _parse_inventory_files()
    on_disk = _list_runtime_files()

    undocumented = sorted((on_disk - documented) - set(_IMPLICIT_OK))
    abandoned = sorted(documented - on_disk)

    # Filter abandoned: a documented file with a known writer in the code
    # is OK -- the file just hasn't been created yet (not in current run).
    abandoned_real = []
    for f in abandoned:
        if not _grep_basename(f):
            abandoned_real.append(f)

    if not undocumented and not abandoned_real:
        print(f"audit-inventory-drift: PASS ({len(documented)} documented entries, {len(on_disk)} on disk)")
        return 0

    print(f"audit-inventory-drift: FAIL")
    if undocumented:
        print(f"  {len(undocumented)} file(s) on disk but not in INVENTORY.md:")
        for f in undocumented:
            print(f"    + {f}")
    if abandoned_real:
        print(f"  {len(abandoned_real)} INVENTORY.md row(s) without a writer or on-disk file:")
        for f in abandoned_real:
            print(f"    - {f}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
