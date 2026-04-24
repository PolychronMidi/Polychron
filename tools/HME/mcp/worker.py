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

import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Single source of truth: tools/HME/config/versions.json.
# Bump that file to move the three components (cli/proxy/worker) together.
# A mismatch surfaces via `hme-cli --version`.
def _load_versions() -> dict:
    import json as _j
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "versions.json")
    try:
        with open(_p) as _f:
            return _j.load(_f)
    except Exception as _ver_err:
        # Module-init time — logger isn't set up yet (line ~83). Use stderr.
        print(f"worker: versions.json read failed: {type(_ver_err).__name__}: {_ver_err}", file=__import__("sys").stderr)
        return {}
_VERSIONS = _load_versions()
WORKER_VERSION = _VERSIONS.get("worker", "unknown")
CLI_COMPAT_VERSION = _VERSIONS.get("cli", "unknown")

# Bootstrap (matches main.py)
_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

from hme_env import ENV  # noqa: E402
# Force .env load NOW — before any torch/SentenceTransformer import — so
# values like PYTORCH_CUDA_ALLOC_CONF land in os.environ in time for
# PyTorch's first CUDA initialization. Lazy load (on first ENV.require)
# would happen too late: by then torch has already initialized its
# allocator and silently ignored the env var.
ENV.load()

# Rotate log files before we start writing to them. Without this,
# hme.log / worker.out / daemon.out grow unbounded (hundreds of MB
# observed in real sessions). Safe-to-call-always, never raises.
try:
    from log_rotation import rotate_on_boot as _rotate_logs
    _rotate_logs(ENV.require("PROJECT_ROOT"))
except Exception as _rot_err:
    print(f"worker: log rotation at boot failed (non-fatal): {_rot_err}", file=sys.stderr)


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
            except OSError:  # silent-ok: stale pyc cleanup; best-effort — worst case is one stale bytecode file that rebuilds next run
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

# PROJECT_ROOT MUST be set by the proxy supervisor. Falling back to os.getcwd()
# silently creates duplicate log/ directories wherever the worker was spawned
# from (e.g. tools/HME/log/, tools/HME/mcp/log/) — fragmenting telemetry.
PROJECT_ROOT = ENV.require("PROJECT_ROOT")
if not os.path.isdir(os.path.join(PROJECT_ROOT, "src")):
    raise RuntimeError(
        f"PROJECT_ROOT={PROJECT_ROOT!r} does not look like the Polychron root "
        "(no src/ directory). Refusing to start to avoid orphan log dirs."
    )
_log_dir = os.path.join(PROJECT_ROOT, "log")
os.makedirs(_log_dir, exist_ok=True)
from server.log_config import FlushFileHandler  # noqa: E402

_file_handler = FlushFileHandler(os.path.join(_log_dir, "hme.log"), encoding="utf-8")
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_file_handler)
logger.info("HME worker starting (option-d: proxy-served MCP, no FastMCP)")

PROJECT_DB = ENV.require("HME_RAG_DB_PATH")
GLOBAL_DB = ENV.require("HME_GLOBAL_KB_PATH")
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

# Tool registry (replaces FastMCP)
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

# Background RAG engine load (same as main.py)
_startup_done = threading.Event()
ctx._startup_done = _startup_done
_startup_t0 = time.time()


def _background_load():
    """Direct RAG engine load — no shim, no HTTP hop. `rag_engines` module
    starts its `_load_engines` thread on import; we wait for ready, then wire
    the globals into ctx so tool code sees real engine instances (not an
    HTTP-delegating proxy)."""
    try:
        import rag_engines
        if not rag_engines._engine_ready.wait(timeout=120):
            raise RuntimeError("RAG engines did not load within 120s")
        ctx.project_engine = rag_engines._project_engine
        ctx.global_engine = rag_engines._global_engine
        ctx.shared_model = getattr(rag_engines._project_engine, "text_model", None)
        ctx.lib_engines = dict(rag_engines._lib_engines)
        # Initialize the former-shim backend modules so their handlers work.
        from hme_http_handlers import init_handlers
        from hme_http_store import init_store
        init_handlers(rag_engines._engine_ready, rag_engines._project_engine,
                      rag_engines._global_engine, PROJECT_ROOT)
        init_store(PROJECT_ROOT)
        logger.info(
            f"HME worker ready (direct RAG, shim deprecated) | "
            f"project={PROJECT_ROOT} | libs={list(ctx.lib_engines.keys())}"
        )
        # llama-server lifecycle (arbiter + coder) is owned exclusively by
        # tools/HME/mcp/llamacpp_daemon/ — the worker MUST NOT spawn its
        # own llama-server processes. A duplicate worker-side supervisor
        # caused PID-collision races during /indexing-mode (worker spawned
        # a coder onto the GPU the daemon was trying to use for embedding,
        # OOM-ing the reindex). Only the daemon allocates llama-server VRAM.
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


# Phase-B watchdog — reliable-under-GIL-contention brute-force timeout.
#
# _active_tools maps tool-thread-id → {"name", "start_ts", "hard_kill_s"}.
# _post_tool registers each tool-thread it spawns and deregisters on
# completion. A dedicated watchdog thread polls every 5s; if any
# registered tool has been running longer than its hard_kill_s budget,
# the watchdog sends SIGTERM to os.getpid() — the entire worker process
# exits and the supervisor respawns it. Brute, but OS-signal-driven and
# independent of the GIL, so it fires EVEN WHEN Python's Thread.join
# timeout mechanism is starved.
#
# Why this is necessary: during heavy reasoning synthesis (many threads
# contending for GIL), the HTTP-handler thread that invoked .join(timeout)
# may not get scheduled to check the clock, causing the graceful 504
# path in _post_tool to sleep past deadline indefinitely. Phase-B runs
# in its own thread that does time.sleep(5) (releases GIL and always
# wakes) so it reliably catches stuck tools and breaks out via signal.
_active_tools: dict = {}
_active_tools_lock = threading.Lock()


def _active_tool_register(thread_obj, name: str, start_ts: float, hard_kill_s: float) -> None:
    with _active_tools_lock:
        _active_tools[thread_obj.ident or id(thread_obj)] = {
            "name": name, "start_ts": start_ts, "hard_kill_s": hard_kill_s,
            "thread": thread_obj,
        }


def _active_tool_unregister(thread_obj) -> None:
    with _active_tools_lock:
        _active_tools.pop(thread_obj.ident or id(thread_obj), None)


def _watchdog_loop():
    """Poll every 5s. If any tool has been running longer than its
    hard_kill_s budget, SIGTERM self so the supervisor respawns."""
    import signal
    while True:
        try:
            time.sleep(5)
            now = time.time()
            with _active_tools_lock:
                expired = [
                    (tid, entry) for tid, entry in _active_tools.items()
                    if (now - entry["start_ts"]) > entry["hard_kill_s"]
                ]
            if expired:
                for tid, entry in expired:
                    elapsed = now - entry["start_ts"]
                    logger.critical(
                        f"watchdog PHASE B: tool {entry['name']!r} (tid={tid}) has been "
                        f"running {elapsed:.0f}s > hard_kill {entry['hard_kill_s']:.0f}s. "
                        f"Self-terminating worker — supervisor will respawn. "
                        f"Phase A graceful-504 did not fire, likely GIL-starved."
                    )
                # Flush logger before signaling ourselves.
                try:
                    for h in logger.handlers:
                        h.flush()
                except Exception as _flush_err:  # silent-ok: best-effort log flush before self-kill
                    pass
                os.kill(os.getpid(), signal.SIGTERM)
                return
        except Exception as _wd_err:
            logger.warning(f"watchdog loop error: {type(_wd_err).__name__}: {_wd_err}")


threading.Thread(target=_watchdog_loop, daemon=True, name="HME-worker-watchdog").start()


# HTTP server
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
                "/reindex", "/transcript", "/health", "/narrative",
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

    def _post_validate(self, body: dict):
        from hme_http_handlers import _validate
        import concurrent.futures
        query = body.get("query", "")
        if not query:
            self._json(400, {"error": "query required"})
            return
        # Stay under the 5s client timeout: if search takes >3s, return
        # a deferred response rather than letting the client time out.
        # Use cancel_futures=True so shutdown doesn't block on the running thread.
        _exec = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        _fut = _exec.submit(_validate, query)
        try:
            result = _fut.result(timeout=3.0)
        except concurrent.futures.TimeoutError:
            result = {"warnings": [], "blocks": [], "deferred": "search timeout — engine under load"}
        finally:
            _exec.shutdown(wait=False, cancel_futures=True)
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


def main():
    import argparse
    p = argparse.ArgumentParser(description="HME tool worker")
    p.add_argument("--port", type=int, default=ENV.optional_int("HME_MCP_PORT", 9098))
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()

    server = _ThreadingServer((args.host, args.port), _Handler)
    logger.info(f"HME worker listening on http://{args.host}:{args.port}")
    print(f"HME worker listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:  # silent-ok: normal CTRL-C shutdown; no error to propagate
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
