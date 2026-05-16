"""Background index-job status for hme_admin."""
from __future__ import annotations

import json
import os
import threading
import time
import traceback
from typing import Callable, Optional

_ALLOWED_ACTIONS = {"index", "clear_index"}
_LOCK = threading.Lock()
_JOB_THREAD: Optional[threading.Thread] = None


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _paths(project_root: str) -> tuple[str, str]:
    status_path = os.path.join(project_root, "tools", "HME", "runtime", "index-job.json")
    log_path = os.path.join(project_root, "log", "hme-index-job.log")
    return status_path, log_path


def _rel(project_root: str, path: str) -> str:
    try:
        return os.path.relpath(path, project_root)
    except ValueError:
        return path


def _write_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, path)


def _append_log(project_root: str, message: str) -> None:
    _status_path, log_path = _paths(project_root)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(f"[{_now()}] {message}\n")


def _default_runner(action: str) -> str:
    if action == "index":
        from tools_index import index_codebase
        return index_codebase()
    if action == "clear_index":
        from tools_index import clear_index
        return clear_index()
    raise ValueError(f"unsupported index action: {action}")


def _thread_alive() -> bool:
    return _JOB_THREAD is not None and _JOB_THREAD.is_alive()


def read_index_job(project_root: str) -> dict:
    status_path, log_path = _paths(project_root)
    if not os.path.exists(status_path):
        return {
            "state": "missing",
            "status_path": status_path,
            "log_path": log_path,
            "live_in_process": False,
        }
    try:
        with open(status_path, encoding="utf-8") as fh:
            status = json.load(fh)
    except Exception as exc:
        status = {"state": "unreadable", "error": f"{type(exc).__name__}: {exc}"}
    status.setdefault("status_path", status_path)
    status.setdefault("log_path", log_path)
    status["live_in_process"] = _thread_alive()
    return status


def _run_index_job(project_root: str, action: str, runner: Callable[[str], str]) -> None:
    status_path, _log_path = _paths(project_root)
    try:
        _append_log(project_root, f"{action}: started")
        result = runner(action)
        status = read_index_job(project_root)
        status.update({
            "state": "done",
            "action": action,
            "finished_at": _now(),
            "updated_at": _now(),
            "result": str(result),
            "error": "",
        })
        _write_json(status_path, status)
        _append_log(project_root, f"{action}: done")
    except Exception as exc:
        status = read_index_job(project_root)
        status.update({
            "state": "error",
            "action": action,
            "finished_at": _now(),
            "updated_at": _now(),
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc()[-4000:],
        })
        _write_json(status_path, status)
        _append_log(project_root, f"{action}: error: {type(exc).__name__}: {exc}")


def start_index_job(
    project_root: str,
    action: str,
    runner: Callable[[str], str] | None = None,
) -> dict:
    if action not in _ALLOWED_ACTIONS:
        raise ValueError(f"unsupported index action: {action}")
    status_path, log_path = _paths(project_root)
    with _LOCK:
        if _thread_alive():
            status = read_index_job(project_root)
            status["already_running"] = True
            return status
        runner = runner or _default_runner
        started_at = _now()
        status = {
            "state": "running",
            "action": action,
            "started_at": started_at,
            "updated_at": started_at,
            "finished_at": "",
            "result": "",
            "error": "",
            "pid": os.getpid(),
            "status_path": status_path,
            "log_path": log_path,
            "already_running": False,
        }
        _write_json(status_path, status)
        global _JOB_THREAD
        _JOB_THREAD = threading.Thread(
            target=_run_index_job,
            args=(project_root, action, runner),
            daemon=True,
            name=f"hme-{action}-job",
        )
        _JOB_THREAD.start()
        status["just_started"] = True
        return status


def wait_for_current_job(timeout: float = 0) -> bool:
    thread = _JOB_THREAD
    if thread is None:
        return True
    thread.join(timeout)
    return not thread.is_alive()


def format_index_job(project_root: str, status: dict) -> str:
    status_path, log_path = _paths(project_root)
    state = status.get("state", "missing")
    action = status.get("action", "n/a")
    if status.get("already_running"):
        prefix = "Index job already running"
    elif state == "running" and status.get("just_started"):
        prefix = "Index job started in background"
    elif state == "running":
        prefix = "Index job running"
    else:
        prefix = "Index job status"
    lines = [
        prefix,
        f"- action: {action}",
        f"- state: {state}",
        f"- started: {status.get('started_at', '') or 'n/a'}",
    ]
    if status.get("finished_at"):
        lines.append(f"- finished: {status['finished_at']}")
    if status.get("error"):
        lines.append(f"- error: {status['error']}")
    if status.get("result"):
        lines.append("- result:")
        lines.extend(f"  {line}" for line in str(status["result"]).splitlines()[:20])
    lines.extend([
        f"- status: {_rel(project_root, status.get('status_path', status_path))}",
        f"- log: {_rel(project_root, status.get('log_path', log_path))}",
    ])
    return "\n".join(lines)
