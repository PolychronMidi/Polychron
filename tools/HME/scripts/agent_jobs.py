"""Filesystem-backed agent job contract.

The contract is intentionally boring:

runtime/hme/agent-jobs/<role>/<job_id>/
  request.json
  status.json
  output.txt
  stderr.txt
  events.jsonl

Subagent launchers can change implementation details, but callers and
dashboards should only rely on this directory shape.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[3]
)
JOBS_ROOT = PROJECT_ROOT / "runtime" / "hme" / "agent-jobs"
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _safe_part(value: str, label: str) -> str:
    value = (value or "").strip()
    if not value or not _SAFE_NAME.fullmatch(value):
        raise ValueError(f"{label} must match {_SAFE_NAME.pattern}")
    return value


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def new_job_id() -> str:
    return f"{int(time.time())}-{uuid.uuid4().hex[:10]}"


def job_dir(role: str, job_id: str, root: Path = JOBS_ROOT) -> Path:
    return root / _safe_part(role, "role") / _safe_part(job_id, "job_id")


def create_job(
    role: str,
    prompt: str,
    *,
    system: str = "",
    session_id: str = "",
    model: str = "",
    metadata: dict[str, Any] | None = None,
    root: Path = JOBS_ROOT,
) -> Path:
    jid = new_job_id()
    path = job_dir(role, jid, root)
    path.mkdir(parents=True, exist_ok=False)
    now = int(time.time())
    atomic_write_json(path / "request.json", {
        "job_id": jid,
        "role": role,
        "prompt": prompt,
        "system": system,
        "session_id": session_id,
        "model": model,
        "metadata": metadata or {},
        "created_at": now,
    })
    atomic_write_text(path / "output.txt", "")
    atomic_write_text(path / "stderr.txt", "")
    atomic_write_text(path / "events.jsonl", "")
    atomic_write_json(path / "status.json", {
        "job_id": jid,
        "role": role,
        "state": "queued",
        "created_at": now,
        "updated_at": now,
        "session_id": session_id,
        "model": model,
        "metadata": metadata or {},
    })
    return path


def read_request(path: Path) -> dict[str, Any]:
    return json.loads((path / "request.json").read_text(encoding="utf-8"))


def append_event(path: Path, event: dict[str, Any]) -> None:
    payload = dict(event)
    payload.setdefault("ts", int(time.time()))
    with open(path / "events.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")


def read_status(path: Path) -> dict[str, Any]:
    return json.loads((path / "status.json").read_text(encoding="utf-8"))


def update_status(path: Path, state: str, **fields: Any) -> dict[str, Any]:
    status = read_status(path)
    status.update(fields)
    status["state"] = state
    status["updated_at"] = int(time.time())
    atomic_write_json(path / "status.json", status)
    return status


def latest_job(role: str, root: Path = JOBS_ROOT) -> Path | None:
    role_dir = root / _safe_part(role, "role")
    if not role_dir.is_dir():
        return None
    jobs = sorted((p for p in role_dir.iterdir() if p.is_dir()), key=lambda p: p.name)
    return jobs[-1] if jobs else None
