"""Shared server state — engines, model, config, MCP app instance.

Initialized by main.py at startup. Tool modules import from here.

Self-coherence stack wired here:
  Layer 0 — system_phase: lifecycle state machine
  Layer 2 — operational_state: persistent operational memory
  Layer 4 — failure_genealogy: causal failure trees (replaces flat _critical_failures list)
  Layer 6 — self_narration: rich status narrative prepended to tool responses
  Layer 10 — resonance_detector: cascade detection (called from register_critical_failure)
"""
import os
import time
import uuid
import logging
import threading
import functools
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("HME")

# ── Cross-component session identity (Layer 1) ────────────────────────────────
# Unique per MCP server process lifetime. Passed as X-HME-Session header on all
# shim requests so logs across MCP server, shim, and daemon can be correlated.
SESSION_ID: str = str(uuid.uuid4())[:12]


# ── LIFESAVER: register_critical_failure → failure_genealogy (Layer 4) ────────

def register_critical_failure(
    source: str,
    error: str,
    severity: str = "CRITICAL",
    caused_by: str | None = None,
) -> str:
    """Register a failure that MUST surface in the next tool response.

    Returns the failure_id so callers can link downstream failures with caused_by.
    Calls resonance_detector to detect cascade patterns (Layer 10).
    Also appends to the HME todo list.
    """
    try:
        from server import failure_genealogy as fg
        fid, is_new = fg.record_failure(source, error, severity, caused_by)
    except Exception as _fge:
        fid, is_new = "?", True
        logger.error(f"LIFESAVER failure_genealogy.record_failure failed — failure may be lost: {_fge}")
    # Only log the first occurrence of a dedup group. The count is tracked
    # inside failure_genealogy; the LIFESAVER banner at drain time already
    # shows ×N repeats. Logging every call flooded hme.log (see
    # health_topology coherence-below-threshold stampede).
    if is_new:
        logger.error(f"LIFESAVER QUEUED [{severity}] {source}: {error}" + (f" (#{fid})" if fid != "?" else ""))
    # Layer 10: notify resonance detector
    try:
        from server import resonance_detector as rd
        rd.record_failure_event(source)
    except Exception as _rde:
        logger.warning(f"LIFESAVER resonance_detector.record_failure_event failed: {_rde}")
    # Layer 2: update operational state on shim crash
    if "shim" in source.lower() and severity == "CRITICAL":
        try:
            from server import operational_state as ops
            ops.record_shim_crash()
        except Exception as _opse:
            logger.warning(f"LIFESAVER ops.record_shim_crash failed: {_opse}")
    try:
        from server.tools_analysis.todo import register_todo_from_lifesaver
        register_todo_from_lifesaver(source, error, severity)
    except Exception as _te:
        logger.error(f"LIFESAVER todo append failed (failure still queued): {_te}")
    return fid


def drain_critical_failures() -> str:
    """Drain all queued failures into a LIFESAVER banner string (causal tree format).

    Returns empty string if no failures. Called by _LoggingMCP on every tool response.
    Failures are grouped into causal trees (Layer 4) and deduplicated (×N counts).
    """
    try:
        from server import failure_genealogy as fg
        trees = fg.drain_as_causal_trees()
        return fg.format_tree_as_banner(trees)
    except Exception as e:
        logger.error(f"LIFESAVER drain failed — queued failures may be lost: {e}")
        return f"\n[LIFESAVER DRAIN FAILED: {e} — check hme.log for queued failures]\n"


def is_degraded() -> bool:
    """Return True if system phase is degraded or worse (Layer 0)."""
    try:
        from server import system_phase as sp
        return sp.is_degraded_or_worse()
    except Exception as e:
        logger.warning(f"is_degraded: system_phase check failed: {e}")
        # Fallback to old proxy-state check if phase module not yet loaded
        try:
            from server.rag_proxy import RAGProxy
            if isinstance(project_engine, RAGProxy):
                return bool(project_engine._connection_failed or project_engine._consecutive_404s > 0)
        except Exception as e2:
            logger.warning(f"is_degraded: proxy fallback check also failed: {e2}")
    # Both checks failed — assume degraded (fail-safe: better to show warning than hide it)
    return True


class _LoggingMCP:
    """Wraps FastMCP to add request/response logging and self-coherence banners on every tool call."""

    def __init__(self, inner: FastMCP):
        self._inner = inner

    def tool(self, **kwargs):
        """Decorator that wraps the tool function with logging."""
        original_decorator = self._inner.tool(**kwargs)

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
                    # Per-tool wall-clock. Default 120s; override via
                    # HME_TOOL_TIMEOUT_<NAME> env (e.g. HME_TOOL_TIMEOUT_review=300)
                    # or HME_TOOL_TIMEOUT_DEFAULT. Without this, any tool that
                    # blocks on I/O (llama.cpp hang, DB lock, stuck KB search)
                    # wedges the entire MCP request with no error feedback.
                    import os as _os
                    import concurrent.futures as _cf
                    _per_tool_env = f"HME_TOOL_TIMEOUT_{name}"
                    _default_env = "HME_TOOL_TIMEOUT_DEFAULT"
                    try:
                        _wall = float(_os.environ.get(_per_tool_env)
                                      or _os.environ.get(_default_env)
                                      or "120")
                    except (TypeError, ValueError):
                        _wall = 120.0
                    # wall<=0 disables the timeout — used for long-running tools
                    # that manage their own background work.
                    if _wall <= 0:
                        result = fn(*args, **kwargs)
                    else:
                        _ex = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"hme-tool-{name}")
                        _fut = _ex.submit(fn, *args, **kwargs)
                        try:
                            result = _fut.result(timeout=_wall)
                        except _cf.TimeoutError:
                            elapsed_to = time.time() - t0
                            # Abandon the thread — we can't safely kill a Python
                            # thread, but we can refuse to wait for it.
                            _ex.shutdown(wait=False, cancel_futures=True)
                            logger.error(
                                f"ERR  {name} [{elapsed_to:.1f}s] "
                                f"wall-clock timeout after {_wall}s — thread abandoned"
                            )
                            raise TimeoutError(
                                f"{name} exceeded the {_wall:.0f}s per-tool wall-clock. "
                                f"The worker thread has been abandoned; the next call will "
                                f"run in a fresh thread. If this tool legitimately needs "
                                f"more time, raise HME_TOOL_TIMEOUT_{name} in the shim env."
                            )
                        finally:
                            _ex.shutdown(wait=False)
                    elapsed = time.time() - t0
                    if result is None:
                        logger.error(f"ERR  {name} returned None — tool must return a string")
                        result = f"Error: {name} returned None (bug in tool implementation)"
                    # Layer 2: track tool response time EMA (feeds Layer 7 predictive health)
                    try:
                        from server import operational_state as ops
                        ops.update_ema("tool_response_ms_ema", elapsed * 1000)
                    except (ImportError, AttributeError) as _ema_err:
                        logger.debug(f"operational_state EMA update unavailable: {_ema_err}")
                    # Log immediately — post-processing must not delay this timestamp
                    logger.info(f"RESP {name} [{elapsed:.1f}s] {str(result)[:200]}")
                    # Layer 4: LIFESAVER drain with causal tree format
                    lifesaver_banner = drain_critical_failures()
                    if lifesaver_banner:
                        result = lifesaver_banner + str(result)
                    # Layer 6: rich self-narration — non-blocking (topology refreshes in background)
                    try:
                        from server import self_narration as sn
                        narration = sn.build_status_narrative()
                        if narration:
                            result = narration + str(result)
                    except Exception as _err:
                        logger.debug(f"unnamed-except context.py:152: {type(_err).__name__}: {_err}")
                        # Fallback: bare degraded flag if narration fails
                        if is_degraded():
                            result = "[DEGRADED] RAG proxy unhealthy — shim may be restarting.\n" + str(result)
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
_recovery_last_attempt: float = 0.0  # epoch time of last recovery attempt; 0 = never tried
_RECOVERY_COOLDOWN = 300.0  # seconds before allowing another recovery attempt
_post_recovery_hook = None  # callable set by main.py; triggered after successful in-process recovery


def _try_recover_from_proxy_error() -> bool:
    """Recovery path for proxy-mode startup failures.

    If the MCP server failed startup because the shim was running but didn't yet have
    the /rag endpoint (e.g., old ChatPanel-managed shim), the error is cached and
    every tool call fails. This detects that condition and re-initializes using the
    proxy if the shim is now healthy.

    Retries at most once per _RECOVERY_COOLDOWN seconds so mid-session shim
    restarts can trigger a second recovery without permanently suppressing it.

    Returns True if recovery succeeded.
    """
    global _startup_error, _recovery_last_attempt, project_engine, global_engine, shared_model, lib_engines
    now = time.time()
    if now - _recovery_last_attempt < _RECOVERY_COOLDOWN:
        return False
    _recovery_last_attempt = now

    # Layer 0: transition to RECOVERING
    try:
        from server import system_phase as sp
        sp.set_phase(sp.SystemPhase.RECOVERING, "in-process recovery attempt")
    except (ImportError, AttributeError) as _sp_err:
        logger.debug(f"recovery phase transition unavailable: {_sp_err}")

    try:
        from server.rag_proxy import RAGProxy, check_shim_rag_capable, get_lib_engines
        if not check_shim_rag_capable():
            logger.warning("HME recovery: shim not healthy or lacks /rag — cannot recover")
            try:
                from server import system_phase as sp
                from server import operational_state as ops
                sp.set_phase(sp.SystemPhase.DEGRADED, "shim not rag-capable")
                ops.record_recovery(False)
            except (ImportError, AttributeError) as _rec_err:
                logger.debug(f"recovery: phase/ops unavailable: {_rec_err}")
            return False
        new_project = RAGProxy("project")
        new_global = RAGProxy("global")
        # Self-test: verify proxies actually work before committing
        test_result = new_project.list_knowledge()
        if not isinstance(test_result, list):
            logger.warning(f"HME recovery: proxy self-test failed (list_knowledge returned {type(test_result).__name__}) — aborting")
            try:
                from server import system_phase as sp
                from server import operational_state as ops
                sp.set_phase(sp.SystemPhase.DEGRADED, "proxy self-test failed")
                ops.record_recovery(False)
            except (ImportError, AttributeError) as _st_err:
                logger.debug(f"recovery: self-test fail transition unavailable: {_st_err}")
            return False
        project_engine = new_project
        global_engine = new_global
        shared_model = project_engine.model
        lib_engines = get_lib_engines()
        _startup_error = None

        # Layer 0 + 2: mark READY, record success
        try:
            from server import system_phase as sp
            from server import operational_state as ops
            sp.set_phase(sp.SystemPhase.READY, "proxy self-test passed")
            ops.record_recovery(True)
        except (ImportError, AttributeError) as _ok_err:
            logger.debug(f"recovery: success transition unavailable: {_ok_err}")

        logger.info(f"HME: auto-recovered — shim healthy + /rag verified ({len(test_result)} KB entries)")
        register_critical_failure(
            "startup_recovery",
            f"Session started degraded but auto-recovered ({len(test_result)} KB entries accessible). "
            "Root cause: shim was running without /rag endpoint (old version).",
            severity="WARNING",
        )
        if _post_recovery_hook is not None:
            try:
                _post_recovery_hook()
                logger.info("HME: post-recovery startup chain triggered")
            except Exception as _hk:
                logger.warning(f"HME: post-recovery hook failed: {_hk}")
        return True
    except Exception as e:
        logger.warning(f"HME: recovery attempt failed: {e}")
        try:
            from server import system_phase as sp
            from server import operational_state as ops
            sp.set_phase(sp.SystemPhase.DEGRADED, f"recovery exception: {type(e).__name__}")
            ops.record_recovery(False)
        except (ImportError, AttributeError) as _ex_err:
            logger.debug(f"recovery: exception transition unavailable: {_ex_err}")
        return False


def _fmt_startup_error(err: Exception) -> str:
    """Format startup error with type, message, and traceback origin."""
    import traceback
    msg = str(err)
    etype = type(err).__name__
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
            # Attempt recovery for any startup error — shim restart fixes most proxy failures
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
