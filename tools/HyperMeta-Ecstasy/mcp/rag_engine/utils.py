from functools import lru_cache
from collections import OrderedDict
import threading
import time
import hashlib

BATCH_SIZE = 64
CACHE_TTL = 300  # 5 minutes


class _TTLCache:
    """Simple thread-safe LRU cache with TTL expiry."""

    def __init__(self, maxsize: int = 256, ttl: float = CACHE_TTL):
        self._maxsize = maxsize
        self._ttl = ttl
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._data:
                return None
            value, ts = self._data[key]
            if time.time() - ts > self._ttl:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key, value):
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = (value, time.time())
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def invalidate(self):
        with self._lock:
            self._data.clear()


def _chunk_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _file_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _bm25_search(corpus: list[str], query: str, top_k: int) -> list[tuple[int, float]]:
    """BM25 keyword search over corpus. Returns (index, score) pairs sorted by score desc."""
    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        return []
    tokenized_corpus = [doc.lower().split() for doc in corpus]
    bm25 = BM25Okapi(tokenized_corpus)
    scores = bm25.get_scores(query.lower().split())
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [(i, float(scores[i])) for i in top_indices if scores[i] > 0]


def _rrf_fuse(semantic_ranked: list[int], bm25_ranked: list[int], k: int = 60) -> list[int]:
    """Reciprocal Rank Fusion of two ranked lists. Returns merged indices by score desc."""
    scores: dict[int, float] = {}
    for rank, idx in enumerate(semantic_ranked):
        scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    for rank, idx in enumerate(bm25_ranked):
        scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda i: scores[i], reverse=True)


def _cross_encode_rerank(query: str, rows: list, text_key, fallback_score_key: str = "_distance") -> list[tuple]:
    """Cross-encoder reranking. Falls back to semantic score if model unavailable."""
    try:
        from sentence_transformers import CrossEncoder
        model = _get_cross_encoder()
        pairs = [(query, text_key(r)) for r in rows]
        scores = model.predict(pairs)
        ranked = sorted(zip(rows, scores.tolist()), key=lambda x: x[1], reverse=True)
        return [(r, float(s)) for r, s in ranked]
    except Exception:
        return [(r, float(1.0 / (1.0 + r.get(fallback_score_key, 0)))) for r in rows]


_cross_encoder_instance = None
_cross_encoder_lock = threading.Lock()


def _get_cross_encoder():
    global _cross_encoder_instance
    if _cross_encoder_instance is None:
        with _cross_encoder_lock:
            if _cross_encoder_instance is None:
                from sentence_transformers import CrossEncoder
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                _cross_encoder_instance = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-12-v2", device=device)
    return _cross_encoder_instance


def _sanitize(value: str) -> str:
    return value.replace("'", "''")
