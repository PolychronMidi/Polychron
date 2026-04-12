from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import lancedb
    from sentence_transformers import SentenceTransformer
import logging
import os
import threading

from .utils import CACHE_TTL, _TTLCache
from .schemas import _code_schema, _knowledge_schema, _symbol_schema
from .knowledge import RAGKnowledgeMixin
from .engine_persistence import RAGEnginePersistenceMixin
from .engine_indexing import RAGEngineIndexingMixin
from .engine_search import RAGEngineSearchMixin
from .engine_symbols import RAGEngineSymbolsMixin

logger = logging.getLogger(__name__)


def _pick_embed_device() -> str:
    """Pick best device for embedding model: CUDA if >=800MB free, else CPU."""
    try:
        import torch
        if torch.cuda.is_available():
            # Prefer the GPU with the most free memory (avoid stealing from active inference)
            best_idx, best_free = 0, 0
            for i in range(torch.cuda.device_count()):
                free, _ = torch.cuda.mem_get_info(i)
                if free > best_free:
                    best_free, best_idx = free, i
            if best_free >= 800 * 1024 * 1024:  # need at least 800MB free
                return f"cuda:{best_idx}"
    except Exception:
        pass
    return "cpu"


class RAGEngine(
    RAGEnginePersistenceMixin,
    RAGEngineIndexingMixin,
    RAGEngineSearchMixin,
    RAGEngineSymbolsMixin,
    RAGKnowledgeMixin,
):
    def __init__(self, db_path: str, model_name: str = "all-mpnet-base-v2", model: "Optional[SentenceTransformer]" = None):
        import lancedb as _lancedb
        self.db_path = db_path
        self.db = _lancedb.connect(db_path)
        if model is None:
            from sentence_transformers import SentenceTransformer as _ST
            _device = _pick_embed_device()
            try:
                model = _ST(model_name, device=_device)
                logger.info(f"Embedding model on {_device}")
            except Exception as e:
                logger.warning(f"Embedding model failed on {_device}, falling back to cpu: {e}")
                model = _ST(model_name, device="cpu")
                _device = "cpu"
        else:
            _device = str(getattr(getattr(model, "device", None), "type", "cpu"))
        self.model = model
        self._embed_batch_size = 256 if _device.startswith("cuda") else 64
        # Dynamic vector dimension from the actual model
        self._dim = self.model.get_sentence_embedding_dimension()
        self._code_schema = _code_schema(self._dim)
        self._knowledge_schema = _knowledge_schema(self._dim)
        self._symbol_schema = _symbol_schema(self._dim)
        self.table = None
        self.knowledge_table = None
        self.symbol_table = None
        self.hash_cache_path = os.path.join(db_path, "file_hashes.json")
        self._file_hashes: dict[str, str] = {}
        self._chunk_hashes: set[str] = set()  # chunk-level dedup
        self._per_file_chunks: dict[str, set[str]] = {}  # file_key -> chunk content hashes
        self._search_cache = _TTLCache(maxsize=256, ttl=CACHE_TTL)
        self._knowledge_cache = _TTLCache(maxsize=128, ttl=CACHE_TTL)
        self._module_embed_cache = _TTLCache(maxsize=512, ttl=CACHE_TTL)  # module-name → vector
        self._access_log: dict[str, int] = {}  # FSRS-6: per-entry retrieval count (persisted to knowledge_access.json)
        self._index_lock = threading.Lock()
        self._bulk_indexing = threading.Event()
        self._token_cache: dict[int, int] = {}
        self._load_hashes()
        self._load_per_file_chunks()
        self._try_open_table()
        self._try_open_knowledge_table()
        self._try_open_symbol_table()
        self._validate_cache()
        self._rebuild_chunk_hashes()
        self._load_access_log()

    def get_status(self) -> dict:
        self._try_open_table()
        if self.table is None:
            return {"indexed": False, "total_chunks": 0, "total_files": 0}
        try:
            count = self.table.count_rows()
        except Exception as e:
            logger.warning(f"get_status count_rows failed: {e}")
            count = 0
        # Use file_hashes as source of truth for file count — resilient to
        # Lance deletion log corruption that crashes to_arrow() full scans.
        sources = len(self._file_hashes)
        return {"indexed": True, "total_chunks": count, "total_files": sources}

    def clear(self):
        with self._index_lock:
            # Suppress watcher re-indexing during clear
            self._clearing = True
            try:
                self.db.drop_table("code_chunks")
            except Exception as e:
                logger.warning(f"drop_table code_chunks: {e}")
            self.table = None
            self._file_hashes = {}
            self._chunk_hashes = set()
            self._per_file_chunks = {}
            self._access_log = {}
            self._search_cache.invalidate()
            # Nuclear: delete hash files FIRST, then save empty, then delete again
            for path in (self.hash_cache_path, self._per_file_chunks_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            self._save_hashes()
            self._save_per_file_chunks()
            for path in (self.hash_cache_path, self._per_file_chunks_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            self._clearing = False
