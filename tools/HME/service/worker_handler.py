#!/usr/bin/env python3
"""HME tool worker -- plain HTTP server, no FastMCP.

Reuses main.py's bootstrap (env, pyc purge, RAG engine loading, llamacpp
supervisor) but swaps FastMCP for a dict-backed tool registry. Exposes:

  GET  /health         -- readiness probe (used by supervisor)
  GET  /version        -- {"version": WORKER_VERSION, "cli_compat": CLI_VERSION}
  GET  /tools/list     -- MCP tools/list payload (schema list)
  POST /tool/<name>    -- invoke a tool with JSON body as kwargs
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

# `logger` and `ENV` were referenced as bare module globals in the original
logger = logging.getLogger("HME")
_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)
from hme_env import ENV  # noqa: E402

# Shared thread pool for /validate requests. Previous implementation
_VALIDATE_POOL_SIZE = 2
_VALIDATE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=_VALIDATE_POOL_SIZE, thread_name_prefix="hme-validate")
_VALIDATE_SEMAPHORE = threading.BoundedSemaphore(value=_VALIDATE_POOL_SIZE)

_REINDEX_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="hme-reindex")
_REINDEX_LOCK = threading.Lock()
_REINDEX_STATE = {"running": False, "started_at": 0.0, "files_count": 0, "last_result": None, "last_error": None}




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
        from server.tool_registry import names
        from server import system_phase as _sp
        from worker import _startup_done
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
        from worker import WORKER_VERSION, CLI_COMPAT_VERSION
        self._json(200, {"version": WORKER_VERSION, "cli_compat": CLI_COMPAT_VERSION})

    def do_GET(self):
        if self.path == "/health":            return self._get_health()
        if self.path == "/version":           return self._get_version()
        if self.path == "/tools/list":
            from server.tool_registry import list_schemas
            return self._json(200, {"tools": list_schemas()})
        if self.path == "/capabilities":      return self._get_capabilities()
        if self.path == "/rag/lib-list":      return self._get_rag_lib_list()
        if self.path == "/narrative":         return self._get_narrative()
        if self.path.startswith("/transcript"): return self._get_transcript()
        if self.path == "/reindex/status":     return self._get_reindex_status()
        self._json(404, {"error": f"no GET route: {self.path}"})

    # POST dispatch
    def _read_body(self):
        # Explicit None-check for Content-Length instead of the old
        _cl = self.headers.get("Content-Length")
        length = int(_cl) if _cl is not None else 0
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        if not raw:
            return {}
        return json.loads(raw)

    def _post_tool(self, name: str, args: dict):
        # Lazy imports -- these symbols live on the worker module (which
        from worker_post_handlers import post_tool
        from server.tool_registry import call as tool_call
        from worker import _active_tool_register, _active_tool_unregister
        post_tool(self, name, args, tool_call=tool_call,
                  active_register=_active_tool_register,
                  active_unregister=_active_tool_unregister)

    def _post_rag_dispatch(self, body: dict):
        from worker_post_handlers import post_rag_dispatch
        post_rag_dispatch(self, body)

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
        from worker_post_handlers import post_cascade_predict
        post_cascade_predict(self, body)

    def _post_validate(self, body: dict):
        from worker_post_handlers import post_validate
        from worker import _bounded_validate
        post_validate(self, body, executor=_VALIDATE_EXECUTOR,
                      bounded_validate=_bounded_validate)

    def _post_audit(self, body: dict):
        from hme_http_handlers import _post_audit
        self._json(200, _post_audit(body.get("changed_files", "")))

    def _post_reindex(self, body: dict):
        from hme_http_handlers import _reindex_files
        import time as _t
        files = body.get("files", [])
        if not isinstance(files, list) or not files:
            self._json(400, {"error": "files must be a non-empty list"})
            return
        with _REINDEX_LOCK:
            if _REINDEX_STATE["running"]:
                self._json(202, {"status": "already_running",
                                 "files_count": _REINDEX_STATE["files_count"],
                                 "started_at": _REINDEX_STATE["started_at"]})
                return
            _REINDEX_STATE["running"] = True
            _REINDEX_STATE["started_at"] = _t.time()
            _REINDEX_STATE["files_count"] = len(files)
            _REINDEX_STATE["last_result"] = None
            _REINDEX_STATE["last_error"] = None

        def _run():
            try:
                result = _reindex_files(files)
                with _REINDEX_LOCK:
                    _REINDEX_STATE["last_result"] = result
            except Exception as exc:
                logger.error(f"/reindex bg failed: {type(exc).__name__}: {exc}")
                with _REINDEX_LOCK:
                    _REINDEX_STATE["last_error"] = f"{type(exc).__name__}: {exc}"
            finally:
                with _REINDEX_LOCK:
                    _REINDEX_STATE["running"] = False
        _REINDEX_EXECUTOR.submit(_run)
        self._json(202, {"status": "accepted",
                         "files_count": len(files),
                         "started_at": _REINDEX_STATE["started_at"]})

    def _get_reindex_status(self):
        with _REINDEX_LOCK:
            snapshot = dict(_REINDEX_STATE)
        self._json(200, snapshot)

    def _post_reload_engines(self, body: dict):
        import rag_engines
        device = body.get("device", "")
        if not device:
            self._json(400, {"error": "device required (e.g. 'cuda:1' or 'restore')"})
            return
        if device != "restore" and not device.startswith("cuda:"):
            self._json(400, {"error": f"invalid device '{device}' -- must be 'cuda:N' or 'restore'"})
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
                # creation). Use [] not .get() -- malformed entries throw.
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


