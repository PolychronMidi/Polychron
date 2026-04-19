#!/usr/bin/env python3
"""Compact LanceDB tables in tools/HME/KB/ to purge accumulated deletion files.

LanceDB writes an arrow file to _deletions/ for every row deleted via .delete().
These accumulate quickly when the indexer re-processes changed files (delete old
chunks, add new ones). At 400+ files the directory is pure dead weight and slows
down table opens.

Compaction strategy: `table.optimize()` rewrites data files and drops
_deletions/ entries without changing row contents or embeddings. Safe to run
with the worker running — LanceDB's MVCC makes compaction atomic.
(Older LanceDB versions used `compact_files()` — we fall back if `optimize`
isn't present so this script works across a version bump.)

Usage:
  python3 scripts/compact-lance-tables.py [--dry-run]

Exit 0 on success or if no compaction needed. Exit 1 on error.
Writes a one-line summary to stdout (for pipeline/hook consumption).
"""
from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
KB_DIR = PROJECT_ROOT / "tools" / "HME" / "KB"

TABLES = ["code_chunks", "knowledge", "symbols"]
DELETIONS_CAP = 50  # invariant threshold — compaction recommended above this


def _deletion_count(table_path: Path) -> int:
    d = table_path / "_deletions"
    if not d.is_dir():
        return 0
    return sum(1 for f in d.iterdir() if f.is_file())


def main() -> None:
    ap = argparse.ArgumentParser(description="Compact LanceDB tables")
    ap.add_argument("--dry-run", action="store_true", help="Report counts, don't compact")
    args = ap.parse_args()

    try:
        import lancedb  # type: ignore
    except ImportError:
        print("compact-lance-tables: lancedb not installed — skipping", flush=True)
        sys.exit(0)

    db_path = str(KB_DIR)
    if not KB_DIR.is_dir():
        print(f"compact-lance-tables: KB dir missing ({KB_DIR}) — skipping", flush=True)
        sys.exit(0)

    db = lancedb.connect(db_path)
    compacted = []
    skipped = []
    errors = []

    for name in TABLES:
        table_path = KB_DIR / f"{name}.lance"
        if not table_path.is_dir():
            skipped.append(f"{name} (missing)")
            continue

        count = _deletion_count(table_path)
        if args.dry_run:
            tag = f"{'NEEDS COMPACTION' if count > DELETIONS_CAP else 'ok'} ({count} deletions)"
            print(f"  {name}.lance: {tag}")
            continue

        if count == 0:
            skipped.append(f"{name} (0 deletions)")
            continue

        try:
            tbl = db.open_table(name)
            # LanceDB 0.21+ unifies compact_files + cleanup_old_versions into
            # optimize() — rewrites data files AND purges the _deletions/
            # arrow files that trigger this invariant warning. Optimize
            # requires the `pylance` package; without it LanceDB raises a
            # clear error that we surface as an actionable install hint.
            if hasattr(tbl, "optimize"):
                try:
                    tbl.optimize()
                except ImportError as _imp_err:
                    errors.append(
                        f"{name}: optimize() needs `pylance` installed "
                        f"(pip install --user pylance). Underlying: {_imp_err}"
                    )
                    continue
            elif hasattr(tbl, "compact_files"):
                tbl.compact_files()
            after = _deletion_count(table_path)
            compacted.append(f"{name} ({count}→{after} deletions)")
        except Exception as e:
            errors.append(f"{name}: {e}")

    if args.dry_run:
        sys.exit(0)

    parts = []
    if compacted:
        parts.append(f"compacted: {', '.join(compacted)}")
    if skipped:
        parts.append(f"skipped: {', '.join(skipped)}")
    if errors:
        parts.append(f"errors: {', '.join(errors)}")

    summary = "; ".join(parts) if parts else "nothing to compact"
    print(f"compact-lance-tables: {summary}", flush=True)

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
