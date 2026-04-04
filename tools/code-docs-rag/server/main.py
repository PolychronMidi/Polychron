"""code-docs-rag MCP server entry point.

Bootstrap only: logging, model loading, engine creation, tool registration.
"""
import os
import sys
import logging

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logger = logging.getLogger("code-docs-rag")
logger.setLevel(logging.INFO)

from sentence_transformers import SentenceTransformer
from mcp.server.fastmcp import FastMCP
from rag_engine import RAGEngine
from file_walker import init_config, get_lib_dirs
from watcher import start_watcher

# --- Config ---
PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "code-docs-rag")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "code-docs-rag", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "all-mpnet-base-v2")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")

os.makedirs(PROJECT_DB, exist_ok=True)
os.makedirs(GLOBAL_DB, exist_ok=True)
init_config(PROJECT_ROOT)

# --- Model + Engines ---
try:
    shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
    logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
except Exception as e:
    logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
    shared_model = SentenceTransformer(MODEL_NAME)

project_engine = RAGEngine(db_path=PROJECT_DB, model=shared_model)
global_engine = RAGEngine(db_path=GLOBAL_DB, model=shared_model)
_watcher = start_watcher(PROJECT_ROOT, project_engine)

lib_engines: dict[str, RAGEngine] = {}
for _lib_rel in get_lib_dirs():
    _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
    _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
    os.makedirs(_lib_db, exist_ok=True)
    lib_engines[_lib_rel] = RAGEngine(db_path=_lib_db, model=shared_model)
    logger.info(f"Lib engine created: {_lib_rel} -> {_lib_db}")

# --- MCP App ---
mcp = FastMCP(
    "code-docs-rag",
    instructions=(
        "Use search_knowledge before modifying a module to check for existing constraints.\n"
        "Use search_code or find_callers for open-ended code searches (they add KB context that Grep misses).\n"
        "After batch code changes: run index_codebase once. File watcher handles individual saves.\n"
        "After user-confirmed rounds: add_knowledge for calibration anchors and decisions.\n"
        "See doc/code-docs-rag.md for the full workflow."
    ),
)

# --- Populate shared context for tool modules ---
from server import context
context.PROJECT_ROOT = PROJECT_ROOT
context.PROJECT_DB = PROJECT_DB
context.mcp = mcp
context.project_engine = project_engine
context.global_engine = global_engine
context.shared_model = shared_model
context.lib_engines = lib_engines

# --- Register all tools (import triggers @mcp.tool() decorators) ---
from server import tools_search     # noqa: F401
from server import tools_index      # noqa: F401
from server import tools_knowledge  # noqa: F401
from server import tools_analysis   # noqa: F401

logger.info(f"code-docs-rag started | project={PROJECT_ROOT} | project_db={PROJECT_DB} | global_db={GLOBAL_DB} | libs={list(lib_engines.keys())}")

if __name__ == "__main__":
    mcp.run(transport="stdio")
