#!/usr/bin/env python3
"""Insert Codex proxy visibility rows into OmniRoute's dashboard database."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _db_path() -> Path:
    home = Path(os.environ.get("OMNIROUTE_HOME") or Path.home() / ".omniroute")
    return Path(os.environ.get("OMNIROUTE_DB") or home / "storage.sqlite")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {row[1] for row in con.execute(f"pragma table_info({table})")}
    except sqlite3.Error:
        return set()


def _insert(con: sqlite3.Connection, table: str, row: dict[str, Any]) -> bool:
    cols = [col for col in row if col in _columns(con, table)]
    if not cols:
        return False
    placeholders = ",".join("?" for _ in cols)
    con.execute(
        f"insert into {table} ({','.join(cols)}) values ({placeholders})",
        [row[col] for col in cols],
    )
    return True


def _artifact(payload: dict[str, Any], call_id: str, ts: str) -> tuple[str, int, str]:
    root = Path(os.environ.get("OMNIROUTE_HOME") or Path.home() / ".omniroute") / "call_logs"
    day = ts[:10]
    rel = f"{day}/{ts.replace(':', '-').replace('.', '-')}_{call_id}.json"
    path = root / rel
    body = {
        "source": "hme-codex-proxy-visibility",
        "requestBody": {
            "model": payload.get("model", ""),
            "metadata": payload.get("source", {}),
            "stats": payload.get("after") or {},
            "cleanup": payload.get("cleanup") or {},
        },
        "responseBody": {
            "status": payload.get("status"),
            "error": payload.get("error_summary") or "",
        },
    }
    text = json.dumps(body, indent=2, sort_keys=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    return rel, len(text), hashlib.sha256(text.encode()).hexdigest()[:8]


def record(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db_path()
    if not db.is_file():
        return {"ok": False, "skipped": True, "message": f"omniroute db missing: {db}"}
    ts = str(payload.get("timestamp") or _now())
    call_id = str(payload.get("id") or uuid.uuid4())
    status = int(payload.get("status") or 0)
    success = 1 if 200 <= status < 400 else 0
    model = str(payload.get("model") or "gpt-codex")
    after = payload.get("after") or {}
    cleanup = payload.get("cleanup") or {}
    source = payload.get("source") or {}
    duration = int(payload.get("duration_ms") or 0)
    tokens_in = int(after.get("text_bytes") or after.get("instruction_bytes") or 0)
    tokens_out = int(payload.get("tokens_out") or 0)
    artifact_rel, artifact_size, artifact_sha = _artifact(payload, call_id, ts)
    summary = (
        f"Codex proxy {model}: tools={after.get('tool_count', 0)} "
        f"text_bytes={after.get('text_bytes', 0)} cleanup={cleanup.get('categories', {})}"
    )
    con = sqlite3.connect(str(db), timeout=5)
    try:
        wrote = {}
        common = {
            "id": call_id,
            "timestamp": ts,
            "provider": "codex-proxy",
            "model": model,
            "status": status,
            "duration": duration,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "error_summary": payload.get("error_summary") or None,
        }
        wrote["call_logs"] = _insert(con, "call_logs", {
            **common,
            "method": "POST",
            "path": "/v1/responses",
            "requested_model": model,
            "account": "Codex CLI Proxy",
            "connection_id": source.get("session_id") or source.get("thread_id") or "codex-proxy",
            "request_type": "responses",
            "source_format": "openai-responses",
            "target_format": "chatgpt-codex",
            "api_key_name": "Codex CLI Proxy",
            "detail_state": "ready",
            "artifact_relpath": artifact_rel,
            "artifact_size_bytes": artifact_size,
            "artifact_sha256": artifact_sha,
            "has_request_body": 1,
            "has_response_body": success,
            "has_pipeline_details": 0,
            "request_summary": summary,
        })
        wrote["proxy_logs"] = _insert(con, "proxy_logs", {
            "id": call_id,
            "timestamp": ts,
            "status": "success" if success else "error",
            "provider": "codex-proxy",
            "target_url": payload.get("upstream", ""),
            "public_ip": "127.0.0.1",
            "latency_ms": duration,
            "error": payload.get("error_summary") or None,
            "connection_id": source.get("session_id") or source.get("thread_id") or "codex-proxy",
            "account": "Codex CLI Proxy",
        })
        wrote["usage_history"] = _insert(con, "usage_history", {
            "provider": "codex-proxy",
            "model": model,
            "connection_id": source.get("session_id") or source.get("thread_id") or "codex-proxy",
            "api_key_name": "Codex CLI Proxy",
            "tokens_input": tokens_in,
            "tokens_output": tokens_out,
            "status": str(status),
            "success": success,
            "latency_ms": duration,
            "timestamp": ts,
        })
        wrote["request_detail_logs"] = _insert(con, "request_detail_logs", {
            "id": str(uuid.uuid4()),
            "call_log_id": call_id,
            "timestamp": ts,
            "client_request": json.dumps({"model": model, "stats": after, "cleanup": cleanup}, sort_keys=True),
            "translated_request": json.dumps({"visibility_only": True}, sort_keys=True),
            "provider_response": json.dumps({"status": status}, sort_keys=True),
            "client_response": json.dumps({"status": status}, sort_keys=True),
            "provider": "codex-proxy",
            "model": model,
            "source_format": "openai-responses",
            "target_format": "chatgpt-codex",
            "duration_ms": duration,
        })
        con.commit()
        return {"ok": True, "id": call_id, "tables": wrote, "db": str(db)}
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = record(payload)
    except Exception as exc:
        result = {"ok": False, "message": f"{type(exc).__name__}: {exc}"}
    if args.json:
        print(json.dumps(result, sort_keys=True))
    elif result.get("ok"):
        print(f"omniroute-codex-visibility: {result.get('id')}")
    else:
        print(f"omniroute-codex-visibility: {result.get('message')}")
    return 0 if result.get("ok") or result.get("skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
