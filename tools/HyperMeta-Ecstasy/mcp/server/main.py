"""HyperMeta-Ecstasy MCP server entry point.

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

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logger = logging.getLogger("HyperMeta-Ecstasy")
logger.setLevel(logging.INFO)

from mcp.server.fastmcp import FastMCP
from file_walker import init_config, get_lib_dirs

# --- Config (no model needed) ---
PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "HyperMeta-Ecstasy")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HyperMeta-Ecstasy", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "all-mpnet-base-v2")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")

os.makedirs(PROJECT_DB, exist_ok=True)
os.makedirs(GLOBAL_DB, exist_ok=True)
init_config(PROJECT_ROOT)

# --- MCP App (created BEFORE model load so handshake is instant) ---
mcp = FastMCP(
    "HyperMeta-Ecstasy",
    instructions=(
        "Use search_knowledge before modifying a module to check for existing constraints.\n"
        "Use search_code or find_callers for open-ended code searches (they add KB context that Grep misses).\n"
        "After batch code changes: run index_codebase once. File watcher handles individual saves.\n"
        "After user-confirmed rounds: add_knowledge for calibration anchors and decisions.\n"
        "See doc/HyperMeta-Ecstasy.md for the full workflow."
    ),
)

# --- Populate shared context for tool modules (mcp set; engines will be set by background thread) ---
from server import context
context.PROJECT_ROOT = PROJECT_ROOT
context.PROJECT_DB = PROJECT_DB
context.mcp = mcp
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
            shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
        except Exception as e:
            logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
            shared_model = SentenceTransformer(MODEL_NAME)

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

        logger.info(f"HyperMeta-Ecstasy ready | project={PROJECT_ROOT} | project_db={PROJECT_DB} | global_db={GLOBAL_DB} | libs={list(lib_engines.keys())}")

        # Pre-warm system prompt + KB corpus cache so first tool call hits cached blocks
        try:
            from server.tools_analysis import _get_api_key, _warm_cache
            api_key = _get_api_key()
            if api_key:
                _warm_cache(api_key)
        except Exception as _e:
            logger.debug(f"Cache warm skipped: {_e}")
    except Exception as e:
        context._startup_error = e
        logger.error(f"HyperMeta-Ecstasy background startup failed: {e}")
    finally:
        _startup_done.set()


threading.Thread(target=_background_load, daemon=True, name="HyperMeta-Ecstasy-startup").start()

if __name__ == "__main__":
    mcp.run(transport="stdio")
