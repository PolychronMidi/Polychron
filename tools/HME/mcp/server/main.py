"""HME MCP server entry point.

Bootstrap order (critical for fast MCP handshake):
  1. Purge stale .pyc files (Layer 0 prerequisite)
  2. Create FastMCP app + populate context (no model needed)
  3. Register all tool decorators
  4. Start background thread to load SentenceTransformer + RAGEngine
  5. mcp.run() — handshake completes instantly; tools block via ensure_ready_sync()

Self-coherence layers wired here:
  Layer 0  — system_phase transitions (COLD→WARMING→READY/FAILED)
  Layer 1  — SESSION_ID logged at startup for cross-component correlation
  Layer 2  — operational_state.init() at startup; startup timing recorded
  Layer 5  — crash loop detection via ops.is_crash_loop() skips expensive steps
  Layer 11 — intent propagation: proxy monitor pre-warms cache from transcript
"""
import os
import sys
import logging
import threading
import time

# Ensure the tool root (parent of server/) is on sys.path so that rag_engine,
# file_walker, symbols, etc. are importable regardless of how this script is launched.
_tool_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)


def _load_dotenv() -> None:
    """Load .env from project root into os.environ (no dependencies required)."""
    project_root = os.environ.get("PROJECT_ROOT", os.path.dirname(_tool_root))
    env_path = os.path.join(project_root, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:  # don't override existing env
                os.environ[key] = val

_load_dotenv()


def _purge_stale_server_pyc() -> None:
    """Delete .pyc files in server/__pycache__/ whose source .py is newer — prevents stale bytecode."""
    pkg_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server")
    pycache = os.path.join(pkg_dir, "__pycache__")
    if not os.path.isdir(pycache):
        return
    purged = []
    for pyc in os.listdir(pycache):
        if not pyc.endswith(".pyc"):
            continue
        parts = pyc.rsplit(".", 2)  # "module.cpython-312.pyc" → ["module", "cpython-312", "pyc"]
        if len(parts) < 3:
            continue
        src = os.path.join(pkg_dir, parts[0] + ".py")
        pyc_path = os.path.join(pycache, pyc)
        if os.path.exists(src) and os.path.getmtime(src) > os.path.getmtime(pyc_path):
            try:
                os.unlink(pyc_path)
                purged.append(pyc)
            except OSError:
                pass
    if purged:
        print(f"HME startup: purged {len(purged)} stale .pyc(s): {purged}", file=sys.stderr)


_purge_stale_server_pyc()

_stderr_handler = logging.StreamHandler(sys.stderr)
_stderr_handler.setLevel(logging.WARNING)
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[_stderr_handler],
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logger = logging.getLogger("HME")
logger.setLevel(logging.INFO)


# File logger: timestamped request/response log at log/hme.log
_log_dir = os.path.join(os.environ.get("PROJECT_ROOT", os.getcwd()), "log")
os.makedirs(_log_dir, exist_ok=True)
from server.log_config import FlushFileHandler
_file_handler = FlushFileHandler(os.path.join(_log_dir, "hme.log"), encoding="utf-8")
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_file_handler)
logger.info("HME log initialized")

from mcp.server.fastmcp import FastMCP
from file_walker import init_config, get_lib_dirs

# --- Config (no model needed) ---
PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "HME")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HME", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "BAAI/bge-base-en-v1.5")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")

os.makedirs(PROJECT_DB, exist_ok=True)
os.makedirs(GLOBAL_DB, exist_ok=True)
init_config(PROJECT_ROOT)

# --- Layer 2: Initialize operational state before any startup work ---
from server import operational_state as _ops
_ops.init(PROJECT_ROOT)

# --- Layers 13-15: Meta-observer (self-observing monitor + correlator + narrator) ---
from server import meta_observer as _mo
_prior_narrative = _mo.read_startup_narrative()
if _prior_narrative:
    logger.info(f"L15 prior narrative: {_prior_narrative[:200]}")
_mo.start(PROJECT_ROOT)

# --- Layer 0: Transition to WARMING immediately ---
from server import system_phase as _sp
_sp.set_phase(_sp.SystemPhase.WARMING, "main.py starting")

# --- MCP App (created BEFORE model load so handshake is instant) ---
# No instructions= field: the HME plugin's SKILL.md is the single source of truth
# for the tool surface. An instructions block here would either duplicate SKILL.md
# or drift out of sync with it (as it did until 2026-04-14).
mcp = FastMCP("HME")

# --- Populate shared context for tool modules (mcp set; engines will be set by background thread) ---
from server import context
context.PROJECT_ROOT = PROJECT_ROOT
context.PROJECT_DB = PROJECT_DB
context.mcp = context._LoggingMCP(mcp)  # wrap with request/response logging
context.project_engine = None
context.global_engine = None
context.shared_model = None
context.lib_engines = {}

# Layer 1: Log session ID for cross-component correlation
logger.info(f"HME session={context.SESSION_ID} | project={PROJECT_ROOT}")

# --- Register all tools (import triggers @mcp.tool() decorators — no model needed at decorator time) ---
from server import tools_search     # noqa: F401
from server import tools_index      # noqa: F401
from server import tools_knowledge  # noqa: F401
from server import tools_analysis   # noqa: F401

# --- Background model + engine loading ---
_startup_done = threading.Event()
context._startup_done = _startup_done
_startup_t0 = time.time()


def _background_load():
    from server.rag_proxy import (
        RAGProxy, ensure_shim_running, check_shim_rag_capable,
        kill_shim_by_pid, get_lib_engines, start_proxy_monitor,
    )
    try:
        shim_ok = ensure_shim_running()
        if shim_ok and not check_shim_rag_capable():
            # Shim is healthy but lacks /rag (old version) — kill it and start fresh
            logger.warning("Shim healthy but lacks /rag endpoint — killing stale version and restarting")
            kill_shim_by_pid()
            time.sleep(1)
            shim_ok = ensure_shim_running()
        if shim_ok:
            logger.info("RAG delegated to persistent HTTP shim (no local model loading)")
            context.project_engine = RAGProxy("project")
            context.global_engine = RAGProxy("global")
            context.shared_model = context.project_engine.model
            context.lib_engines = get_lib_engines()
            start_proxy_monitor()
            # Ensure llama-server instances are up before the monitor loop
            # starts supervising them. sessionstart.sh handles cold boot from
            # the bash side; this handles MCP process restarts that happen
            # mid-session (e.g. hot-reload, crash recovery).
            try:
                from server import llamacpp_supervisor as _sup
                _sup_status = _sup.ensure_all_running()
                logger.info(f"llamacpp_supervisor: {_sup_status}")
            except Exception as _sup_err:
                logger.warning(f"llamacpp_supervisor startup failed: {type(_sup_err).__name__}: {_sup_err}")
            logger.info(f"HME ready (proxy mode) | project={PROJECT_ROOT} | libs={list(context.lib_engines.keys())}")
        else:
            logger.warning("HTTP shim unavailable — loading RAG engines locally (duplicate, wasteful)")
            from sentence_transformers import SentenceTransformer
            from rag_engine import RAGEngine
            from watcher import start_watcher
            try:
                shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, device="cpu",
                                                   model_kwargs={"file_name": "onnx/model.onnx"})
            except Exception as e:
                logger.info(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
                shared_model = SentenceTransformer(MODEL_NAME, device="cpu")
            context.project_engine = RAGEngine(db_path=PROJECT_DB, model=shared_model)
            context.global_engine = RAGEngine(db_path=GLOBAL_DB, model=shared_model)
            context.shared_model = shared_model
            start_watcher(PROJECT_ROOT, context.project_engine)
            lib_engines: dict = {}
            for _lib_rel in get_lib_dirs():
                _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
                _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
                os.makedirs(_lib_db, exist_ok=True)
                lib_engines[_lib_rel] = RAGEngine(db_path=_lib_db, model=shared_model)
            context.lib_engines = lib_engines
            logger.info(f"HME ready (local mode) | project={PROJECT_ROOT} | libs={list(lib_engines.keys())}")
        from server.startup_validator import validate_startup
        validate_startup(context, PROJECT_ROOT)
        # Layer 0 + 2: record successful startup
        _sp.set_phase(_sp.SystemPhase.READY, "startup validation passed")
        _ops.record_startup_ms((time.time() - _startup_t0) * 1000)
    except Exception as e:
        context._startup_error = e
        _sp.set_phase(_sp.SystemPhase.FAILED, f"{type(e).__name__}: {e}")
        import traceback
        logger.error(f"HME background startup failed: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        _startup_done.set()


threading.Thread(target=_background_load, daemon=True, name="HME-startup").start()


def _background_startup_chain():
    """Ordered startup chain — runs after RAG engine is ready.

    Step 1: _init_local_models() — load models to correct devices (GPU0, GPU1, CPU)
            in deterministic order before any priming requests fly.
    Step 2: _prime_all_gpus() — sequential KV cache warm (one model at a time,
            yields to interactive between each). Interactive calls jump ahead.
    Step 3: warm_pre_edit_cache() — caller+KB cache for fast before_editing().

    Layer 5 (Temporal Rhythm): if crash loop detected, skip expensive steps 1+2
    to avoid wasting resources when the system is clearly in trouble.

    All steps background priority — interactive requests always preempt.
    """
    _startup_done.wait(timeout=90)
    if context.project_engine is None:
        context.register_critical_failure(
            "startup_chain",
            "RAG engine not ready — index may be missing. Run hme_admin(action='index') to rebuild.",
            severity="WARNING",
        )
        return

    # Layer 5: crash loop → skip llama.cpp steps to minimize resource waste
    in_crash_loop = _ops.is_crash_loop()
    if in_crash_loop:
        logger.warning(
            "startup chain [1+2/3]: SKIPPED — crash loop detected "
            f"({_ops.get('shim_crashes_today', 0)} shim crashes, "
            f"{_ops.get('restarts_today', 0)} restarts today)"
        )
    else:
        from server.tools_analysis.synthesis_warm import _init_local_models, _prime_all_gpus

        # Single daemon health gate: if daemon is ready AND all warm caches are fresh, skip steps 1+2.
        _skip_llamacpp_steps = False
        try:
            import urllib.request as _ureq, json as _js
            with _ureq.urlopen(_ureq.Request("http://127.0.0.1:7735/health"), timeout=2) as _r:
                _daemon_status = _js.loads(_r.read())
            _wc = _daemon_status.get("warm_caches", {})
            if _daemon_status.get("status") == "ready" and _wc and all(v.get("fresh") for v in _wc.values()):
                logger.info("startup chain [1+2/3]: daemon ready + all caches fresh — skipping model init and priming")
                _skip_llamacpp_steps = True
        except Exception as _daemon_err:
            logger.debug(f"startup chain: llamacpp daemon unreachable ({type(_daemon_err).__name__}), running init+prime directly")

        if not _skip_llamacpp_steps:
            init_result = ""
            try:
                logger.info("startup chain [1/3]: initializing llama.cpp models to correct devices...")
                init_result = _init_local_models()
                logger.info(f"startup chain [1/3]: {init_result}")
            except Exception as _e:
                context.register_critical_failure(
                    "startup_chain[1/3]",
                    f"Model init crashed: {type(_e).__name__}: {_e}",
                )
                init_result = "FAILED"

            if "FAILED" in init_result:
                logger.warning("startup chain [2/3]: SKIPPED — model init had failures, priming would crash")
            else:
                try:
                    logger.info("startup chain [2/3]: priming warm KV contexts (sequential)...")
                    warm_result = _prime_all_gpus()
                    logger.info(f"startup chain [2/3]: {warm_result}")
                except Exception as _e:
                    context.register_critical_failure(
                        "startup_chain[2/3]",
                        f"Warm priming crashed: {type(_e).__name__}: {_e}",
                    )

    cache_stamp = os.path.join(PROJECT_ROOT, "tmp", "hme-cache-warmed-at")
    skip_warming = False
    try:
        if os.path.exists(cache_stamp):
            age_s = time.time() - os.path.getmtime(cache_stamp)
            if age_s < 600:
                logger.info(f"startup chain [3/3]: skipped — cache warmed {age_s:.0f}s ago (< 600s)")
                skip_warming = True
    except OSError as _stamp_err:
        logger.debug(f"startup chain: cache stamp read failed, falling through to warm: {_stamp_err}")

    if not skip_warming:
        try:
            from server.tools_analysis.workflow import _warm_pre_edit_cache_sync as warm_pre_edit_cache
            logger.info("startup chain [3/3]: warming pre-edit caller+KB cache...")
            cache_result = warm_pre_edit_cache(max_files=200)
            logger.info(f"startup chain [3/3]: {cache_result}")
            os.makedirs(os.path.dirname(cache_stamp), exist_ok=True)
            with open(cache_stamp, "w") as f:
                f.write(str(int(time.time())))
        except Exception as _e:
            context.register_critical_failure(
                "startup_chain[3/3]",
                f"Pre-edit cache warming crashed: {type(_e).__name__}: {_e}",
                severity="WARNING",
            )

    logger.info("startup chain complete")


threading.Thread(target=_background_startup_chain, daemon=True, name="HME-startup-chain").start()
# Wire recovery hook so in-process recovery re-runs the full startup chain (llama.cpp init + priming + cache warm).
context._post_recovery_hook = lambda: threading.Thread(
    target=_background_startup_chain, daemon=True, name="HME-recovery-chain"
).start()

if __name__ == "__main__":
    from server.protocol_logging import install as _install_logging
    _install_logging()
    mcp.run(transport="stdio")
