import lancedb
from sentence_transformers import SentenceTransformer
from pathlib import Path
from typing import Optional
import json
import logging
import os
import threading

from .utils import BATCH_SIZE, CACHE_TTL, _TTLCache, _chunk_hash, _file_hash, _bm25_search, _rrf_fuse, _sanitize
from .schemas import _code_schema, _knowledge_schema, _symbol_schema, _extract_signatures, summarize_chunk
from .knowledge import RAGKnowledgeMixin

from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS
from file_walker import walk_code_files, get_max_file_size

logger = logging.getLogger(__name__)


class RAGEngine(RAGKnowledgeMixin):
    def __init__(self, db_path: str, model_name: str = "all-mpnet-base-v2", model: Optional[SentenceTransformer] = None):
        self.db_path = db_path
        self.db = lancedb.connect(db_path)
        self.model = model or SentenceTransformer(model_name)
        # Dynamic vector dimension from the actual model
        self._dim = self.model.get_sentence_embedding_dimension()
        self._code_schema = _code_schema(self._dim)
        self._knowledge_schema = _knowledge_schema(self._dim)
        self._symbol_schema = _symbol_schema(self._dim)
        self.table: Optional[lancedb.table.Table] = None
        self.knowledge_table: Optional[lancedb.table.Table] = None
        self.symbol_table: Optional[lancedb.table.Table] = None
        self.hash_cache_path = os.path.join(db_path, "file_hashes.json")
        self._file_hashes: dict[str, str] = {}
        self._chunk_hashes: set[str] = set()  # chunk-level dedup
        self._search_cache = _TTLCache(maxsize=256, ttl=CACHE_TTL)
        self._knowledge_cache = _TTLCache(maxsize=128, ttl=CACHE_TTL)
        self._access_log: dict[str, int] = {}  # FSRS-6: per-entry retrieval count for spaced repetition
        self._index_lock = threading.Lock()
        self._load_hashes()
        self._try_open_table()
        self._try_open_knowledge_table()
        self._try_open_symbol_table()
        self._validate_cache()
        self._rebuild_chunk_hashes()

    def _load_hashes(self):
        if os.path.exists(self.hash_cache_path):
            try:
                with open(self.hash_cache_path, "r") as f:
                    self._file_hashes = json.load(f)
            except Exception:
                self._file_hashes = {}

    def _save_hashes(self):
        os.makedirs(os.path.dirname(self.hash_cache_path), exist_ok=True)
        with open(self.hash_cache_path, "w") as f:
            json.dump(self._file_hashes, f)

    def _try_open_table(self):
        try:
            self.table = self.db.open_table("code_chunks")
        except Exception:
            self.table = None

    def _validate_cache(self):
        if self._file_hashes and self.table is None:
            logger.info("Hash cache exists but code_chunks table missing - clearing cache for full re-index")
            self._file_hashes = {}
            self._save_hashes()
        elif self.table is not None and self._file_hashes:
            try:
                table_count = self.table.count_rows()
                if table_count == 0:
                    logger.info("code_chunks table empty but cache non-empty - clearing cache")
                    self._file_hashes = {}
                    self._save_hashes()
            except Exception:
                pass

    def _rebuild_chunk_hashes(self):
        """Populate in-memory chunk hash set from existing table to enable dedup on re-index."""
        if self.table is None:
            return
        try:
            rows = self.table.to_arrow().to_pylist()
            self._chunk_hashes = {_chunk_hash(r["content"]) for r in rows}
        except Exception:
            self._chunk_hashes = set()

    def _collect_files(self, directory: str) -> list[Path]:
        return list(walk_code_files(directory))

    def _batch_encode(self, texts: list[str]) -> list[list[float]]:
        results = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i:i + BATCH_SIZE]
            embeddings = self.model.encode(batch, show_progress_bar=False)
            results.extend(embeddings.tolist())
        return results

    def index_directory(self, directory: str) -> dict:
        with self._index_lock:
            return self._index_directory_locked(directory)

    def _index_directory_locked(self, directory: str) -> dict:
        files = self._collect_files(directory)
        logger.info(f"Collected {len(files)} source files")
        pending_chunks: list[dict] = []
        pending_texts: list[str] = []
        indexed_files = 0
        skipped_files = 0
        new_file_hashes: dict[str, str] = {}

        for file_path in files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                logger.warning(f"Failed to read {file_path}: {e}")
                continue

            file_key = str(file_path)
            content_hash = _file_hash(content)

            if self._file_hashes.get(file_key) == content_hash:
                skipped_files += 1
                continue

            lang = ext_to_lang(file_path.suffix if file_path.suffix else file_path.name)
            from chunker import chunk_by_functions
            chunks = chunk_by_functions(content, lang)

            for chunk in chunks:
                if len(chunk["content"].strip()) < 10:
                    continue
                ch = _chunk_hash(chunk["content"])
                if ch in self._chunk_hashes:
                    continue  # identical chunk already indexed (cross-file dedup)
                self._chunk_hashes.add(ch)
                chunk_id = f"{file_key}:{chunk['start_line']}-{chunk['end_line']}"
                pending_chunks.append({
                    "id": chunk_id,
                    "content": chunk["content"],
                    "source": file_key,
                    "start_line": chunk["start_line"],
                    "end_line": chunk["end_line"],
                    "language": lang,
                })
                pending_texts.append(chunk["content"])

            # Only record hash if at least one chunk was actually added (avoid locking out
            # files whose chunks were all deduped — if the source of those chunks is later
            # deleted, the dedup-only file would be permanently skipped without this guard)
            chunks_added_for_file = sum(1 for c in pending_chunks if c["source"] == file_key)
            if chunks_added_for_file > 0:
                new_file_hashes[file_key] = content_hash
            indexed_files += 1

        if pending_texts:
            logger.info(f"Encoding {len(pending_texts)} chunks...")
            vectors = self._batch_encode(pending_texts)
            for chunk, vec in zip(pending_chunks, vectors):
                chunk["vector"] = vec

        if pending_chunks:
            if self.table is not None:
                stale_sources = {c["source"] for c in pending_chunks}
                try:
                    existing = self.table.to_arrow()
                    source_col = existing.column("source").to_pylist()
                    keep_mask = [s not in stale_sources for s in source_col]
                    keep_table = existing.filter(keep_mask)
                    merged = keep_table.to_pylist()
                    merged.extend(pending_chunks)
                    self.table = self.db.create_table("code_chunks", data=merged, schema=self._code_schema, mode="overwrite")
                except Exception as e:
                    logger.error(f"Table merge failed, writing new chunks only: {e}")
                    self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")
            else:
                self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")

        # Only update file hashes after successful table write
        self._file_hashes.update(new_file_hashes)
        self._save_hashes()
        if pending_chunks:
            self._search_cache.invalidate()
            # Rebuild chunk hashes from actual table state to fix stale entries
            self._rebuild_chunk_hashes()

        return {
            "total_files": len(files),
            "indexed": indexed_files,
            "skipped_unchanged": skipped_files,
            "chunks_created": len(pending_chunks),
        }

    @staticmethod
    def _sanitize(value: str) -> str:
        return _sanitize(value)

    def search(self, query: str, top_k: int = 10, language: Optional[str] = None) -> list[dict]:
        if self.table is None:
            return []

        cache_key = (query, top_k, language)
        cached = self._search_cache.get(cache_key)
        if cached is not None:
            return cached

        # Semantic search: fetch 2x candidates for RRF headroom
        fetch_k = min(top_k * 2, 60)
        query_vec = self.model.encode(query).tolist()
        builder = self.table.search(query_vec).limit(fetch_k)
        if language:
            builder = builder.where(f"language = '{_sanitize(language)}'")
        try:
            sem_rows = builder.to_list()
        except Exception as e:
            logger.error(f"Semantic search failed: {e}")
            return []

        if not sem_rows:
            return []

        # BM25 search over same candidate set (avoids full-table BM25 cost)
        corpus = [r["content"] for r in sem_rows]
        bm25_hits = _bm25_search(corpus, query, top_k=fetch_k)
        bm25_ranked = [i for i, _ in bm25_hits]
        sem_ranked = list(range(len(sem_rows)))

        fused = _rrf_fuse(sem_ranked, bm25_ranked)[:top_k]

        # Filename-boost: if query contains a camelCase/PascalCase token that exactly matches
        # a result's filename, that result should rank first. Handles "crossLayerClimaxEngine
        # tick function" queries where the generic term ("tick") otherwise dominates chunk scoring.
        import re as _re
        query_tokens_lower = {t.lower() for t in _re.findall(r'[A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+', query)
                               if len(t) >= 6}

        results = []
        for i in fused:
            r = sem_rows[i]
            sem_score = float(1.0 / (1.0 + r.get("_distance", 0)))
            bm25_score = next((s for j, s in bm25_hits if j == i), 0.0)
            combined = 0.6 * sem_score + 0.4 * min(bm25_score / 10.0, 1.0)
            fname = os.path.basename(r["source"]).lower().replace(".js", "").replace(".ts", "").replace(".py", "")
            # Exact filename match: score 1.5 (above any natural score ceiling of 1.0) → ranks first
            if fname in query_tokens_lower:
                combined = 1.5
            results.append({
                "content": r["content"],
                "source": r["source"],
                "start_line": r["start_line"],
                "end_line": r["end_line"],
                "language": r["language"],
                "score": combined,
            })

        results.sort(key=lambda x: -x["score"])

        # Auto-KB enrichment: tag each result with relevant knowledge constraints
        if self.knowledge_table is not None:
            for r in results:
                module = os.path.basename(r["source"]).replace(".js", "").replace(".ts", "")
                try:
                    kb_vec = self.model.encode(module).tolist()
                    kb_hits = self.knowledge_table.search(kb_vec).limit(2).to_list()
                    kb_tags = [h["title"] for h in kb_hits if h.get("_distance", 999) < 1.2]
                    if kb_tags:
                        r["kb_constraints"] = kb_tags
                except Exception:
                    pass

        self._search_cache.set(cache_key, results)
        return results

    def _count_tokens(self, text: str) -> int:
        """Count tokens using Anthropic API (free, precise) with char-estimate fallback."""
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        # Also check common key file locations
        if not api_key:
            for key_path in [os.path.expanduser("~/.anthropic/api_key"), os.path.expanduser("~/.config/anthropic/key")]:
                try:
                    api_key = open(key_path).read().strip()
                    if api_key:
                        break
                except Exception:
                    pass
        if api_key and len(text) > 50:
            try:
                import httpx
                resp = httpx.post(
                    "https://api.anthropic.com/v1/messages/count_tokens",
                    headers={"x-api-key": api_key, "content-type": "application/json", "anthropic-version": "2023-06-01"},
                    json={"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": text}]},
                    timeout=3.0
                )
                if resp.status_code == 200:
                    return resp.json().get("input_tokens", len(text) // 4)
            except Exception:
                pass
        return len(text) // 4  # fallback: ~4 chars per token

    def search_budgeted(self, query: str, max_tokens: int = 8000, language: Optional[str] = None) -> list[dict]:
        """Search and pack results into a token budget. Uses Anthropic token counting API when available."""
        # Fetch more candidates than typical to have packing options
        candidates = self.search(query, top_k=30, language=language)
        if not candidates:
            return []
        packed = []
        used_tokens = 0
        for r in candidates:
            chunk_tokens = self._count_tokens(r["content"])
            if used_tokens + chunk_tokens > max_tokens:
                # Try to fit a truncated version if it's high relevance
                if r["score"] > 0.3 and used_tokens + 200 < max_tokens:
                    remaining = max_tokens - used_tokens
                    r = dict(r)
                    r["content"] = r["content"][:remaining * 4] + "\n... (truncated)"
                    r["truncated"] = True
                    packed.append(r)
                    break
                # Skip this chunk but continue to smaller ones
                continue
            packed.append(r)
            used_tokens += chunk_tokens
        return packed

    def get_status(self) -> dict:
        self._try_open_table()
        if self.table is None:
            return {"indexed": False, "total_chunks": 0, "total_files": 0}
        try:
            count = self.table.count_rows()
            arrow_table = self.table.to_arrow()
            sources = len(set(arrow_table.column("source").to_pylist()))
        except Exception:
            count = 0
            sources = 0
        return {"indexed": True, "total_chunks": count, "total_files": sources}

    def clear(self):
        with self._index_lock:
            try:
                self.db.drop_table("code_chunks")
            except Exception:
                pass
            self.table = None
            self._file_hashes = {}
            self._chunk_hashes = set()
            self._access_log = {}
            self._search_cache.invalidate()
            self._save_hashes()

    def _try_open_symbol_table(self):
        try:
            self.symbol_table = self.db.open_table("symbols")
        except Exception:
            self.symbol_table = None

    def index_symbols(self, symbols: list[dict]) -> dict:
        if not symbols:
            return {"indexed": 0}

        records = []
        texts = []
        for s in symbols:
            embed_text = f"{s['kind']} {s['name']} {s['signature']}"
            records.append({
                "id": f"{s['file']}:{s['line']}:{s['name']}",
                "name": s["name"],
                "kind": s["kind"],
                "signature": s["signature"],
                "file": s["file"],
                "line": s["line"],
                "language": s["language"],
            })
            texts.append(embed_text)

        vectors = self._batch_encode(texts)
        for rec, vec in zip(records, vectors):
            rec["vector"] = vec

        self.symbol_table = self.db.create_table(
            "symbols", data=records, schema=self._symbol_schema, mode="overwrite"
        )
        return {"indexed": len(records)}

    def lookup_symbol(self, name: str, kind: str = "", language: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        try:
            rows = self.symbol_table.to_arrow().to_pylist()
            results = []
            name_lower = name.lower()
            for r in rows:
                if r["name"].lower() != name_lower:
                    continue
                if kind and r["kind"] != kind:
                    continue
                if language and r["language"] != language:
                    continue
                results.append({
                    "name": r["name"],
                    "kind": r["kind"],
                    "signature": r["signature"],
                    "file": r["file"],
                    "line": r["line"],
                    "language": r["language"],
                })
            results.sort(key=lambda x: (x["name"].lower() != name_lower, x["kind"], x["file"]))
            return results[:50]
        except Exception as e:
            logger.error(f"Symbol lookup failed: {e}")
            return []

    def search_symbols(self, query: str, top_k: int = 20, kind: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        query_vec = self.model.encode(query).tolist()
        builder = self.symbol_table.search(query_vec).limit(top_k)
        if kind:
            builder = builder.where(f"kind = '{_sanitize(kind)}'")
        try:
            results = builder.to_list()
        except Exception as e:
            logger.error(f"Symbol search failed: {e}")
            return []
        out = []
        for r in results:
            score = float(1.0 / (1.0 + r.get("_distance", 0)))
            if score < 0.40:
                continue
            out.append({
                "name": r["name"],
                "kind": r["kind"],
                "signature": r["signature"],
                "file": r["file"],
                "line": r["line"],
                "language": r["language"],
                "score": score,
            })
        return out

    def get_symbol_status(self) -> dict:
        self._try_open_symbol_table()
        if self.symbol_table is None:
            return {"indexed": False, "total_symbols": 0}
        try:
            count = self.symbol_table.count_rows()
            return {"indexed": True, "total_symbols": count}
        except Exception:
            return {"indexed": False, "total_symbols": 0}
