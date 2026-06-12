#!/usr/bin/env python3
"""Dump an opencode SQLite session to Claude-shape JSONL.

Usage: opencode_dump_transcript.py <session_id> <output_path> [--db PATH]

Reads ~/.local/share/opencode/opencode.db (or --db override), translates
opencode message+part records into Claude's transcript event shape so the
shared detectors and _transcript cache can consume them unchanged.

Freshness: if <output_path> already exists and its mtime is >= the session's
max(time_updated) in the DB, the dump is skipped. Otherwise the file is
rewritten atomically.

Exit: 0 on success or no-op skip, 1 on missing DB/session, 2 on argument
error. Prints the resolved output path on success, or empty on skip.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path


def _default_db_path() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "opencode" / "opencode.db"


def _adapt_part(part: dict) -> tuple[list[dict], list[dict]]:
    """Translate one opencode part into (content_blocks, deferred_tool_results).

    Tool parts split into two Claude blocks: a tool_use on the assistant
    message and a tool_result on a synthetic follow-up user message
    (matching Claude's wire shape so iter_tool_uses/iter_tool_results work).
    """
    ptype = part.get("type")
    if ptype == "text":
        text = part.get("text")
        return ([{"type": "text", "text": text}] if text else [], [])
    if ptype == "reasoning":
        text = part.get("text")
        return ([{"type": "thinking", "thinking": text}] if text else [], [])
    if ptype == "tool":
        call_id = str(part.get("callID") or "")
        tool_name = str(part.get("tool") or "")
        state = part.get("state") or {}
        tu = {"type": "tool_use", "id": call_id, "name": tool_name, "input": state.get("input") or {}}
        tr_blocks: list[dict] = []
        if state.get("status") == "completed":
            raw = state.get("output", "")
            content = raw if isinstance(raw, str) else json.dumps(raw)
            tr_blocks.append({"type": "tool_result", "tool_use_id": call_id, "content": content})
        return ([tu], tr_blocks)
    return ([], [])


def _build_events(messages: list[tuple[str, int, dict]], parts_by_msg: dict[str, list[dict]]) -> list[dict]:
    events: list[dict] = []
    for msg_id, ts, msg_data in messages:
        role = msg_data.get("role") or "user"
        content_blocks: list[dict] = []
        tool_results: list[dict] = []
        for part in parts_by_msg.get(msg_id, []):
            cb, tr = _adapt_part(part)
            content_blocks.extend(cb)
            tool_results.extend(tr)
        if content_blocks:
            events.append({
                "type": role,
                "message": {"role": role, "content": content_blocks},
                "timestamp": ts,
            })
        if tool_results:
            events.append({
                "type": "user",
                "message": {"role": "user", "content": tool_results},
                "timestamp": ts + 1,
            })
    return events


def _session_watermark(conn: sqlite3.Connection, session_id: str) -> int:
    cur = conn.execute(
        "SELECT MAX(time_updated) FROM message WHERE session_id = ?",
        (session_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _is_fresh(output_path: Path, watermark_ms: int) -> bool:
    try:
        mtime_ms = int(output_path.stat().st_mtime * 1000)
    except OSError:
        return False
    return mtime_ms >= watermark_ms


def dump_session(db_path: Path, session_id: str, output_path: Path) -> str:
    if not db_path.is_file():
        return ""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        watermark = _session_watermark(conn, session_id)
        if watermark == 0:
            return ""
        if _is_fresh(output_path, watermark):
            return str(output_path)
        cur = conn.execute(
            "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created",
            (session_id,),
        )
        messages: list[tuple[str, int, dict]] = []
        for mid, tc, data in cur:
            try:
                messages.append((mid, int(tc), json.loads(data)))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
        cur = conn.execute(
            "SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created",
            (session_id,),
        )
        parts_by_msg: dict[str, list[dict]] = {}
        for mid, data in cur:
            try:
                parts_by_msg.setdefault(mid, []).append(json.loads(data))
            except json.JSONDecodeError:
                continue
        events = _build_events(messages, parts_by_msg)
    finally:
        conn.close()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_suffix(output_path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text("".join(json.dumps(ev) + "\n" for ev in events), encoding="utf-8")
    os.replace(tmp, output_path)
    return str(output_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("session_id")
    ap.add_argument("output_path")
    ap.add_argument("--db", default=None)
    args = ap.parse_args()
    db = Path(args.db) if args.db else _default_db_path()
    result = dump_session(db, args.session_id, Path(args.output_path))
    if result:
        print(result)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
