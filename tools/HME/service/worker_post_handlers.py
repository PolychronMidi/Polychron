"""Standalone POST-handler functions for worker_handler.py.

Each function takes (handler, ...) where `handler` is the BaseHTTPRequestHandler
subclass instance. The handler is responsible for I/O via handler._json().
Extracted from worker_handler.py to reduce module size.
"""
from __future__ import annotations

import concurrent.futures
import json as _json
import logging
import os
import sys
import time

from hme_env import ENV

logger = logging.getLogger("HME.worker")


def _validate_worker_deadline_sec() -> float:
    """Read /validate worker-side soft deadline from the shared config."""
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "config", "timeouts.json")
    try:
        with open(cfg_path) as f:
            return float(_json.load(f).get("validate", {}).get("worker_deferred_sec", 3.0))
    except Exception as e:
        print(f"worker_post_handlers: timeouts.json read failed: {type(e).__name__}: {e}",
              file=sys.stderr)
        return 3.0
_VALIDATE_WORKER_DEADLINE_SEC = _validate_worker_deadline_sec()


def post_tool(handler, name: str, args: dict, *, tool_call,
              active_register, active_unregister) -> None:
    """Dispatch a single MCP tool call with the two-phase watchdog described
    in the boot-time comment. Phase A: graceful Thread.join with HME_TOOL_WATCHDOG_S
    timeout returns 504 if exceeded. Phase B: a separate watchdog thread
    self-SIGTERMs the worker if HME_TOOL_HARDKILL_S is exceeded -- the proxy
    supervisor respawns. This is the only reliable path under GIL-starvation
    (heavy reasoning synthesis can prevent the handler thread from getting
    scheduled to check Thread.join's clock; OS signal delivery isn't blocked
    by Python's GIL)."""
    import json
    import threading as _th
    import traceback

    try:
        _args_preview = json.dumps(args)[:200] if args else ""
    except Exception as _log_err:  # silent-ok: log-line formatting; tool call itself must not fail from log prep
        _args_preview = f"<unserializable: {type(_log_err).__name__}>"
    logger.info(f"/tool/{name} dispatching  args={_args_preview}")
    _tool_t0 = time.time()

    timeout_s = ENV.optional_float("HME_TOOL_WATCHDOG_S", 120.0)
    hard_kill_s = ENV.optional_float("HME_TOOL_HARDKILL_S", 240.0)
    if name == "hme_admin" and isinstance(args, dict) and args.get("action") in {"index", "clear_index"}:
        timeout_s = max(timeout_s, ENV.optional_float("HME_INDEX_WATCHDOG_S", 900.0))
        hard_kill_s = max(hard_kill_s, ENV.optional_float("HME_INDEX_HARDKILL_S", 1200.0))
    result_box: list = [None, None]

    def _runner():
        try:
            result_box[0] = tool_call(name, args)
        except Exception as e:
            # silent-ok: optional fallback path.
            result_box[1] = e

    t = _th.Thread(target=_runner, daemon=True, name=f"tool-{name}")
    active_register(t, name, _tool_t0, hard_kill_s)
    try:
        t.start()
        t.join(timeout=timeout_s)
        if t.is_alive():
            logger.error(
                f"tool {name!r} watchdog (phase A, graceful): exceeded {timeout_s:.0f}s; "
                f"returning 504. Thread leaked; watchdog thread will force-kill worker at "
                f"{hard_kill_s:.0f}s total if tool still running. args keys="
                f"{list(args.keys()) if isinstance(args, dict) else '?'}"
            )
            handler._json(504, {
                "ok": False,
                "error": f"tool {name!r} exceeded {timeout_s:.0f}s wall clock",
                "watchdog_timeout": True,
            })
            return
        ex = result_box[1]
        _elapsed_ms = (time.time() - _tool_t0) * 1000
        if isinstance(ex, KeyError):
            logger.warning(f"/tool/{name} unknown-tool {_elapsed_ms:.0f}ms")
            handler._json(404, {"ok": False, "error": str(ex)})
        elif ex is not None:
            tb = "".join(traceback.format_exception(type(ex), ex, ex.__traceback__))
            logger.warning(f"/tool/{name} FAILED {_elapsed_ms:.0f}ms: {type(ex).__name__}: {ex}")
            handler._json(500, {"ok": False, "error": f"{type(ex).__name__}: {ex}",
                                "trace": tb[-2000:]})
        else:
            logger.info(f"/tool/{name} OK {_elapsed_ms:.0f}ms")
            handler._json(200, {"ok": True, "result": result_box[0]})
    finally:
        active_unregister(t)


def post_rag_dispatch(handler, body: dict) -> None:
    """Generic engine method dispatch. Mirrors hme_http.py's _handle_rag_dispatch."""
    import rag_engines
    engine_name = body.get("engine", "project")
    method = body.get("method", "")
    kwargs = body.get("kwargs", {})
    if not rag_engines._engine_ready.wait(timeout=10):
        handler._json(503, {"error": "engines loading"})
        return
    if engine_name == "project":
        engine = rag_engines._project_engine
    elif engine_name == "global":
        engine = rag_engines._global_engine
    elif engine_name.startswith("lib/"):
        engine = rag_engines._lib_engines.get(engine_name[4:])
    else:
        engine = None
    if engine is None:
        handler._json(503, {"error": f"{engine_name} engine not ready"})
        return
    try:
        if method == "_symbol_table_list":
            result = engine.symbol_table.to_arrow().to_pylist() if engine.symbol_table is not None else []
        elif method == "_encode":
            texts = kwargs.get("texts", [])
            result = engine.text_model.encode(texts).tolist() if engine.text_model is not None else []
        elif method == "_get_file_hashes":
            result = dict(getattr(engine, "_file_hashes", {}))
        elif method == "index_directory":
            result = getattr(engine, method)()
        elif hasattr(engine, method) and callable(getattr(engine, method)):
            result = getattr(engine, method)(**kwargs)
        else:
            handler._json(400, {"error": f"unknown method: {method}"})
            return
        handler._json(200, {"result": result})
    except Exception as e:
        logger.error(f"/rag dispatch {engine_name}.{method}: {type(e).__name__}: {e}")
        handler._json(500, {"error": str(e)})


def post_cascade_predict(handler, body: dict) -> None:
    """Phase 6.1 injection arm. Middleware calls this on PreToolUse Edit/Write
    to surface a cascade prediction for the target file BEFORE the agent makes
    the edit. Records the prediction with `injected=True` so the post-pipeline
    reconciler can distinguish middleware-surfaced predictions from agent-
    queried ones when scoring accuracy."""
    target = body.get("target_file", "")
    if not target:
        handler._json(400, {"error": "target_file required"})
        return
    try:
        from tools_analysis import (
            load_dep_graph as _load_dep_graph,
            load_feedback_graph as _load_feedback_graph,
            log_prediction as _log_prediction,
        )
        import os.path as _osp
        stem = _osp.splitext(_osp.basename(target))[0]
        if not stem:
            handler._json(400, {"error": "could not derive module stem from target_file"})
            return
        dep = _load_dep_graph()
        fb = _load_feedback_graph()
        affected: list[str] = []
        for node, info in (dep.get("nodes") or {}).items():
            if not isinstance(info, dict):
                continue
            node_stem = _osp.splitext(_osp.basename(node))[0]
            if stem in (info.get("imports") or []) or stem == node_stem:
                if node_stem and node_stem != stem and node_stem not in affected:
                    affected.append(node_stem)
        for loop in (fb.get("loops") or []):
            members = loop.get("members") or []
            if stem in members:
                for m in members:
                    if m != stem and m not in affected:
                        affected.append(m)
        affected = affected[:12]
        _log_prediction(target_module=stem,
                        affected_modules=affected,
                        injected=True)
        handler._json(200, {"target": stem, "predicted": affected, "logged": True})
    except BrokenPipeError as e:
        logger.debug(f"/cascade_predict client disconnected: {type(e).__name__}: {e}")
    except Exception as e:
        logger.warning(f"/cascade_predict failed: {type(e).__name__}: {e}")
        handler._json(200, {"target": "", "predicted": [], "logged": False,
                            "error": f"{type(e).__name__}: {e}"})


def post_validate(handler, body: dict, *, executor: concurrent.futures.Executor,
                  bounded_validate) -> None:
    """Soft-deadline /validate: if search exceeds the worker deadline (from
    config/timeouts.json validate.worker_deferred_sec), return deferred rather
    than letting the client time out. Shared executor + semaphore cap in-flight
    calls so timeout pile-ups can't accumulate runaway workers."""
    query = body.get("query", "")
    if not query:
        handler._json(400, {"error": "query required"})
        return
    _fut = executor.submit(bounded_validate, query)
    try:
        result = _fut.result(timeout=_VALIDATE_WORKER_DEADLINE_SEC)
    except concurrent.futures.TimeoutError:
        result = {"warnings": [], "blocks": [], "deferred": "search timeout -- engine under load"}
    handler._json(200, result)
