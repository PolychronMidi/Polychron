"""Runtime guard for unified TODO state monotonicity and render sync."""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("HME")


def _root() -> Path:
    return Path(os.environ.get("PROJECT_ROOT") or Path.cwd())  # env-ok: runtime/test sandbox root override


def _guard_path() -> Path:
    return _root() / "tools" / "HME" / "runtime" / "todo-state-guard.json"


def _error_log() -> Path:
    return _root() / "log" / "hme-errors.log"


def _read_guard() -> dict[str, Any]:
    try:
        return json.loads(_guard_path().read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug(f"todo state guard read failed: {type(exc).__name__}: {exc}")
        return {}


def _write_guard(data: dict[str, Any]) -> None:
    path = _guard_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass  # silent-ok: pending review


def _log_issue(message: str) -> None:
    path = _error_log()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] [todo-state-guard] {message}\n")


def record_store_state(meta: dict, todos: list[dict]) -> dict[str, Any]:
    state = {
        "max_id": int(meta.get("max_id", 0) or 0),
        "updated_ts": float(meta.get("updated_ts", 0) or 0),
        "entry_count": len(todos),
    }
    guard = _read_guard()
    prev_max = int(guard.get("max_id", 0) or 0)
    prev_ts = float(guard.get("updated_ts", 0) or 0)
    issues = []
    if prev_max and state["max_id"] < prev_max:
        issues.append(f"max_id regressed {state['max_id']} < {prev_max}")
    if prev_ts and state["updated_ts"] + 0.001 < prev_ts:
        issues.append(f"updated_ts regressed {state['updated_ts']:.3f} < {prev_ts:.3f}")
    if issues:
        key = "|".join(issues)
        if guard.get("last_issue") != key:
            _log_issue(f"LIFESAVER - TODO STATE WENT BACKWARD: {key}")
        guard["last_issue"] = key
        _write_guard(guard)
        return {"ok": False, "issues": issues}
    state["last_issue"] = ""
    _write_guard(state)
    return {"ok": True, "issues": []}


def check_todo_md_sync(*, write: bool = True) -> dict[str, Any]:
    from .todo_md_sync import repair_todo_md_from_store

    result = repair_todo_md_from_store(write=write)
    return result

