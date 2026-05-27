#!/usr/bin/env python3
"""Sync OpenCode todowrite tool calls into the canonical HME TODO store.

OpenCode emits `todowrite` tool calls with the same shape as Claude's native
TodoWrite (a list of {content, status, priority} items) but persists them in
its own SQLite database (~/.local/share/opencode/opencode.db). Without this
bridge, opencode-side todos never converge into TODO.md.

Runs periodically via universal_pulse_tick (parallel to codex_plan_sync). Each
sync grabs the latest `todowrite` call per active session since the last
synced timestamp (stored in the TODO.md ledger as `opencode_todo_synced_ts`)
and ingests new items directly with source="opencode", dedup'd by text.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[3]
)
os.environ.setdefault("PROJECT_ROOT", str(PROJECT_ROOT))
SERVICE_ROOT = PROJECT_ROOT / "tools" / "HME" / "service"
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from server.tools_analysis.todo_store import (  # noqa: E402
    flat_entries, load_store, mutate_store, save_todos,
)

STATUS_MAP = {
    "pending": "pending",
    "in_progress": "in_progress",
    "completed": "completed",
}


def _opencode_db_path() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "opencode" / "opencode.db"


def latest_todowrite_per_session(db_path: Path, since_ms: int = 0) -> list[tuple[str, int, dict]]:
    """Return [(session_id, time_created_ms, data_dict)] for each session's
    most recent `todowrite` tool call whose time_created > since_ms.
    """
    if not db_path.is_file():
        return []
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return []
    rows: list[tuple[str, int, dict]] = []
    try:
        cur = conn.execute(
            """
            SELECT session_id, time_created, data FROM (
                SELECT session_id, time_created, data,
                       ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) AS rn
                FROM part
                WHERE json_extract(data, '$.type') = 'tool'
                  AND json_extract(data, '$.tool') = 'todowrite'
                  AND time_created > ?
            ) WHERE rn = 1
            ORDER BY time_created
            """,
            (int(since_ms),),
        )
        for session_id, time_created, data_str in cur:
            try:
                data = json.loads(data_str)
            except (TypeError, json.JSONDecodeError):
                continue
            rows.append((str(session_id), int(time_created), data))
    finally:
        conn.close()
    return rows


def _adapt_opencode_todos(data: dict) -> list[dict]:
    """Map opencode `todowrite` payload shape -> native TodoWrite item shape."""
    state = data.get("state") or {}
    todos = (state.get("input") or {}).get("todos") or []
    out: list[dict] = []
    for item in todos:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        status = STATUS_MAP.get(str(item.get("status") or "").strip().lower(), "pending")
        out.append({
            "content": content,
            "activeForm": str(item.get("activeForm") or content),
            "status": status,
        })
    return out


def sync_latest_opencode_todos(db_path: Path | None = None,
                                since_ms: int | None = None) -> dict[str, Any]:
    db = db_path or _opencode_db_path()
    if not db.is_file():
        return {"ok": False, "message": "opencode.db not present", "sessions": 0, "items": 0, "added": 0}
    raw, meta, _todos = load_store()
    if since_ms is None:
        since_ms = int(float(meta.get("opencode_todo_synced_ts", 0.0)) * 1000)
    rows = latest_todowrite_per_session(db, since_ms=since_ms)
    if not rows:
        return {"ok": True, "message": "no new opencode todos", "sessions": 0, "items": 0, "added": 0}

    by_text: dict[str, dict] = {}
    total_items = 0
    high_water = since_ms
    for session_id, time_created, data in rows:
        items = _adapt_opencode_todos(data)
        for item in items:
            by_text[item["content"]] = {
                "content": item["content"],
                "activeForm": item.get("activeForm") or item["content"],
                "status": item.get("status") or "pending",
                "session": str(session_id),
                "time_created": int(time_created),
            }
            total_items += 1
        if time_created > high_water:
            high_water = int(time_created)

    added_count = 0
    updated_count = 0

    def _ingest(meta: dict, todos: list, _raw: list) -> tuple[bool, int]:
        nonlocal added_count, updated_count
        existing_by_text = {t.get("text", ""): t for t in flat_entries(todos)}
        changed = False
        for text, payload in by_text.items():
            existing = existing_by_text.get(text)
            if existing:
                if existing.get("source") == "opencode" and existing.get("status") != payload["status"]:
                    existing["status"] = payload["status"]
                    existing["done"] = payload["status"] == "completed"
                    updated_count += 1
                    changed = True
                continue
            meta["max_id"] = int(meta.get("max_id", 0)) + 1
            todos.append({
                "id": meta["max_id"],
                "text": text,
                "activeForm": payload["activeForm"],
                "status": payload["status"],
                "done": payload["status"] == "completed",
                "critical": False,
                "source": "opencode",
                "on_done": "",
                "ts": payload["time_created"] / 1000.0,
                "parent_id": 0,
                "tier": "E3",
                "subs": [],
            })
            added_count += 1
            changed = True
        if high_water > since_ms:
            meta["opencode_todo_synced_ts"] = high_water / 1000.0
            changed = True
        return changed, added_count + updated_count

    mutate_store(_ingest)
    return {
        "ok": True,
        "sessions": len(rows),
        "items": total_items,
        "added": added_count,
        "updated": updated_count,
        "synced_through": high_water,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", nargs="?", default="sync", choices=["sync"])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--db", default=None)
    args = ap.parse_args()
    db = Path(args.db) if args.db else None
    result = sync_latest_opencode_todos(db)
    if args.json:
        print(json.dumps(result))
    else:
        print(f"{result.get('sessions', 0)} session(s), {result.get('items', 0)} item(s) synced")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
