"""Indexing-mode — full reindex with embedders pinned on their home GPU.

R97 rewrite: previously this suspended coder, migrated embedders cuda:0→
cuda:1, indexed, migrated back, resumed coder. That migration dance was
the source of every CUDA-corruption incident and the reason "model
pinning" got re-implemented ten different times — pinning is meaningless
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

_indexing_mode_lock = threading.Lock()


def _shim_post(endpoint: str, data: dict, timeout: float = 30) -> dict:
    shim_port = ENV.optional_int("HME_SHIM_PORT", 9098)
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
        "indexing-mode: starting — embedders stay pinned on their home GPU "
        "(no migration, no coder suspend)"
    )
    try:
        index_result = _shim_post(
            "/rag", {"engine": "project", "method": "index_directory"},
            timeout=500,
        )
        result_data = index_result.get("result", index_result)
        logger.info(f"indexing-mode: index complete: {result_data}")
        return result_data
    except Exception as e:
        logger.error(f"indexing-mode: index_directory failed: {e}")
        return {"error": f"index_directory failed: {e}"}


def run_indexing_mode() -> dict:
    """Concurrency-gated entrypoint. Caller responsibility: surface the
    {"error": "indexing mode already in progress"} response to the client
    rather than treating it as a fatal condition."""
    if not _indexing_mode_lock.acquire(blocking=False):
        return {"error": "indexing mode already in progress"}
    try:
        return _run_indexing_mode_locked()
    finally:
        _indexing_mode_lock.release()
