#!/usr/bin/env python3
"""Sync Codex update_plan calls into the HME TODO store."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
import re
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

from server.tools_analysis.todo_md_sync import sync_todo_md  # noqa: E402
from server.tools_analysis.todo_store import flat_entries, load_store, save_todos  # noqa: E402

STATUS_MAP = {
    "pending": "pending",
    "in_progress": "in_progress",
    "completed": "completed",
}


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def _session_files(codex_home: Path) -> list[Path]:
    root = codex_home / "sessions"
    if not root.is_dir():
        return []
    return sorted(root.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)


def _parse_timestamp(value: str) -> float:
    if not value:
        return 0.0
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return 0.0


def _plan_from_call(payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("type") != "function_call" or payload.get("name") != "update_plan":
        return None
    try:
        args = json.loads(payload.get("arguments") or "{}")
    except json.JSONDecodeError:
        return None
    plan = args.get("plan")
    if not isinstance(plan, list):
        return None
    items = []
    for item in plan:
        if not isinstance(item, dict):
            continue
        step = str(item.get("step") or "").strip()
        status = STATUS_MAP.get(str(item.get("status") or "").strip().lower(), "pending")
        if step:
            items.append({"step": step, "status": status})
    if not items:
        return None
    return {"plan": items, "explanation": str(args.get("explanation") or "")}


def latest_codex_plan(codex_home: Path | None = None, session_file: Path | None = None) -> dict[str, Any] | None:
    files = [session_file] if session_file else _session_files(codex_home or _codex_home())
    latest: dict[str, Any] | None = None
    root_token = str(PROJECT_ROOT)
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if root_token not in text and session_file is None:
            continue
        for line in text.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = event.get("payload")
            if not isinstance(payload, dict):
                continue
            parsed = _plan_from_call(payload)
            if parsed is None:
                continue
            parsed["timestamp"] = event.get("timestamp", "")
            parsed["timestamp_s"] = _parse_timestamp(parsed["timestamp"])
            parsed["session_file"] = str(path)
            if latest is None or parsed["timestamp_s"] >= latest.get("timestamp_s", 0):
                latest = parsed
    return latest


def _normalize_step(step: str) -> str:
    return re.sub(r"\s+", " ", step).strip().lower()


def sync_plan(plan_payload: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
    plan = plan_payload.get("plan") or []
    if not isinstance(plan, list):
        raise ValueError("plan payload must contain a plan list")
    raw, meta, todos = load_store()
    existing = {
        _normalize_step(entry.get("text", "")): entry
        for entry in flat_entries(todos)
        if entry.get("source") == "codex_plan"
    }
    seen: set[str] = set()
    added = 0
    updated = 0
    for item in plan:
        step = str(item.get("step") or "").strip()
        if not step:
            continue
        key = _normalize_step(step)
        seen.add(key)
        status = STATUS_MAP.get(str(item.get("status") or "").strip().lower(), "pending")
        entry = existing.get(key)
        if entry is None:
            meta["max_id"] = int(meta.get("max_id", 0)) + 1
            entry = {
                "id": meta["max_id"],
                "text": step,
                "activeForm": step,
                "status": status,
                "done": status == "completed",
                "critical": False,
                "source": "codex_plan",
                "on_done": "",
                "ts": time.time(),
                "parent_id": 0,
                "subs": [],
                "tier": "E3",
                "codex_session": plan_payload.get("session_file", ""),
                "codex_plan_ts": plan_payload.get("timestamp", ""),
            }
            todos.append(entry)
            added += 1
            continue
        if entry.get("status") != status or entry.get("done") != (status == "completed"):
            entry["status"] = status
            entry["done"] = status == "completed"
            updated += 1
        entry["codex_session"] = plan_payload.get("session_file", "")
        entry["codex_plan_ts"] = plan_payload.get("timestamp", "")
    superseded = 0
    for entry in flat_entries(todos):
        if entry.get("source") != "codex_plan":
            continue
        if _normalize_step(entry.get("text", "")) in seen:
            continue
        if entry.get("status") != "completed":
            entry["status"] = "completed"
            entry["done"] = True
            entry["resolved_reason"] = "superseded-by-codex-plan"
            superseded += 1
    changed = bool(
        added
        or updated
        or superseded
        or meta.get("codex_plan_source") != plan_payload.get("session_file", "")
        or meta.get("codex_plan_ts") != plan_payload.get("timestamp", "")
    )
    if not dry_run and changed:
        meta["codex_plan_synced_ts"] = time.time()
        meta["codex_plan_source"] = plan_payload.get("session_file", "")
        meta["codex_plan_ts"] = plan_payload.get("timestamp", "")
        save_todos(meta, todos)
        sync_todo_md(todos)
    return {
        "ok": True,
        "items": len(plan),
        "added": added,
        "updated": updated,
        "superseded": superseded,
        "session_file": plan_payload.get("session_file", ""),
        "timestamp": plan_payload.get("timestamp", ""),
        "dry_run": dry_run,
        "changed": changed,
    }


def sync_latest_codex_plan(*, dry_run: bool = False) -> dict[str, Any]:
    plan = latest_codex_plan()
    if plan is None:
        return {"ok": False, "message": "no Codex update_plan calls found for this project"}
    return sync_plan(plan, dry_run=dry_run)


def _payload_from_stdin() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("sync-payload requires a JSON payload on stdin")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("sync-payload stdin must be a JSON object")
    data.setdefault("timestamp", datetime.utcnow().isoformat(timespec="milliseconds") + "Z")
    data.setdefault("session_file", "codex-proxy")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", nargs="?", default="sync", choices=("latest", "sync", "sync-payload"))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--session-file")
    args = parser.parse_args()
    if args.action == "sync-payload":
        try:
            result = sync_plan(_payload_from_stdin(), dry_run=args.dry_run)
        except Exception as e:
            result = {"ok": False, "message": str(e)}
    elif args.action == "latest":
        plan = latest_codex_plan(session_file=Path(args.session_file) if args.session_file else None)
        result = plan or {"ok": False, "message": "no Codex update_plan calls found for this project"}
    else:
        plan = latest_codex_plan(session_file=Path(args.session_file) if args.session_file else None)
        if plan is None:
            result = {"ok": False, "message": "no Codex update_plan calls found for this project"}
        else:
            result = sync_plan(plan, dry_run=args.dry_run)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    elif result.get("ok") is False:
        print(f"codex-plan-sync: {result['message']}")
    elif args.action == "latest":
        print(f"codex-plan-sync: {len(result.get('plan', []))} item(s) from {result.get('session_file')}")
    else:
        print(
            "codex-plan-sync: "
            f"{result['items']} item(s), added={result['added']} "
            f"updated={result['updated']} superseded={result['superseded']}"
        )
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
