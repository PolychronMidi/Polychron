"""Canonical persistence for tools/HME/KB/todos.json."""
from __future__ import annotations

import json
import os
import sys
import time
import threading
from pathlib import Path
from typing import Any, Callable

_service_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)
from paths import todo_store_file as _todo_store_file  # noqa: E402
from .todo_sources import VALID_TODO_SOURCES, validate_source  # noqa: E402
from .todo_state_guard import record_store_state  # noqa: E402

STORE_LOCK = threading.RLock()
VALID_STATUSES = ("pending", "in_progress", "completed")
VALID_TIERS = ("E1", "E2", "E3", "E4", "E5")
LEGACY_TIER_MAP = {"easy": "E2", "medium": "E3", "hard": "E4"}


def default_store() -> list[dict]:
    return [{"id": 0, "_meta": {"max_id": 0, "updated_ts": time.time()}}]


def max_seen_id(todos: list[dict]) -> int:
    max_id = 0
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        try:
            max_id = max(max_id, int(entry.get("id", 0)))
        except (TypeError, ValueError):
            continue
        for sub in entry.get("subs", []):
            if isinstance(sub, dict):
                try:
                    max_id = max(max_id, int(sub.get("id", 0)))
                except (TypeError, ValueError):
                    continue
    return max_id


def normalize_tier(tier: str | None) -> str:
    t = (tier or "").strip()
    upper = t.upper()
    if upper in VALID_TIERS:
        return upper
    return LEGACY_TIER_MAP.get(t.lower(), "E3")


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
        record_store_state(meta, todos)
        return raw, meta, todos
    todos = raw if isinstance(raw, list) else []
    meta = {"max_id": max_seen_id(todos), "updated_ts": time.time()}
    header = {"id": 0, "_meta": meta}
    record_store_state(meta, todos)
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
    record_store_state(meta, body)


def save_todos(meta: dict, todos: list[dict], path: str | None = None) -> None:
    save_store([{"id": 0, "_meta": meta}] + todos, meta, path)


def mutate_store(
    mutator: Callable[[dict, list[dict], list[dict]], Any],
    path: str | None = None,
) -> Any:
    """Load, mutate, and save the todo store under the canonical store lock.

    The mutator receives (meta, todos, raw). Return a truthy value to persist.
    If it returns a tuple shaped (changed: bool, value), only value is returned.
    """
    with STORE_LOCK:
        raw, meta, todos = load_store(path)
        result = mutator(meta, todos, raw)
        changed = bool(result)
        value = result
        if (
            isinstance(result, tuple)
            and len(result) == 2
            and isinstance(result[0], bool)
        ):
            changed, value = result
        if changed:
            save_todos(meta, todos, path)
        return value


def flat_entries(todos: list[dict]) -> list[dict]:
    out: list[dict] = []
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        out.append(entry)
        out.extend(s for s in entry.get("subs", []) if isinstance(s, dict))
    return out


def _entry_errors(entry: Any, path: str, parent_id: int = 0) -> list[str]:
    errors: list[str] = []
    if not isinstance(entry, dict):
        return [f"{path}: not an object"]
    for field in ("id", "text", "activeForm", "status", "done", "critical",
                  "source", "on_done", "ts", "parent_id", "tier"):
        if field not in entry:
            errors.append(f"{path}: missing {field}")
    try:
        entry_id = int(entry.get("id"))
        if entry_id <= 0:
            errors.append(f"{path}: id must be > 0")
    except Exception as _exc:
        errors.append(f"{path}: id must be an integer")
    if not str(entry.get("text", "")).strip():
        errors.append(f"{path}: text is empty")
    status = entry.get("status")
    if status not in VALID_STATUSES:
        errors.append(f"{path}: invalid status {status!r}")
    if not isinstance(entry.get("done"), bool):
        errors.append(f"{path}: done must be boolean")
    elif status in VALID_STATUSES and entry.get("done") != (status == "completed"):
        errors.append(f"{path}: done/status mismatch")
    source = str(entry.get("source", "") or "")
    if source in ("onboarding", "spec"):
        errors.append(f"{path}: retired source {source!r}")
    elif source not in VALID_TODO_SOURCES:
        errors.append(f"{path}: invalid source {source!r}")
    tier = entry.get("tier")
    if normalize_tier(tier) != str(tier or "").strip().upper():
        errors.append(f"{path}: noncanonical tier {tier!r}")
    try:
        raw_parent_id = entry.get("parent_id", -1)
        actual_parent_id = int(raw_parent_id if raw_parent_id is not None else -1)
    except Exception as _exc:
        actual_parent_id = -1
        errors.append(f"{path}: parent_id must be an integer")
    if actual_parent_id != parent_id:
        errors.append(f"{path}: parent_id should be {parent_id}")
    if parent_id == 0:
        subs = entry.get("subs")
        if not isinstance(subs, list):
            errors.append(f"{path}: subs must be a list")
        else:
            for i, sub in enumerate(subs):
                errors.extend(_entry_errors(sub, f"{path}.subs[{i}]", int(entry.get("id", 0) or 0)))
    elif entry.get("subs") not in ([], None):
        errors.append(f"{path}: sub entries must not carry nested subs")
    return errors


def validate_store(path: str | None = None, raw: list[dict] | None = None) -> list[str]:
    """Return strict schema errors for todos.json."""
    errors: list[str] = []
    if raw is None:
        raw, meta, todos = load_store(path)
    else:
        if not isinstance(raw, list):
            return ["root must be a JSON array"]
        if raw and isinstance(raw[0], dict) and raw[0].get("id") == 0 and "_meta" in raw[0]:
            meta = raw[0]["_meta"]
            todos = raw[1:]
        else:
            meta = {"max_id": 0}
            todos = raw
            errors.append("missing metadata header entry id=0")
    if not isinstance(raw, list):
        return ["root must be a JSON array"]
    if not raw:
        errors.append("missing metadata header entry id=0")
    elif not isinstance(raw[0], dict) or raw[0].get("id") != 0 or "_meta" not in raw[0]:
        errors.append("first entry must be metadata header id=0")
    if not isinstance(meta, dict):
        errors.append("metadata header _meta must be an object")
        meta = {}
    for field in ("max_id", "updated_ts"):
        if field not in meta:
            errors.append(f"metadata missing {field}")
    seen: set[int] = set()
    max_id = 0
    for i, entry in enumerate(todos):
        errors.extend(_entry_errors(entry, f"todos[{i}]"))
        if not isinstance(entry, dict):
            continue
        for item in [entry] + [s for s in entry.get("subs", []) if isinstance(s, dict)]:
            try:
                entry_id = int(item.get("id"))
            except Exception as _exc:
                continue
            if entry_id in seen:
                errors.append(f"id {entry_id} appears more than once")
            seen.add(entry_id)
            max_id = max(max_id, entry_id)
    try:
        if int(meta.get("max_id", 0)) < max_id:
            errors.append(f"metadata max_id {meta.get('max_id')} is lower than seen id {max_id}")
    except Exception as _exc:
        errors.append("metadata max_id must be an integer")
    return errors


def repair_store(path: str | None = None) -> dict[str, Any]:
    """Normalize todos.json to the strict schema; drop retired onboarding/spec rows."""
    def _repair(_meta: dict, todos: list[dict], _raw: list[dict]) -> tuple[bool, dict[str, Any]]:
        now = time.time()
        changed = False
        next_id = max_seen_id(todos)
        seen: set[int] = set()
        removed = 0

        def _fresh_id() -> int:
            nonlocal next_id
            next_id += 1
            return next_id

        def _repair_entry(entry: Any, parent_id: int = 0) -> dict | None:
            nonlocal changed, removed
            if not isinstance(entry, dict):
                removed += 1
                changed = True
                return None
            source = str(entry.get("source") or "hme_todo")
            if source in ("onboarding", "spec"):
                removed += 1
                changed = True
                return None
            try:
                source = validate_source(source)
            except ValueError:
                source = "hme_todo"
                changed = True
            try:
                entry_id = int(entry.get("id"))
                if entry_id <= 0 or entry_id in seen:
                    raise ValueError()
            except Exception as _exc:
                entry_id = _fresh_id()
                changed = True
            seen.add(entry_id)
            text = str(entry.get("text") or "").strip()
            if not text:
                text = "untitled todo"
                changed = True
            status = str(entry.get("status") or "pending")
            if status not in VALID_STATUSES:
                status = "completed" if bool(entry.get("done")) else "pending"
                changed = True
            done = status == "completed"
            tier = normalize_tier(entry.get("tier"))
            try:
                ts = float(entry.get("ts") or now)
            except Exception as _exc:
                ts = now
                changed = True
            repaired = {
                **entry,
                "id": entry_id,
                "text": text,
                "activeForm": str(entry.get("activeForm") or text),
                "status": status,
                "done": done,
                "critical": bool(entry.get("critical")),
                "source": source,
                "on_done": str(entry.get("on_done") or ""),
                "ts": ts,
                "parent_id": int(parent_id),
                "tier": tier,
                "subs": [],
            }
            if parent_id == 0:
                repaired["subs"] = [
                    sub for sub in (
                        _repair_entry(sub, entry_id) for sub in entry.get("subs", [])
                    )
                    if sub is not None
                ]
            if repaired != entry:
                changed = True
            return repaired

        repaired_todos = [
            item for item in (_repair_entry(entry, 0) for entry in todos)
            if item is not None
        ]
        todos[:] = repaired_todos
        old_max_id = _meta.get("max_id")
        _meta["max_id"] = max(int(_meta.get("max_id", 0) or 0), max_seen_id(todos))
        if old_max_id != _meta["max_id"]:
            changed = True
        _meta["updated_ts"] = now
        errors = validate_store(raw=[{"id": 0, "_meta": _meta}] + todos)
        return changed, {
            "changed": changed,
            "removed": removed,
            "top_level": len(todos),
            "entry_count": len(flat_entries(todos)),
            "errors": errors,
        }

    return mutate_store(_repair, path)
