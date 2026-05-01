#!/usr/bin/env python3
"""HME tool worker — plain HTTP server, no FastMCP.

Reuses main.py's bootstrap (env, pyc purge, RAG engine loading, llamacpp
supervisor) but swaps FastMCP for a dict-backed tool registry. Exposes:

  GET  /health         — readiness probe (used by supervisor)
  GET  /version        — {"version": WORKER_VERSION, "cli_compat": CLI_VERSION}
  GET  /tools/list     — MCP tools/list payload (schema list)
  POST /tool/<name>    — invoke a tool with JSON body as kwargs
                          returns {"ok": true, "result": "..."} or
                          {"ok": false, "error": "...", "trace": "..."}

The proxy's mcp_server/ layer speaks MCP SSE to Claude Code and dispatches
tools/call here via plain HTTP. No stdio, no FastMCP, no uvicorn.

CLI: python3 worker.py [--port 9098]
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Shared thread pool for /validate requests. Previous implementation
# spawned a fresh ThreadPoolExecutor per request with cancel_futures=True,
# but Python threads can't be interrupted — on timeout, the running
# _validate kept executing past the 3s deadline and leaked an engine-
# bound thread. With a bounded shared pool + semaphore, concurrent
# validates are capped, so overload cycles can't accumulate runaway
# workers. Pool size deliberately small; the validate path is inference-
# bound and serialization is fine.
_VALIDATE_POOL_SIZE = 2
_VALIDATE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=_VALIDATE_POOL_SIZE, thread_name_prefix="hme-validate")
_VALIDATE_SEMAPHORE = threading.BoundedSemaphore(value=_VALIDATE_POOL_SIZE)




class _ThreadingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.debug("access " + (fmt % args))

    def _json(self, status: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # Shim-absorbed GET routes
    def _get_transcript(self):
        import urllib.parse
        from hme_http_store import _get_transcript, _transcript_entries
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        minutes = int(params.get("minutes", [30])[0])
        max_entries = int(params.get("max", [50])[0])
        entries = _get_transcript(minutes, max_entries)
        self._json(200, {"entries": entries, "count": len(entries),
                         "total_ingested": len(_transcript_entries)})

    def _get_narrative(self):
        from hme_http_store import _latest_narrative
        self._json(200, {"narrative": _latest_narrative})

    def _get_rag_lib_list(self):
        import rag_engines
        self._json(200, {"keys": list(rag_engines._lib_engines.keys())})

    def _get_capabilities(self):
        import rag_engines
        self._json(200, {
            "endpoints": [
                "/rag", "/enrich", "/enrich_prompt", "/validate", "/audit",
                "/cascade_predict", "/reindex", "/transcript", "/health", "/narrative",
                "/rag/lib-list", "/capabilities", "/tools/list", "/tool/<name>",
            ],
            "rag_ready": rag_engines._engine_ready.is_set() and rag_engines._project_engine is not None,
        })

    def _get_health(self):
        # Unified health: worker tool-registry status + shim-absorbed RAG status.
        import rag_engines
        from hme_http_store import _get_recent_errors, _transcript_entries
        _training_lock = ENV.optional("HME_TRAINING_LOCK", "")
        _training_locked = bool(_training_lock) and os.path.exists(_training_lock)
        rag_ready = rag_engines._engine_ready.is_set() and rag_engines._project_engine is not None
        self._json(200, {
            "status": "ready" if (rag_ready or _training_locked) else ("ok" if _startup_done.is_set() else "loading"),
            "phase": _sp.get_phase().value if hasattr(_sp, "get_phase") else "?",
            "ready": _startup_done.is_set(),
            "rag_ready": rag_ready,
            "training_locked": _training_locked,
            "tools": len(names()),
            "transcript_entries": len(_transcript_entries),
            "recent_errors": _get_recent_errors(minutes=120)[-10:],
            "pid": os.getpid(),
        })

    def _get_version(self):
        self._json(200, {"version": WORKER_VERSION, "cli_compat": CLI_COMPAT_VERSION})

    def do_GET(self):
        if self.path == "/health":            return self._get_health()
        if self.path == "/version":           return self._get_version()
        if self.path == "/tools/list":        return self._json(200, {"tools": list_schemas()})
        if self.path == "/capabilities":      return self._get_capabilities()
        if self.path == "/rag/lib-list":      return self._get_rag_lib_list()
        if self.path == "/narrative":         return self._get_narrative()
        if self.path.startswith("/transcript"): return self._get_transcript()
        self._json(404, {"error": f"no GET route: {self.path}"})

    # POST dispatch
    def _read_body(self):
        # Explicit None-check for Content-Length instead of the old
        # truthy-falsy-fallback idiom — matches the fail-fast style the
        # rest of the codebase uses and passes the Python-bug probe in
        # workflow_audit.
        _cl = self.headers.get("Content-Length")
        length = int(_cl) if _cl is not None else 0
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        if not raw:
            return {}
        return json.loads(raw)

    def _post_tool(self, name: str, args: dict):
        # One INFO line per incoming tool call so hme.log has a trail.
        try:
            _args_preview = json.dumps(args)[:200] if args else ""
        except Exception as _log_err:  # silent-ok: log-line formatting; tool call itself must not fail from log prep
            _args_preview = f"<unserializable: {type(_log_err).__name__}>"
        logger.info(f"/tool/{name} dispatching  args={_args_preview}")
        _tool_t0 = time.time()

        # LAYER 3 WATCHDOG — two-phase, reliable-under-GIL-contention.
        #
        # Phase A (graceful, Thread.join): spawn the tool in a daemon
        # thread and join with timeout_s. If it finishes in time, return
        # normally. If join returns with is_alive()=True, send 504.
        #
        # Phase B (brute, self-SIGTERM): register this thread with the
        # module-level active-tool table. A dedicated watchdog-thread
        # (started at worker boot, see _watchdog_loop) polls every 5s
        # and, if any active tool has exceeded HARD_KILL_SECONDS (default
        # 240s), fires `os.kill(os.getpid(), SIGTERM)` to self-terminate.
        # The supervisor respawns the worker. This exists because Phase A
        # can't actually fire when this handler thread is GIL-starved —
        # `Thread.join(timeout)` relies on the handler thread getting
        # scheduled to check the clock, which doesn't happen reliably
        # when other threads saturate CPU (e.g. during a heavy reasoning
        # synthesis). The watchdog thread runs `time.sleep(5)` which
        # releases the GIL and wakes reliably regardless of other threads'
        # CPU use. OS-level signal delivery is kernel-managed — not
        # blocked by Python's GIL.
        import threading as _th
        import signal as _sig
        timeout_s = float(os.environ.get("HME_TOOL_WATCHDOG_S", "120"))
        hard_kill_s = float(os.environ.get("HME_TOOL_HARDKILL_S", "240"))
        result_box: list = [None, None]  # [value, exception]

        def _runner():
            try:
                result_box[0] = tool_call(name, args)
            except Exception as e:
                result_box[1] = e

        t = _th.Thread(target=_runner, daemon=True, name=f"tool-{name}")
        # Register BEFORE starting so the watchdog sees it immediately.
        _active_tool_register(t, name, _tool_t0, hard_kill_s)
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
                self._json(504, {
                    "ok": False,
                    "error": f"tool {name!r} exceeded {timeout_s:.0f}s wall clock",
                    "watchdog_timeout": True,
                })
                return
            ex = result_box[1]
            _elapsed_ms = (time.time() - _tool_t0) * 1000
            if isinstance(ex, KeyError):
                logger.warning(f"/tool/{name} unknown-tool {_elapsed_ms:.0f}ms")
                self._json(404, {"ok": False, "error": str(ex)})
            elif ex is not None:
                import traceback
                tb = "".join(traceback.format_exception(type(ex), ex, ex.__traceback__))
                logger.warning(f"/tool/{name} FAILED {_elapsed_ms:.0f}ms: {type(ex).__name__}: {ex}")
                self._json(500, {"ok": False, "error": f"{type(ex).__name__}: {ex}",
                                 "trace": tb[-2000:]})
            else:
                logger.info(f"/tool/{name} OK {_elapsed_ms:.0f}ms")
                self._json(200, {"ok": True, "result": result_box[0]})
        finally:
            _active_tool_unregister(t)

    def _post_rag_dispatch(self, body: dict):
        """Generic engine method dispatch. Mirrors hme_http.py's _handle_rag_dispatch."""
        import rag_engines
        engine_name = body.get("engine", "project")
        method = body.get("method", "")
        kwargs = body.get("kwargs", {})
        if not rag_engines._engine_ready.wait(timeout=10):
            self._json(503, {"error": "engines loading"})
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
            self._json(503, {"error": f"{engine_name} engine not ready"})
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
                self._json(400, {"error": f"unknown method: {method}"})
                return
            self._json(200, {"result": result})
        except Exception as e:
            logger.error(f"/rag dispatch {engine_name}.{method}: {type(e).__name__}: {e}")
            self._json(500, {"error": str(e)})

    def _post_enrich(self, body: dict):
        from hme_http_handlers import _enrich
        query = body.get("query", "")
        if not query:
            self._json(400, {"error": "query required"})
            return
        self._json(200, _enrich(query, top_k=int(body.get("top_k", 5))))

    def _post_enrich_prompt(self, body: dict):
        from hme_http_handlers import _enrich_prompt
        prompt = body.get("prompt", "")
        if not prompt:
            self._json(400, {"error": "prompt required"})
            return
        try:
            self._json(200, _enrich_prompt(prompt, body.get("frame", "")))
        except Exception as e:
            logger.error(f"/enrich_prompt unhandled: {e}")
            self._json(200, {"enriched": prompt, "original": prompt, "error": str(e)})

    def _post_cascade_predict(self, body: dict):
        """Phase 6.1 injection arm — wired per peer-review iter 145.

        Middleware calls this on PreToolUse Edit/Write to get a cascade
        prediction for the target file BEFORE the agent makes the edit.
        Records the prediction with `injected=True` so the post-pipeline
        reconciler can distinguish "middleware-surfaced predictions"
        from "agent-queried predictions" when scoring accuracy.

        Body: {"target_file": "<absolute or repo-relative path>"}
        Returns: {"target": <stem>, "predicted": [<stem>, ...], "logged": true}
                 or {"error": "..."} if the file isn't analyzable.
        """
        target = body.get("target_file", "")
        if not target:
            self._json(400, {"error": "target_file required"})
            return
        try:
            from tools_analysis.cascade_analysis import (
                _load_dep_graph, _load_feedback_graph, _log_prediction,
            )
            import os.path as _osp
            # Compute the affected modules deterministically without
            # round-tripping through the full cascade_intel surface.
            stem = _osp.splitext(_osp.basename(target))[0]
            if not stem:
                self._json(400, {"error": "could not derive module stem from target_file"})
                return
            dep = _load_dep_graph()
            fb = _load_feedback_graph()
            affected: list[str] = []
            # Forward callers from dep graph (1 hop)
            for node, info in (dep.get("nodes") or {}).items():
                if not isinstance(info, dict):
                    continue
                # Match either bare stem or path containing stem
                node_stem = _osp.splitext(_osp.basename(node))[0]
                if stem in (info.get("imports") or []) or stem == node_stem:
                    if node_stem and node_stem != stem and node_stem not in affected:
                        affected.append(node_stem)
            # Feedback-loop members
            for loop in (fb.get("loops") or []):
                members = loop.get("members") or []
                if stem in members:
                    for m in members:
                        if m != stem and m not in affected:
                            affected.append(m)
            # Cap to keep injection footer reasonable
            affected = affected[:12]
            _log_prediction(target_module=stem,
                           affected_modules=affected,
                           injected=True)
            self._json(200, {"target": stem, "predicted": affected, "logged": True})
        except Exception as e:
            logger.warning(f"/cascade_predict failed: {type(e).__name__}: {e}")
            self._json(200, {"target": "", "predicted": [], "logged": False,
                             "error": f"{type(e).__name__}: {e}"})

    def _post_validate(self, body: dict):
        # _validate is imported lazily inside _bounded_validate now — keeps
        # the handler hot-path free of the import cycle cost.
        query = body.get("query", "")
        if not query:
            self._json(400, {"error": "query required"})
            return
        # Stay under the 5s client timeout: if search takes >3s, return
        # a deferred response rather than letting the client time out.
        # Previously spawned a fresh ThreadPoolExecutor per request with
        # cancel_futures=True — but Python threads cannot be interrupted,
        # so the running _validate kept executing past the 3s timeout
        # and each overload cycle leaked one engine-bound thread
        # holding model/lock state, compounding GIL contention. Now:
        # shared module-level executor (threads are reused not
        # respawned) + semaphore that caps concurrent in-flight
        # validates so timeout pile-ups can't accumulate runaway workers.
        _fut = _VALIDATE_EXECUTOR.submit(_bounded_validate, query)
        try:
            result = _fut.result(timeout=3.0)
        except concurrent.futures.TimeoutError:
            result = {"warnings": [], "blocks": [], "deferred": "search timeout — engine under load"}
        self._json(200, result)

    def _post_audit(self, body: dict):
        from hme_http_handlers import _post_audit
        self._json(200, _post_audit(body.get("changed_files", "")))

    def _post_reindex(self, body: dict):
        from hme_http_handlers import _reindex_files
        files = body.get("files", [])
        if not isinstance(files, list) or not files:
            self._json(400, {"error": "files must be a non-empty list"})
            return
        self._json(200, _reindex_files(files))

    def _post_reload_engines(self, body: dict):
        import rag_engines
        device = body.get("device", "")
        if not device:
            self._json(400, {"error": "device required (e.g. 'cuda:1' or 'restore')"})
            return
        if device != "restore" and not device.startswith("cuda:"):
            self._json(400, {"error": f"invalid device '{device}' — must be 'cuda:N' or 'restore'"})
            return
        try:
            result = rag_engines.reload_on_device(device)
        except Exception as e:
            logger.error(f"/reload-engines {device}: {type(e).__name__}: {e}")
            self._json(500, {"error": f"{type(e).__name__}: {e}"})
            return
        self._json(500 if result.get("error") else 200, result)

    def _post_transcript(self, body: dict):
        from hme_http_store import _append_transcript
        entries = body.get("entries", [])
        if not isinstance(entries, list):
            self._json(400, {"error": "entries must be a list"})
            return
        self._json(200, {"appended": _append_transcript(entries)})

    def _post_narrative(self, body: dict):
        from hme_http_store import _append_transcript
        import hme_http_store as _store
        _store._latest_narrative = body.get("narrative", "")
        _append_transcript([{
            "type": "narrative", "content": _store._latest_narrative,
            "summary": f"[Digest] {_store._latest_narrative[:100]}",
        }])
        self._json(200, {"ok": True})

    def _post_error(self, body: dict):
        from hme_http_store import _log_error
        source = body.get("source", "unknown")
        message = body.get("message", "")
        if not message:
            self._json(400, {"error": "message required"})
            return
        _log_error(source, message, body.get("detail", ""))
        self._json(200, {"logged": True})

    def _post_clear_errors(self, body: dict):
        """Clear in-memory recent_errors. Used by LIFESAVER-resolved flows to
        prevent stale entries from re-firing at the next SessionStart.
        Optional `older_than_ms` keeps recent entries; default clears all."""
        import hme_http_store as _store
        older_than_ms = body.get("older_than_ms")
        cleared = 0
        with _store._error_lock:
            before = len(_store._error_log)
            if older_than_ms is None:
                _store._error_log = []
            else:
                cutoff = int(time.time() * 1000) - int(older_than_ms)
                # Every entry in _error_log has "ts" (set by _log_error on
                # creation). Use [] not .get() — malformed entries throw.
                _store._error_log = [e for e in _store._error_log if e["ts"] >= cutoff]
            cleared = before - len(_store._error_log)
        self._json(200, {"cleared": cleared, "remaining": len(_store._error_log)})

    def do_POST(self):
        try:
            body = self._read_body()
        except json.JSONDecodeError as je:
            self._json(400, {"ok": False, "error": f"bad JSON: {je}"})
            return

        if self.path.startswith("/tool/"):
            return self._post_tool(self.path[len("/tool/"):], body)

        # Shim-absorbed routes
        if self.path == "/rag":            return self._post_rag_dispatch(body)
        if self.path == "/enrich":         return self._post_enrich(body)
        if self.path == "/enrich_prompt":  return self._post_enrich_prompt(body)
        if self.path == "/cascade_predict": return self._post_cascade_predict(body)
        if self.path == "/validate":       return self._post_validate(body)
        if self.path == "/audit":          return self._post_audit(body)
        if self.path == "/reindex":        return self._post_reindex(body)
        if self.path == "/reload-engines": return self._post_reload_engines(body)
        if self.path == "/transcript":     return self._post_transcript(body)
        if self.path == "/narrative":      return self._post_narrative(body)
        if self.path == "/error":          return self._post_error(body)
        if self.path == "/clear-errors":   return self._post_clear_errors(body)
        self._json(404, {"error": f"no POST route: {self.path}"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


