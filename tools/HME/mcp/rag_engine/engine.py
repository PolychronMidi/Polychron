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
            model = _ST(model_name, device="cpu")
        self.model = model
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
        self._search_cache = _TTLCache(maxsize=256, ttl=CACHE_TTL)
        self._knowledge_cache = _TTLCache(maxsize=128, ttl=CACHE_TTL)
        self._access_log: dict[str, int] = {}  # FSRS-6: per-entry retrieval count (persisted to knowledge_access.json)
        self._index_lock = threading.Lock()
        self._bulk_indexing = threading.Event()
        self._token_cache: dict[int, int] = {}
        self._load_hashes()
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
            arrow_table = self.table.to_arrow()
            sources = len(set(arrow_table.column("source").to_pylist()))
        except Exception as e:
            logger.warning(f"get_status count_rows failed: {e}")
            count = 0
            sources = 0
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
            self._access_log = {}
            self._search_cache.invalidate()
            # Nuclear: delete hash file FIRST, then save empty, then delete again
            try:
                os.remove(self.hash_cache_path)
            except OSError:
                pass
            self._save_hashes()  # writes {} to disk
            try:
                os.remove(self.hash_cache_path)
            except OSError:
                pass
            self._clearing = False
