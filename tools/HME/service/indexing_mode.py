"""Indexing mode -- tells the daemon to dedicate GPU1 for full reindexing.

ALL GPU allocation goes through the daemon. This module NEVER loads models
or touches GPUs directly. It only sends HTTP requests to the daemon's
/indexing-mode endpoint, which handles:
  1. Suspend coder (kill + prevent auto-restart)
  2. Signal shim to reload engines on cuda:1
  3. Wait for shim to complete index_directory
  4. Signal shim to release cuda:1
  5. Resume coder

Usage:
    from indexing_mode import request_full_reindex
    result = request_full_reindex()  # blocks until done or fails
"""
import json
import logging
import urllib.request

from hme_env import ENV
from indexing_timeouts import indexing_timeouts

logger = logging.getLogger("HME.indexing_mode")

_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")


def request_full_reindex() -> dict:
    """Ask the daemon to orchestrate a GPU-dedicated full reindex.
    Returns the index result dict. Blocks until complete, or coalesces
    with an in-progress run (returned dict carries `coalesced=True`).
    Concurrent reindex triggers are EXPECTED -- the daemon serializes
    them, this function never errors on overlap alone."""
    try:
        req = urllib.request.Request(
            f"{_DAEMON_URL}/indexing-mode",
            data=json.dumps({"action": "start"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(
            req, timeout=indexing_timeouts()["client_sec"]).read())
        if resp.get("error"):
            logger.warning(f"Indexing mode failed: {resp['error']}")
            return resp
        if resp.get("coalesced"):
            # Another reindex was in flight; we waited and inherited
            # its result. Log at info, not warning -- this is the design.
            logger.info(
                f"Indexing mode coalesced into in-progress run: "
                f"{resp.get('indexed', '?')} files"
            )
            return resp
        logger.info(f"Indexing mode complete: {resp.get('indexed', '?')} files")
        return resp
    except Exception as e:
        logger.warning(f"Indexing mode request failed: {e}")
        return {"error": str(e)}
