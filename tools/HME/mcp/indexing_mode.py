"""Indexing mode — dedicates GPU1 for full reindexing.

1. Unloads coder from GPU1 via llamacpp_daemon
2. Loads embedding models on GPU1 (full 24GB dedicated)
3. Runs index_directory at GPU speed
4. Unloads embedding models from GPU1
5. Reloads coder on GPU1

Only for full reindexing. Routine partial indexing uses whatever device is available.
"""
import json
import logging
import os
import urllib.request

from hme_env import ENV

logger = logging.getLogger("HME.indexing_mode")

_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_CODER_PORT = ENV.require_int("HME_CODER_PORT")
PROJECT_ROOT = ENV.require("PROJECT_ROOT")
PROJECT_DB = ENV.require("RAG_DB_PATH")


_CODER_NAME = "coder"  # matches InstanceSpec name in llamacpp_daemon


def _suspend_coder():
    """Ask llamacpp_daemon to suspend the coder (kill + prevent auto-restart)."""
    try:
        req = urllib.request.Request(
            f"{_DAEMON_URL}/suspend",
            data=json.dumps({"name": _CODER_NAME}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
        if resp.get("suspended"):
            logger.info(f"Indexing mode: {_CODER_NAME} suspended via daemon")
            return True
        logger.warning(f"Indexing mode: daemon returned {resp}")
        return False
    except Exception as e:
        logger.warning(f"Indexing mode: failed to suspend coder: {e}")
        return False


def _resume_coder():
    """Ask llamacpp_daemon to resume the coder (clear flag + respawn)."""
    try:
        req = urllib.request.Request(
            f"{_DAEMON_URL}/resume",
            data=json.dumps({"name": _CODER_NAME}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
        logger.info(f"Indexing mode: {_CODER_NAME} resumed — spawned={resp.get('spawned')}")
        return True
    except Exception as e:
        logger.warning(f"Indexing mode: failed to resume coder: {e}")
        return False


def full_reindex():
    """Dedicated-GPU full reindex. Returns the index result dict."""
    import torch

    # 1. Suspend coder via daemon (kill + prevent auto-restart)
    unloaded = _suspend_coder()
    if not unloaded:
        logger.warning("Indexing mode: coder unload failed — falling back to current device")

    try:
        # 2. Load fresh embedding models directly on GPU1
        device = "cuda:1" if unloaded and torch.cuda.is_available() else "cpu"
        logger.info(f"Indexing mode: loading embedding models on {device}")

        from sentence_transformers import SentenceTransformer
        from rag_engine import RAGEngine
        from file_walker import init_config

        init_config(PROJECT_ROOT)
        os.makedirs(PROJECT_DB, exist_ok=True)

        text_model = SentenceTransformer(ENV.require("RAG_MODEL"), device=device)
        code_model = SentenceTransformer(ENV.require("RAG_CODE_MODEL"), device=device)

        logger.info(f"Indexing mode: models loaded on {device}")

        # 3. Create a temporary engine with GPU-backed models
        engine = RAGEngine(
            db_path=PROJECT_DB,
            model=text_model,
            code_model=code_model,
        )

        # 4. Run full index
        logger.info("Indexing mode: starting full index_directory")
        result = engine.index_directory()
        logger.info(f"Indexing mode: done — {result.get('total_files', '?')} files, {result.get('indexed', '?')} indexed")

        # 5. Index symbols
        from symbols.extractor import collect_all_symbols
        symbols = collect_all_symbols(PROJECT_ROOT)
        sym_result = engine.index_symbols(symbols)
        result["symbols_indexed"] = sym_result.get("indexed", 0)

        # 6. Clean up GPU memory
        del text_model, code_model, engine
        if device.startswith("cuda"):
            torch.cuda.empty_cache()
            logger.info("Indexing mode: GPU1 VRAM freed")

        return result

    finally:
        # 7. Always resume coder via daemon
        if unloaded:
            _resume_coder()
