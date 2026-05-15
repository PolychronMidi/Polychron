"""Indexing-mode -- full reindex with embedders pinned on their home GPU.

R97 rewrite: previously this suspended coder, migrated embedders cuda:0->
cuda:1, indexed, migrated back, resumed coder. That migration dance was
the source of every CUDA-corruption incident and the reason "model
pinning" got re-implemented ten different times -- pinning is meaningless
if this function violates it every reindex.

New flow: DO NOT MIGRATE, DO NOT SUSPEND ANYTHING. Tell the shim to run
index_directory where embedders already live. Costs ~30% embedder
throughput during indexing but eliminates the whole migration-era class
of bugs (CUDA context corruption, coder respawn races, stuck embedders).

If the pinned layout can't fit the embedder encoding (~6.5 GB resident
+ attention peaks): fix THAT (smaller batch, smaller seq, different
embedder), don't migrate around it.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

from ._boot import ENV, logger
from indexing_timeouts import indexing_timeouts
from service_registry import service_map, service_port

_indexing_mode_lock = threading.Lock()
# Last-completed result, used to coalesce concurrent callers: when a
_last_result_lock = threading.Lock()
_last_result: dict = {}


def _shim_post(endpoint: str, data: dict, timeout: float = 30) -> dict:
    shim_port = service_port(service_map()["worker"])
    url = f"http://127.0.0.1:{shim_port}{endpoint}"
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except ValueError:
            raise RuntimeError(
                f"shim {endpoint} returned HTTP {e.code}: {body[:200]}"
            ) from e
    result = json.loads(resp.read())
    if isinstance(result, dict) and result.get("error"):
        logger.warning(f"shim {endpoint} returned error: {result['error']}")
    return result


def _run_indexing_mode_locked() -> dict:
    logger.info(
        "indexing-mode: starting -- embedders stay pinned on their home GPU "
        "(no migration, no coder suspend)"
    )
    try:
        index_result = _shim_post(
            "/rag", {"engine": "project", "method": "index_directory"},
            timeout=indexing_timeouts()["shim_post_sec"],
        )
        result_data = index_result.get("result", index_result)
        logger.info(f"indexing-mode: index complete: {result_data}")
        return result_data
    except Exception as e:
        logger.error(f"indexing-mode: index_directory failed: {e}")
        return {"error": f"index_directory failed: {e}"}


def run_indexing_mode() -> dict:
    """Concurrency-gated entrypoint. Concurrent callers coalesce -- the
    second invocation waits for the first to finish and returns that
    same result tagged `coalesced=True`. No error response, no warning
    log; overlapping triggers (edit-watcher + scheduled + manual) are
    the design, not an aberration."""
    if not _indexing_mode_lock.acquire(blocking=False):
        # Another caller already holds the lock -- wait for them, then
        logger.debug("indexing-mode: coalescing into in-progress run")
        with _indexing_mode_lock:  # blocks until in-progress release
            with _last_result_lock:
                cached = dict(_last_result)
        cached["coalesced"] = True
        return cached
    result: dict = {}
    try:
        result = _run_indexing_mode_locked()
        return result
    finally:
        with _last_result_lock:
            _last_result.clear()
            if isinstance(result, dict):
                _last_result.update(result)
        _indexing_mode_lock.release()
