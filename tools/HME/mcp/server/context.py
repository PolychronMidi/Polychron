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


# ── LIFESAVER critical failure accumulator ────────────────────────────────
# Background threads (warm priming, model init, synthesis) register failures
# here. The _LoggingMCP choke point drains them into the NEXT tool response
# so they pop to Claude's attention immediately — never buried in a log file.
_critical_failures: list[dict] = []
_critical_failures_lock = threading.Lock()


def register_critical_failure(source: str, error: str, severity: str = "CRITICAL"):
    """Register a failure that MUST surface in the next tool response.

    Called from background threads when CUDA errors, 500s, OOM kills, or
    repeated warm priming failures occur. Lifesaver philosophy: errors pop
    to the top of attention immediately. Also appends to the HME todo list.
    """
    with _critical_failures_lock:
        _critical_failures.append({
            "ts": time.time(),
            "source": source,
            "error": error,
            "severity": severity,
        })
    logger.error(f"LIFESAVER QUEUED [{severity}] {source}: {error}")
    try:
        from server.tools_analysis.todo import register_todo_from_lifesaver
        register_todo_from_lifesaver(source, error, severity)
    except Exception as _te:
        logger.error(f"LIFESAVER todo append failed (failure still queued): {_te}")


def drain_critical_failures() -> str:
    """Drain all queued failures into a LIFESAVER banner string.

    Returns empty string if no failures. Called by _LoggingMCP on every
    tool response — the only way background failures reach Claude.
    """
    with _critical_failures_lock:
        if not _critical_failures:
            return ""
        failures = list(_critical_failures)
        _critical_failures.clear()
    lines = [
        "",
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
        "  LIFESAVER: CRITICAL FAILURES DETECTED — ADDRESS NOW",
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
    ]
    for f in failures:
        lines.append(f"  [{f['severity']}] {f['source']}: {f['error']}")
    lines.append("")
    lines.append("  These failures occurred in background threads and were")
    lines.append("  queued for your attention. Diagnose and fix before")
    lines.append("  proceeding with other work.")
    lines.append("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    lines.append("")
    return "\n".join(lines)


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
                try:
                    with open("/tmp/hme-non-hme-streak.count", "w") as _f:
                        _f.write("0")
                except OSError:
                    pass
                name = fn.__name__
                t0 = time.time()
                try:
                    result = fn(*args, **kwargs)
                    elapsed = time.time() - t0
                    if result is None:
                        logger.error(f"ERR  {name} returned None — tool must return a string")
                        result = f"Error: {name} returned None (bug in tool implementation)"
                    # LIFESAVER: drain queued background failures into this response
                    lifesaver_banner = drain_critical_failures()
                    if lifesaver_banner:
                        result = lifesaver_banner + str(result)
                    result_str = str(result)[:200]
                    logger.info(f"RESP {name} [{elapsed:.1f}s] {result_str}")
                    return result
                except Exception as e:
                    import traceback as _tb
                    elapsed = time.time() - t0
                    logger.error(f"ERR  {name} [{elapsed:.1f}s] {e}\n{_tb.format_exc()}")
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
_recovery_attempted: bool = False


def _try_recover_from_proxy_error() -> bool:
    """Recovery path for proxy-mode startup failures.

    If the MCP server failed startup because the shim was running but didn't yet have
    the /rag endpoint (e.g., old ChatPanel-managed shim), the error is cached and
    every tool call fails. This detects that condition and re-initializes using the
    proxy if the shim is now healthy.

    Returns True if recovery succeeded.
    """
    global _startup_error, _recovery_attempted, project_engine, global_engine, shared_model, lib_engines
    if _recovery_attempted:
        return False
    _recovery_attempted = True
    try:
        from server.rag_proxy import RAGProxy, check_shim_health, get_lib_engines
        if not check_shim_health():
            logger.warning("HME recovery: shim not healthy — cannot recover")
            return False
        project_engine = RAGProxy("project")
        global_engine = RAGProxy("global")
        shared_model = project_engine.model
        lib_engines = get_lib_engines()
        _startup_error = None
        logger.info("HME: auto-recovered from proxy startup error — shim is now healthy")
        register_critical_failure(
            "startup_recovery",
            "Session started degraded (proxy smoke-test failed) but auto-recovered. "
            "Root cause: shim was running without /rag endpoint (old version). Now healthy.",
            severity="WARNING",
        )
        return True
    except Exception as e:
        logger.warning(f"HME: recovery attempt failed: {e}")
        return False


def _fmt_startup_error(err: Exception) -> str:
    """Format startup error with type, message, and traceback origin."""
    import traceback
    msg = str(err)
    etype = type(err).__name__
    # Get the last frame from the original traceback for location info
    tb_info = ""
    if err.__traceback__:
        tb_lines = traceback.format_tb(err.__traceback__)
        if tb_lines:
            tb_info = f" | origin: {tb_lines[-1].strip()}"
    if not msg:
        msg = "(empty exception message)"
    return f"{etype}: {msg}{tb_info}"


def ensure_ready_sync(timeout: float = 45.0) -> None:
    """Block until background model/engine initialization completes.

    FastMCP runs sync tools via asyncio.to_thread(), so this blocking wait
    is safe — it never blocks the async event loop. Zero-cost after first call.
    """
    if _startup_done is None or _startup_done.is_set():
        if _startup_error:
            # Auto-recover from proxy smoke-test failure if shim is now healthy
            err_str = str(_startup_error)
            if "smoke-test" in err_str or "encode" in err_str:
                _try_recover_from_proxy_error()
            if _startup_error:
                raise RuntimeError(f"HME startup failed: {_fmt_startup_error(_startup_error)}")
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
        raise RuntimeError(f"HME startup failed: {_fmt_startup_error(_startup_error)}")
    if project_engine is None or global_engine is None or shared_model is None:
        raise RuntimeError(
            "HME startup completed but engines are not initialized — "
            "check hme.log for background thread errors"
        )
