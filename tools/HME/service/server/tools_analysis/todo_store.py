"""Canonical persistence for tools/HME/KB/todos.json."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

_service_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)
from paths import todo_store_file as _todo_store_file  # noqa: E402


def default_store() -> list[dict]:
    return [{"id": 0, "_meta": {"max_id": 0, "updated_ts": time.time()}}]


def max_seen_id(todos: list[dict]) -> int:
    max_id = 0
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        max_id = max(max_id, int(entry.get("id", 0)))
        for sub in entry.get("subs", []):
            if isinstance(sub, dict):
                max_id = max(max_id, int(sub.get("id", 0)))
    return max_id


def load_store(path: str | None = None) -> tuple[list[dict], dict, list[dict]]:
    """Return (raw, meta, todos), synthesizing the meta header for legacy files."""
    store_path = Path(path or _todo_store_file())
    if not store_path.is_file():
        raw = default_store()
    else:
        try:
            with open(store_path, encoding="utf-8") as f:
                raw = json.load(f)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"{store_path} is invalid JSON: {e}") from e
    if raw and isinstance(raw[0], dict) and raw[0].get("id") == 0 and "_meta" in raw[0]:
        meta = raw[0]["_meta"]
        todos = raw[1:]
        meta["max_id"] = max(int(meta.get("max_id", 0)), max_seen_id(todos))
        return raw, meta, todos
    todos = raw if isinstance(raw, list) else []
    meta = {"max_id": max_seen_id(todos), "updated_ts": time.time()}
    header = {"id": 0, "_meta": meta}
    return [header] + todos, meta, todos


def save_store(raw: list[dict], meta: dict, path: str | None = None) -> None:
    has_header = bool(raw and isinstance(raw[0], dict) and raw[0].get("id") == 0)
    body = raw[1:] if has_header else raw
    meta["max_id"] = max(int(meta.get("max_id", 0)), max_seen_id(body))
    meta["updated_ts"] = time.time()
    if not has_header:
        raw.insert(0, {"id": 0, "_meta": meta})
    else:
        raw[0]["_meta"] = meta
    store_path = Path(path or _todo_store_file())
    store_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = store_path.with_suffix(store_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2)
        f.write("\n")
    os.replace(tmp, store_path)


def save_todos(meta: dict, todos: list[dict], path: str | None = None) -> None:
    save_store([{"id": 0, "_meta": meta}] + todos, meta, path)


def flat_entries(todos: list[dict]) -> list[dict]:
    out: list[dict] = []
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        out.append(entry)
        out.extend(s for s in entry.get("subs", []) if isinstance(s, dict))
    return out
