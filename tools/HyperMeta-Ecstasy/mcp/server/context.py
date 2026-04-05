"""Shared server state — engines, model, config, MCP app instance.

Initialized by main.py at startup. Tool modules import from here.
"""
import os
import logging
import threading
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("HyperMeta-Ecstasy")

# Populated by main.py before tool modules load
PROJECT_ROOT: str = ""
PROJECT_DB: str = ""
mcp: FastMCP = None  # type: ignore
project_engine = None  # RAGEngine
global_engine = None   # RAGEngine
shared_model = None    # SentenceTransformer
lib_engines: dict = {}

# Background startup synchronization — set by main.py after background load completes
_startup_done: threading.Event | None = None
_startup_error: Exception | None = None


def ensure_ready_sync(timeout: float = 45.0) -> None:
    """Block until background model/engine initialization completes.

    FastMCP runs sync tools via asyncio.to_thread(), so this blocking wait
    is safe — it never blocks the async event loop. Zero-cost after first call.
    """
    if _startup_done is None or _startup_done.is_set():
        if _startup_error:
            raise RuntimeError(f"HyperMeta-Ecstasy startup failed: {_startup_error}")
        return
    if not _startup_done.wait(timeout=timeout):
        raise RuntimeError(f"HyperMeta-Ecstasy: model loading timed out after {timeout}s")
    if _startup_error:
        raise RuntimeError(f"HyperMeta-Ecstasy startup failed: {_startup_error}")
