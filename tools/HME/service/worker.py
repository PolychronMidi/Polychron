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


def _bounded_validate(query: str) -> dict:
    """Gate _validate calls through a semaphore so concurrent timeouts
    can't pile up more in-flight engine calls than pool slots."""
    from hme_http_handlers import _validate as _inner
    if not _VALIDATE_SEMAPHORE.acquire(timeout=2.5):
        return {"warnings": [], "blocks": [],
                "deferred": "validate semaphore exhausted — engine saturated"}
    try:
        return _inner(query)
    finally:
        _VALIDATE_SEMAPHORE.release()

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
# from (e.g. tools/HME/log/, tools/HME/service/log/) — fragmenting telemetry.
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
        # tools/HME/service/llamacpp_daemon/ — the worker MUST NOT spawn its
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

# Re-exports — HTTP handler classes extracted to sibling.
from worker_handler import _ThreadingServer, _Handler  # noqa: F401, E402

def main():
    import argparse
    p = argparse.ArgumentParser(description="HME tool worker")
    p.add_argument("--port", type=int, default=ENV.optional_int("HME_MCP_PORT", 9098))
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()

    server = _ThreadingServer((args.host, args.port), _Handler)
    logger.info(f"HME worker listening on http://{args.host}:{args.port}")
    print(f"HME worker listening on http://{args.host}:{args.port}", flush=True)

    # Filesystem-IPC queue watcher — accepts jobs via tmp/hme-worker-queue/
    # in parallel with the HTTP path. Decouples callers from worker
    # liveness at request time: caller drops a job file, polls for the
    # result, gracefully degrades on timeout. Daemon thread, idempotent
    # start, exits cleanly on process termination.
    try:
        import worker_queue
        worker_queue.start()
    except ImportError:
        # silent-ok: queue watcher is opt-in capability; HTTP path remains
        # primary if the module isn't on the import path for some reason.
        logger.warning("worker_queue module not loadable; queue path disabled")
    except Exception as e:
        logger.warning(f"worker_queue.start failed: {e}; queue path disabled")

    try:
        server.serve_forever()
    except KeyboardInterrupt:  # silent-ok: normal CTRL-C shutdown; no error to propagate
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
