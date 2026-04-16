#!/usr/bin/env python3
"""HME tool worker — plain HTTP server, no FastMCP.

Reuses main.py's bootstrap (env, pyc purge, RAG engine loading, llamacpp
supervisor) but swaps FastMCP for a dict-backed tool registry. Exposes:

  GET  /health         — readiness probe (used by supervisor)
  GET  /tools/list     — MCP tools/list payload (schema list)
  POST /tool/<name>    — invoke a tool with JSON body as kwargs
                          returns {"ok": true, "result": "..."} or
                          {"ok": false, "error": "...", "trace": "..."}

The proxy's mcp_server/ layer speaks MCP SSE to Claude Code and dispatches
tools/call here via plain HTTP. No stdio, no FastMCP, no uvicorn.

CLI: python3 worker.py [--port 9098]
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Bootstrap (matches main.py) ──────────────────────────────────────────────
_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

from hme_env import ENV  # noqa: E402


def _purge_stale_server_pyc() -> None:
    pkg_dir = os.path.join(_tool_root, "server")
    pycache = os.path.join(pkg_dir, "__pycache__")
    if not os.path.isdir(pycache):
        return
    for pyc in os.listdir(pycache):
        if not pyc.endswith(".pyc"):
            continue
        parts = pyc.rsplit(".", 2)
        if len(parts) < 3:
            continue
        src = os.path.join(pkg_dir, parts[0] + ".py")
        pyc_path = os.path.join(pycache, pyc)
        if os.path.exists(src) and os.path.getmtime(src) > os.path.getmtime(pyc_path):
            try:
                os.unlink(pyc_path)
            except OSError:
                pass


_purge_stale_server_pyc()

_stderr_handler = logging.StreamHandler(sys.stderr)
_stderr_handler.setLevel(logging.WARNING)
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[_stderr_handler],
)
for _noisy in ("httpx", "httpcore", "sentence_transformers", "huggingface_hub"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger("HME")
logger.setLevel(logging.INFO)

PROJECT_ROOT = ENV.optional("PROJECT_ROOT", os.getcwd())
_log_dir = os.path.join(PROJECT_ROOT, "log")
os.makedirs(_log_dir, exist_ok=True)
from server.log_config import FlushFileHandler  # noqa: E402

_file_handler = FlushFileHandler(os.path.join(_log_dir, "hme.log"), encoding="utf-8")
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_file_handler)
logger.info("HME worker starting (option-d: proxy-served MCP, no FastMCP)")

PROJECT_DB = ENV.require("HME_RAG_DB_PATH")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HME", "global_kb")
MODEL_NAME = ENV.require("HME_MODEL_TEXT_EMBED")
MODEL_BACKEND = ENV.require("HME_RAG_BACKEND")

os.makedirs(PROJECT_DB, exist_ok=True)
os.makedirs(GLOBAL_DB, exist_ok=True)
from file_walker import init_config, get_lib_dirs  # noqa: E402

init_config(PROJECT_ROOT)

from server import operational_state as _ops  # noqa: E402

_ops.init(PROJECT_ROOT)

from server import meta_observer as _mo  # noqa: E402

_prior_narrative = _mo.read_startup_narrative()
if _prior_narrative:
    logger.info(f"L15 prior narrative: {_prior_narrative[:200]}")
_mo.start(PROJECT_ROOT)

from server import system_phase as _sp  # noqa: E402

_sp.set_phase(_sp.SystemPhase.WARMING, "worker.py starting")

# ── Tool registry (replaces FastMCP) ─────────────────────────────────────────
from server import context as ctx  # noqa: E402
from server.tool_registry import Registry, call as tool_call, list_schemas, names  # noqa: E402

ctx.PROJECT_ROOT = PROJECT_ROOT
ctx.PROJECT_DB = PROJECT_DB
ctx.mcp = Registry()
ctx.project_engine = None
ctx.global_engine = None
ctx.shared_model = None
ctx.lib_engines = {}

logger.info(f"HME session={ctx.SESSION_ID} | project={PROJECT_ROOT}")

# Register tools (imports trigger @ctx.mcp.tool() → Registry.tool()).
from server import tools_search  # noqa: E402, F401
from server import tools_index  # noqa: E402, F401
from server import tools_knowledge  # noqa: E402, F401
from server import tools_analysis  # noqa: E402, F401

logger.info(f"registered tools: {names()}")

# ── Background RAG engine load (same as main.py) ─────────────────────────────
_startup_done = threading.Event()
ctx._startup_done = _startup_done
_startup_t0 = time.time()


def _background_load():
    from server.rag_proxy import (
        RAGProxy, ensure_shim_running, check_shim_rag_capable,
        kill_shim_by_pid, get_lib_engines, start_proxy_monitor,
    )
    try:
        shim_ok = ensure_shim_running()
        if shim_ok and not check_shim_rag_capable():
            logger.warning("Shim healthy but lacks /rag — killing stale version and restarting")
            kill_shim_by_pid()
            time.sleep(1)
            shim_ok = ensure_shim_running()
        if shim_ok:
            ctx.project_engine = RAGProxy("project")
            ctx.global_engine = RAGProxy("global")
            ctx.shared_model = ctx.project_engine.model
            ctx.lib_engines = get_lib_engines()
            start_proxy_monitor()
            try:
                from server import llamacpp_supervisor as _sup
                _sup_status = _sup.ensure_all_running()
                logger.info(f"llamacpp_supervisor: {_sup_status}")
            except Exception as _sup_err:
                logger.warning(f"llamacpp_supervisor startup failed: {type(_sup_err).__name__}: {_sup_err}")
            logger.info(f"HME worker ready (proxy mode) | libs={list(ctx.lib_engines.keys())}")
        else:
            logger.warning("HTTP shim unavailable — worker running in degraded mode")
        from server.startup_validator import validate_startup
        validate_startup(ctx, PROJECT_ROOT)
        _sp.set_phase(_sp.SystemPhase.READY, "startup validation passed")
        _ops.record_startup_ms((time.time() - _startup_t0) * 1000)
    except Exception as e:
        ctx._startup_error = e
        _sp.set_phase(_sp.SystemPhase.FAILED, f"{type(e).__name__}: {e}")
        import traceback
        logger.error(f"HME worker background startup failed: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        _startup_done.set()


threading.Thread(target=_background_load, daemon=True, name="HME-worker-startup").start()


# ── HTTP server ─────────────────────────────────────────────────────────────
class _ThreadingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Send access logs to hme.log instead of stderr.
        logger.debug("access " + (fmt % args))

    def _json(self, status: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {
                "status": "ok",
                "phase": _sp.get_phase().value if hasattr(_sp, "get_phase") else "?",
                "ready": _startup_done.is_set(),
                "tools": len(names()),
            })
            return
        if self.path == "/tools/list":
            self._json(200, {"tools": list_schemas()})
            return
        self._json(404, {"error": f"no GET route: {self.path}"})

    def do_POST(self):
        if self.path.startswith("/tool/"):
            name = self.path[len("/tool/"):]
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            try:
                args = json.loads(raw) if raw else {}
            except json.JSONDecodeError as je:
                self._json(400, {"ok": False, "error": f"bad JSON: {je}"})
                return
            try:
                result = tool_call(name, args)
                self._json(200, {"ok": True, "result": result})
            except KeyError as ke:
                self._json(404, {"ok": False, "error": str(ke)})
            except Exception as ex:
                import traceback
                self._json(500, {
                    "ok": False,
                    "error": f"{type(ex).__name__}: {ex}",
                    "trace": traceback.format_exc()[-2000:],
                })
            return
        self._json(404, {"error": f"no POST route: {self.path}"})


def main():
    import argparse
    p = argparse.ArgumentParser(description="HME tool worker")
    p.add_argument("--port", type=int, default=int(os.environ.get("HME_MCP_PORT", "9098")))
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()

    server = _ThreadingServer((args.host, args.port), _Handler)
    logger.info(f"HME worker listening on http://{args.host}:{args.port}")
    print(f"HME worker listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
