"""RAGEngine search mixin — semantic, budgeted, and token-counting search."""
import logging
import os
from typing import Optional

from .utils import _bm25_search, _rrf_fuse, _sanitize

logger = logging.getLogger(__name__)


class RAGEngineSearchMixin:
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
        # Module-name embeddings are cached to avoid re-encoding the same module name
        # for every search call (up to 30 per call without cache → O(1) with cache).
        if self.knowledge_table is not None:
            for r in results:
                module = os.path.basename(r["source"]).replace(".js", "").replace(".ts", "")
                try:
                    cached_vec = self._module_embed_cache.get(module)
                    if cached_vec is None:
                        cached_vec = self.model.encode(module).tolist()
                        self._module_embed_cache.set(module, cached_vec)
                    kb_hits = self.knowledge_table.search(cached_vec).limit(2).to_list()
                    kb_tags = [h["title"] for h in kb_hits if h.get("_distance", 999) < 1.2]
                    if kb_tags:
                        r["kb_constraints"] = kb_tags
                except Exception as e:
                    logger.warning(f"KB enrichment failed for {module}: {e}")

        self._search_cache.set(cache_key, results)
        return results

    def _count_tokens(self, text: str) -> int:
        """Count tokens: API (precise) → BERT tokenizer (accurate, free) → char estimate."""
        cache_key = hash(text)
        if cache_key in self._token_cache:
            return self._token_cache[cache_key]

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
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
                    count = resp.json().get("input_tokens", len(text) // 4)
                    self._token_cache[cache_key] = count
                    return count
            except Exception:
                pass

        # BERT tokenizer: same model already loaded, much more accurate than len//4
        try:
            tok = getattr(self.model, "tokenizer", None)
            if tok is not None:
                count = len(tok.encode(text))
                self._token_cache[cache_key] = count
                return count
        except Exception:
            pass

        count = len(text) // 4
        self._token_cache[cache_key] = count
        return count

    def search_budgeted(self, query: str, max_tokens: int = 8000, language: Optional[str] = None) -> list[dict]:
        """Search and pack results into a token budget. Reads pre-indexed token_count when available."""
        # Fetch more candidates than typical to have packing options
        candidates = self.search(query, top_k=30, language=language)
        if not candidates:
            return []
        packed = []
        used_tokens = 0
        for r in candidates:
            # Prefer stored token_count (zero-cost), fall back to in-memory cache / BERT / estimate
            chunk_tokens = r.get("token_count") or self._count_tokens(r["content"])
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
