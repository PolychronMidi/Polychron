"""Shared server state — engines, model, config, MCP app instance.

Initialized by main.py at startup. Tool modules import from here.
"""
import os
import time
import logging
import threading
import functools
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("HME")


class _LoggingMCP:
    """Wraps FastMCP to add request/response logging on every tool call."""

    def __init__(self, inner: FastMCP):
        self._inner = inner

    def tool(self):
        """Decorator that wraps the tool function with logging."""
        original_decorator = self._inner.tool()

        def wrapper(fn):
            @functools.wraps(fn)
            def logged(*args, **kwargs):
                name = fn.__name__
                # Compact args for logging (truncate long values)
                arg_parts = []
                for k, v in kwargs.items():
                    s = str(v)
                    arg_parts.append(f"{k}={s[:120]}{'...' if len(s) > 120 else ''}")
                arg_str = ", ".join(arg_parts) if arg_parts else "()"
                logger.info(f"REQ  {name}({arg_str})")
                t0 = time.time()
                try:
                    result = fn(*args, **kwargs)
                    elapsed = time.time() - t0
                    if result is None:
                        # Tools must return strings — None causes silent MCP failures.
                        logger.error(f"ERR  {name} returned None — tool must return a string")
                        result = f"Error: {name} returned None (bug in tool implementation)"
                    result_str = str(result)[:200]
                    logger.info(f"RESP {name} [{elapsed:.1f}s] {result_str}")
                    return result
                except Exception as e:
                    elapsed = time.time() - t0
                    logger.error(f"ERR  {name} [{elapsed:.1f}s] {e}")
                    raise
            return original_decorator(logged)
        return wrapper

    def __getattr__(self, name):
        return getattr(self._inner, name)


# Populated by main.py before tool modules load
PROJECT_ROOT: str = ""
PROJECT_DB: str = ""
mcp: _LoggingMCP = None  # type: ignore
project_engine = None  # RAGEngine
global_engine = None   # RAGEngine
shared_model = None    # SentenceTransformer
lib_engines: dict = {}

# Pre-edit brief cache — callers and KB hits are expensive; cache them per file+mtime.
# kb_version increments on add_knowledge/remove_knowledge so KB-derived caches auto-invalidate.
_kb_version: int = 0
# _caller_cache: (abs_path, mtime) → list[caller dicts]
# _kb_hits_cache: (module_name, kb_version) → list[kb result dicts]
# Both live on ctx so they survive module hot-reloads.

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
            raise RuntimeError(f"HME startup failed: {_startup_error}")
        if project_engine is None or global_engine is None or shared_model is None:
            raise RuntimeError(
                "HME startup completed but engines are not initialized "
                f"(project_engine={project_engine!r}, global_engine={global_engine!r}, "
                f"shared_model={shared_model!r})"
            )
        return
    if not _startup_done.wait(timeout=timeout):
        raise RuntimeError(f"HME: model loading timed out after {timeout}s")
    if _startup_error:
        raise RuntimeError(f"HME startup failed: {_startup_error}")
    if project_engine is None or global_engine is None or shared_model is None:
        raise RuntimeError(
            "HME startup completed but engines are not initialized — "
            "check hme.log for background thread errors"
        )
