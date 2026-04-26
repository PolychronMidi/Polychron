"""Filesystem-IPC queue watcher for the HME worker.

Architectural intent (lesson #1 — proxy/worker as accelerators):
callers can address the worker via filesystem queue files instead of
synchronous HTTP. The HTTP path remains for backward compatibility;
this module provides a daemon thread that drains queued jobs in
parallel.

Contract:
    - Caller writes tmp/hme-worker-queue/<endpoint>/<jobId>.json
      atomically (tmp + rename). Body shape: {jobId, endpoint, body, ts}.
    - This watcher tail-polls the queue dir, dispatches each job to the
      same handlers /enrich, /enrich_prompt, /audit use, and writes the
      response to tmp/hme-worker-results/<jobId>.json atomically.
    - Watcher also unlinks the consumed job file so the queue stays
      bounded.

Polling-not-inotify rationale: kept polling because (1) the queue is
typically empty, so the cost is one stat() per 100ms; (2) inotify on
Linux + macOS-fsevents on Darwin would require platform shims; (3) the
proxy and worker already use polling extensively so this matches the
operational model. If queue volume ever exceeds 100 jobs/sec,
reconsider.

Failure semantics:
    - Watcher exits silently if PROJECT_ROOT is unset or the queue dir
      is unwritable. Worker keeps serving HTTP.
    - Job-level errors are caught and written to the result file as
      {error: "..."} so callers always see a response (or timeout).
    - The watcher loop catches all exceptions and continues — a
      malformed job file cannot wedge the queue.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.environ.get("PROJECT_ROOT", "/home/jah/Polychron")
QUEUE_DIR = Path(PROJECT_ROOT) / "tmp" / "hme-worker-queue"
RESULTS_DIR = Path(PROJECT_ROOT) / "tmp" / "hme-worker-results"
POLL_INTERVAL_S = 0.1

_running = False
_thread: threading.Thread | None = None


def _ensure_dirs() -> bool:
    try:
        QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        return True
    except OSError as e:
        logger.warning(f"worker_queue: cannot create queue dirs: {e}")
        return False


def _dispatch(endpoint: str, body: dict) -> dict:
    """Call the matching handler. Mirror of worker.py's _post_* methods.

    Endpoints:
        - 'enrich', 'enrich_prompt', 'audit' → hme_http_handlers (the
          original three the queue was designed for; same shape as
          /enrich, /audit HTTP endpoints).
        - 'tool' → tool_call(name, args), the unified i/* tool dispatch.
          Body: {name: str, args: dict}. Mirrors the /tool/<name> HTTP
          endpoint. This makes EVERY i/* CLI queue-addressable, which is
          the load-bearing piece for KB queries surviving worker HTTP
          outages: queue path doesn't require the worker's HTTP server
          to be responsive, only the worker process to be alive enough
          to drain the queue.
    """
    try:
        if endpoint in ("enrich", "enrich_prompt", "audit"):
            from hme_http_handlers import _enrich, _enrich_prompt, _post_audit
            if endpoint == "enrich":
                return _enrich(body.get("query", ""), top_k=int(body.get("top_k", 5)))
            if endpoint == "enrich_prompt":
                return _enrich_prompt(body.get("prompt", ""), body.get("frame", ""))
            if endpoint == "audit":
                return _post_audit(body.get("changed_files", ""))

        if endpoint == "tool":
            # Generic i/* tool dispatch via tool_call. Same protocol as
            # /tool/<name> HTTP — body shape: {name, args}. Returns
            # {ok: bool, result?: any, error?: str}.
            tool_name = body.get("name", "")
            tool_args = body.get("args", {}) or {}
            if not tool_name:
                return {"ok": False, "error": "missing tool name"}
            try:
                # Same import worker.py uses for HTTP /tool/<name>.
                from server.tool_registry import call as tool_call  # type: ignore
            except ImportError as e:
                return {"ok": False, "error": f"tool_registry unavailable: {e}"}
            try:
                result = tool_call(tool_name, tool_args)
                return {"ok": True, "result": result}
            except KeyError as e:
                return {"ok": False, "error": f"unknown tool: {e}"}
            except Exception as e:
                return {"ok": False, "error": f"{type(e).__name__}: {e}"}

        return {"error": f"unknown endpoint: {endpoint}"}
    except Exception as e:
        logger.exception(f"worker_queue: handler {endpoint} threw")
        return {"error": f"{type(e).__name__}: {e}"}


def _write_result(job_id: str, result: dict) -> None:
    out = RESULTS_DIR / f"{job_id}.json"
    tmp = RESULTS_DIR / f"{job_id}.json.tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(result, f)
        tmp.replace(out)  # atomic rename
    except OSError as e:
        logger.warning(f"worker_queue: failed to write result for {job_id}: {e}")
        try:
            tmp.unlink()
        except OSError:
            pass


def _process_job(job_path: Path) -> None:
    try:
        with open(job_path) as f:
            job = json.load(f)
    except (json.JSONDecodeError, OSError):
        # Partial write or corrupted file — delete and skip.
        try:
            job_path.unlink()
        except OSError:
            pass
        return

    job_id = job.get("jobId", "unknown")
    endpoint = job.get("endpoint", "")
    body = job.get("body", {})

    result = _dispatch(endpoint, body)
    _write_result(job_id, result)

    try:
        job_path.unlink()
    except OSError:
        pass


def _watcher_loop() -> None:
    global _running
    while _running:
        try:
            if QUEUE_DIR.exists():
                for endpoint_dir in QUEUE_DIR.iterdir():
                    if not endpoint_dir.is_dir():
                        continue
                    # sorted() = process oldest jobs first (FIFO by name,
                    # which is random hex but stable per-iteration).
                    for job_path in sorted(endpoint_dir.glob("*.json")):
                        if not _running:
                            break
                        _process_job(job_path)
        except Exception:
            # Never let an exception kill the watcher loop.
            logger.exception("worker_queue: watcher iteration failed")
        time.sleep(POLL_INTERVAL_S)


def start() -> threading.Thread | None:
    """Start the queue watcher in a daemon thread. Idempotent."""
    global _running, _thread
    if _running and _thread is not None and _thread.is_alive():
        return _thread
    if not _ensure_dirs():
        return None
    _running = True
    _thread = threading.Thread(
        target=_watcher_loop,
        daemon=True,
        name="worker-queue-watcher",
    )
    _thread.start()
    logger.info(f"worker_queue: watcher started, polling {QUEUE_DIR}")
    return _thread


def stop() -> None:
    global _running
    _running = False
