"""Indexing mode — dedicates a GPU for full reindexing by temporarily unloading the coder model.

Routine partial indexing (file watcher, single-file reindex) stays on whatever
device is available — no model shuffling needed for a few files.

Full reindexing (clear_index + index_directory) triggers indexing mode:
  1. Unload coder from GPU1 via llamacpp_daemon /unload
  2. Move embedding models to GPU1 (full 24GB dedicated to embeddings)
  3. Run index_directory at GPU speed
  4. Reload coder on GPU1

Usage:
    from indexing_mode import with_indexing_mode
    result = with_indexing_mode(engine.index_directory)
"""
import json
import logging
import urllib.request
import os

from hme_env import ENV

logger = logging.getLogger("HME.indexing_mode")

_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_CODER_PORT = ENV.require_int("HME_CODER_PORT")


def _unload_coder():
    """Ask llamacpp_daemon to unload the coder model from GPU1."""
    try:
        req = urllib.request.Request(
            f"{_DAEMON_URL}/unload",
            data=json.dumps({"port": _CODER_PORT}).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10).read()
        logger.info("Indexing mode: coder unloaded from GPU1")
        return True
    except Exception as e:
        logger.warning(f"Indexing mode: failed to unload coder: {e}")
        return False


def _reload_coder():
    """Ask llamacpp_daemon to reload the coder model on GPU1."""
    try:
        req = urllib.request.Request(
            f"{_DAEMON_URL}/reload",
            data=json.dumps({"port": _CODER_PORT}).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=30).read()
        logger.info("Indexing mode: coder reloaded on GPU1")
        return True
    except Exception as e:
        logger.warning(f"Indexing mode: failed to reload coder: {e}")
        return False


def with_indexing_mode(index_fn):
    """Run index_fn with dedicated GPU. Unloads coder before, reloads after.

    Returns the index_fn result. If coder unload fails, runs anyway (CPU fallback).
    Always attempts coder reload, even if indexing errors.
    """
    unloaded = _unload_coder()
    if unloaded:
        logger.info("Indexing mode: GPU1 dedicated to embeddings")
    else:
        logger.info("Indexing mode: running without GPU dedication (coder stays loaded)")

    try:
        result = index_fn()
        return result
    finally:
        if unloaded:
            _reload_coder()
