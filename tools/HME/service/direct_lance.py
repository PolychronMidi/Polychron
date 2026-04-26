"""Direct-lance fallback for KB queries.

Architectural intent (Lesson #1, completing the worker-process-dead
survivability path): when both the worker's HTTP endpoint AND the
filesystem queue are unreachable, read-only KB queries fall back to
this module which opens lance shards directly via lancedb. No daemon
dependency at all.

Coverage in this first cut: read-only tools only.
    list_knowledge        → scan KB/knowledge.lance, return recent rows
    knowledge_count       → row count by category
    knowledge_lookup_id   → fetch one row by knowledge_id

Tools that mutate state (learn, compact_knowledge, remove_knowledge) or
require the LLM (search_knowledge with embeddings, review, evolve) keep
requiring the worker — cold-loading embeddings + RAG models per CLI
invocation would defeat the point. Best to surface a clear error.

Usage:
    from direct_lance import list_knowledge, knowledge_count
    rows = list_knowledge(limit=20, category='decision')

CLI:
    python3 tools/HME/mcp/direct_lance.py list --limit 5
    python3 tools/HME/mcp/direct_lance.py count
    python3 tools/HME/mcp/direct_lance.py lookup <knowledge_id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
KB_DIR = PROJECT_ROOT / "tools" / "HME" / "KB"
KNOWLEDGE_LANCE = KB_DIR / "knowledge.lance"


def _open_table():
    """Open the knowledge lance table. Returns None if lancedb is unavailable
    or the shard doesn't exist (caller should surface a clear error)."""
    if not KNOWLEDGE_LANCE.exists():
        return None
    try:
        import lancedb  # type: ignore
    except ImportError:
        return None
    try:
        db = lancedb.connect(str(KB_DIR))
        # The table is the lance dir's stem.
        return db.open_table("knowledge")
    except Exception:
        return None


def list_knowledge(limit: int = 20, category: str | None = None) -> list[dict[str, Any]]:
    """List recent KB rows. Read-only. Falls back gracefully when lance
    isn't accessible (returns empty list rather than throwing — caller
    decides degradation)."""
    table = _open_table()
    if table is None:
        return []
    try:
        # Lance tables expose a .to_pandas() / .to_arrow() but for a
        # daemon-less CLI we want minimal allocation. .search() with no
        # query returns rows in insertion order; .limit() bounds it.
        q = table.search() if hasattr(table, "search") else None
        if q is None:
            df = table.to_pandas()
        else:
            df = q.limit(limit).to_pandas()
        if category and "category" in df.columns:
            df = df[df["category"] == category]
        # Trim to bounded set of columns to avoid blob-y output.
        keep = [c for c in ("knowledge_id", "title", "category", "tags", "created_at", "ts") if c in df.columns]
        if keep:
            df = df[keep]
        return df.head(limit).to_dict(orient="records")
    except Exception:
        return []


def knowledge_count() -> dict[str, int]:
    """Count rows by category. Returns empty dict on failure."""
    table = _open_table()
    if table is None:
        return {}
    try:
        df = table.to_pandas()
        if "category" not in df.columns:
            return {"_total": int(len(df))}
        counts = df["category"].value_counts().to_dict()
        counts["_total"] = int(len(df))
        return {k: int(v) for k, v in counts.items()}
    except Exception:
        return {}


def knowledge_lookup_id(knowledge_id: str) -> dict[str, Any] | None:
    """Fetch one row by knowledge_id. Returns None if not found."""
    table = _open_table()
    if table is None:
        return None
    try:
        df = table.to_pandas()
        if "knowledge_id" not in df.columns:
            return None
        match = df[df["knowledge_id"] == knowledge_id]
        if len(match) == 0:
            return None
        row = match.iloc[0].to_dict()
        # Best-effort serialization of any non-JSON-native fields.
        for k, v in list(row.items()):
            try:
                json.dumps(v)
            except (TypeError, ValueError):
                row[k] = str(v)
        return row
    except Exception:
        return None


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Direct-lance KB fallback (read-only)")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List recent KB rows")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--category", default=None)

    sub.add_parser("count", help="Row counts by category")

    p_lookup = sub.add_parser("lookup", help="Fetch one row by knowledge_id")
    p_lookup.add_argument("knowledge_id")

    args = p.parse_args(argv)

    if args.cmd == "list":
        out = list_knowledge(limit=args.limit, category=args.category)
        print(json.dumps(out, indent=2, default=str))
        return 0
    if args.cmd == "count":
        out = knowledge_count()
        print(json.dumps(out, indent=2))
        return 0
    if args.cmd == "lookup":
        out = knowledge_lookup_id(args.knowledge_id)
        if out is None:
            print(f"not found: {args.knowledge_id}", file=sys.stderr)
            return 1
        print(json.dumps(out, indent=2, default=str))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
