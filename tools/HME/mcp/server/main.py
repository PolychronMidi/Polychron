"""HME MCP server entry point.

Bootstrap order (critical for fast MCP handshake):
  1. Create FastMCP app + populate context (no model needed)
  2. Register all tool decorators
  3. Start background thread to load SentenceTransformer + RAGEngine
  4. mcp.run() — handshake completes instantly; tools block via ensure_ready_sync()
"""
import os
import sys
import logging
import threading

# Ensure the tool root (parent of server/) is on sys.path so that rag_engine,
# file_walker, symbols, etc. are importable regardless of how this script is launched.
_tool_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

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

# --- MCP App (created BEFORE model load so handshake is instant) ---
mcp = FastMCP(
    "HME",
    instructions=(
        "Use search_knowledge before modifying a module to check for existing constraints.\n"
        "Use search_code or find_callers for open-ended code searches (they add KB context that Grep misses).\n"
        "After batch code changes: run index_codebase once. File watcher handles individual saves.\n"
        "After user-confirmed rounds: add_knowledge for calibration anchors and decisions.\n"
        "See doc/HME.md for the full workflow."
    ),
)

# --- Populate shared context for tool modules (mcp set; engines will be set by background thread) ---
from server import context
context.PROJECT_ROOT = PROJECT_ROOT
context.PROJECT_DB = PROJECT_DB
context.mcp = context._LoggingMCP(mcp)  # wrap with request/response logging
context.project_engine = None
context.global_engine = None
context.shared_model = None
context.lib_engines = {}

# --- Register all tools (import triggers @mcp.tool() decorators — no model needed at decorator time) ---
from server import tools_search     # noqa: F401
from server import tools_index      # noqa: F401
from server import tools_knowledge  # noqa: F401
from server import tools_analysis   # noqa: F401

# --- Background model + engine loading ---
_startup_done = threading.Event()
context._startup_done = _startup_done


def _background_load():
    try:
        from sentence_transformers import SentenceTransformer
        from rag_engine import RAGEngine
        from watcher import start_watcher

        try:
            shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, device="cpu",
                                               model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend (CPU-only, GPUs reserved for Ollama)")
        except Exception as e:
            logger.info(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
            shared_model = SentenceTransformer(MODEL_NAME, device="cpu")

        project_engine = RAGEngine(db_path=PROJECT_DB, model=shared_model)
        global_engine = RAGEngine(db_path=GLOBAL_DB, model=shared_model)
        start_watcher(PROJECT_ROOT, project_engine)

        lib_engines: dict = {}
        for _lib_rel in get_lib_dirs():
            _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
            _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
            os.makedirs(_lib_db, exist_ok=True)
            lib_engines[_lib_rel] = RAGEngine(db_path=_lib_db, model=shared_model)
            logger.info(f"Lib engine created: {_lib_rel} -> {_lib_db}")

        context.project_engine = project_engine
        context.global_engine = global_engine
        context.shared_model = shared_model
        context.lib_engines = lib_engines

        from server.startup_validator import validate_startup
        validate_startup(context, PROJECT_ROOT)

        logger.info(f"HME ready | project={PROJECT_ROOT} | project_db={PROJECT_DB} | global_db={GLOBAL_DB} | libs={list(lib_engines.keys())}")
    except Exception as e:
        context._startup_error = e
        import traceback
        logger.error(f"HME background startup failed: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        _startup_done.set()


threading.Thread(target=_background_load, daemon=True, name="HME-startup").start()


def _background_startup_chain():
    """Ordered startup chain — runs after RAG engine is ready.

    Step 1: _init_ollama_models() — load models to correct devices (GPU0, GPU1, CPU)
            in deterministic order before any priming requests fly.
    Step 2: _prime_all_gpus() — sequential KV cache warm (one model at a time,
            yields to interactive between each). Interactive calls jump ahead.
    Step 3: warm_pre_edit_cache() — caller+KB cache for fast before_editing().

    All steps background priority — interactive requests always preempt.
    """
    _startup_done.wait(timeout=90)
    if context.project_engine is None:
        logger.warning("startup chain: RAG engine not ready — skipping Ollama init and prewarm")
        return
    from server.tools_analysis.synthesis_warm import _init_ollama_models, _prime_all_gpus
    from server.tools_analysis.workflow import _warm_pre_edit_cache_sync as warm_pre_edit_cache

    try:
        logger.info("startup chain [1/3]: initializing Ollama models to correct devices...")
        init_result = _init_ollama_models()
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

    try:
        logger.info("startup chain [3/3]: warming pre-edit caller+KB cache...")
        cache_result = warm_pre_edit_cache(max_files=200)
        logger.info(f"startup chain [3/3]: {cache_result}")
    except Exception as _e:
        logger.warning(f"startup chain [3/3] FAILED: {type(_e).__name__}: {_e}")

    logger.info("startup chain complete")


threading.Thread(target=_background_startup_chain, daemon=True, name="HME-startup-chain").start()

if __name__ == "__main__":
    from server.protocol_logging import install as _install_logging
    _install_logging()
    mcp.run(transport="stdio")
