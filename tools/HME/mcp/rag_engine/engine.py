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
    """Pick best device for embedding model with VRAM reservation for llama-server.

    llama-server instances can consume ~9-19 GB per GPU. Only land embedding
    models on a GPU that has HME_RAG_MIN_FREE_GB free after those are loaded
    (default: 6 GB, matches shim bge+jina+reranker steady state).
    """
    import os as _os
    _min_free_gb = float(_os.environ.get("HME_RAG_MIN_FREE_GB", "6"))
    try:
        import torch
        if torch.cuda.is_available():
            best_idx, best_free = -1, 0
            for i in range(torch.cuda.device_count()):
                free, _ = torch.cuda.mem_get_info(i)
                if free >= _min_free_gb * (1024 ** 3) and free > best_free:
                    best_free, best_idx = free, i
            if best_idx >= 0:
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
    def __init__(self, db_path: str, model_name: str = "all-mpnet-base-v2",
                 model: "Optional[SentenceTransformer]" = None,
                 code_model: "Optional[SentenceTransformer]" = None,
                 reranker=None):
        """
        model / text_model     — general-text embedder (bge-base-en) for knowledge + symbols.
        code_model             — code-specialized embedder (jina v2 base-code) for code_chunks.
        reranker               — CrossEncoder (bge-reranker-v2-m3) for search rerank.

        `model` is the legacy kwarg; it maps to text_model. If code_model is None
        it falls back to text_model (bge) — guarantees correctness while still
        letting callers opt into the dual-index by passing code_model explicitly.
        """
        import lancedb as _lancedb
        self.db_path = db_path
        self.db = _lancedb.connect(db_path)
        if model is None:
            from sentence_transformers import SentenceTransformer as _ST
            _device = _pick_embed_device()
            try:
                model = _ST(model_name, device=_device)
                logger.info(f"Text embedding model on {_device}")
            except Exception as e:
                logger.warning(f"Text embedding model failed on {_device}, falling back to cpu: {e}")
                model = _ST(model_name, device="cpu")
                _device = "cpu"
        else:
            _device = str(getattr(getattr(model, "device", None), "type", "cpu"))
        self.text_model = model
        self.model = model  # legacy alias — external callers still reference self.model
        self.code_model = code_model if code_model is not None else model
        self.reranker = reranker
        self._embed_batch_size = 256 if _device.startswith("cuda") else 64
        # Dynamic vector dimension from the actual models — both must match the table schema
        self._text_dim = self.text_model.get_sentence_embedding_dimension()
        self._code_dim = self.code_model.get_sentence_embedding_dimension()
        self._dim = self._text_dim  # legacy: some callers read self._dim
        self._code_schema = _code_schema(self._code_dim)
        self._knowledge_schema = _knowledge_schema(self._text_dim)
        self._symbol_schema = _symbol_schema(self._text_dim)
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
