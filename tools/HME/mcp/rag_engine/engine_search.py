"""RAGEngine search mixin — semantic, budgeted, and token-counting search."""
import logging
import os
from typing import Optional

from .utils import _bm25_search, _rrf_fuse, _sanitize

logger = logging.getLogger(__name__)

# Instruction prefixes for asymmetric (instruction-tuned) embedders.
# bge-code-v1 requires a manual prefix per its model card — its
# config_sentence_transformers.json has empty prompts, so prompt_name=
# kwarg is a no-op. Prefix the QUERY only; documents are indexed raw.
# Swap both strings if you change model. Qwen3-Embedding-0.6B has a
# built-in "query" prompt in its config — we call encode(prompt_name=
# "query") for the text model to trigger it automatically.
_CODE_QUERY_PREFIX = os.environ.get(
    "RAG_CODE_QUERY_PREFIX",
    "Given Code or Text, retrieval relevant content\n",
)


def _encode_code_query(code_model, query: str):
    """Encode a user query for code retrieval, applying the required
    bge-code-v1 instruction prefix. Dispatcher transparent — the prefix
    is added on the text BEFORE encode() so it doesn't need special
    support from the _RagDispatcher."""
    return code_model.encode(_CODE_QUERY_PREFIX + query)


def _encode_text_query(text_model, query: str):
    """Encode a query for text/knowledge retrieval. Tries prompt_name=
    'query' first (Qwen3-Embedding-0.6B has a built-in query prompt in
    config_sentence_transformers.json); falls back to raw encode on
    TypeError for models that don't accept the kwarg."""
    try:
        return text_model.encode(query, prompt_name="query")
    except TypeError:
        return text_model.encode(query)


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

        # With a reranker we can afford a wider candidate pool because the cross-encoder
        # will refine the ordering. Without one, 2x is the safe default.
        _rerank_on = (getattr(self, "reranker", None) is not None
                      and os.environ.get("RAG_RERANK", "1") == "1")
        _multiplier = 4 if _rerank_on else 2
        fetch_k = min(top_k * _multiplier, 120 if _rerank_on else 60)
        query_vec = _encode_code_query(self.code_model, query).tolist()
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

        # When rerank is on, keep all fetch_k candidates so the cross-encoder has
        # more to choose from. Without rerank, slice to top_k immediately.
        _rerank_pool = fetch_k if _rerank_on else top_k
        fused = _rrf_fuse(sem_ranked, bm25_ranked)[:_rerank_pool]

        # Filename-boost: if query contains a camelCase/PascalCase token that exactly matches
        # a result's filename, that result should rank first. Handles "crossLayerClimaxEngine
        # tick function" queries where the generic term ("tick") otherwise dominates chunk scoring.
        import re as _re
        query_tokens_lower = {t.lower() for t in _re.findall(r'[A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+', query)
                               if len(t) >= 6}

        results = []
        for i in fused:
            r = sem_rows[i]
            # lance always includes _distance on vector-search rows; None
            # indicates a schema bug, not a legitimate missing field. Use
            # explicit None-check instead of silent `.get(_, default)`.
            _dist = r.get("_distance")
            sem_score = float(1.0 / (1.0 + (0.0 if _dist is None else _dist)))
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

        # Cross-encoder rerank: BGE reranker scores (query, chunk) pairs directly
        # instead of relying on bi-encoder similarity. Typically +5-15% retrieval
        # quality. Runs on top of RRF, so the filename-boost (score=1.5) signal is
        # preserved by blending rather than overwriting.
        if _rerank_on and len(results) > 1:
            try:
                pairs = [(query, r["content"][:2000]) for r in results]
                rerank_scores = self.reranker.predict(pairs, show_progress_bar=False)
                # Normalize reranker logits to [0,1] via sigmoid so they combine
                # cleanly with the sem+bm25 score. bge-reranker outputs are logits
                # roughly in [-10,+10].
                import math
                for r, s in zip(results, rerank_scores):
                    norm = 1.0 / (1.0 + math.exp(-float(s)))
                    # Blend: 70% reranker, 30% retrieval signal (keeps filename boost felt)
                    if r["score"] < 1.4:  # not a filename-boosted exact match
                        r["score"] = 0.7 * norm + 0.3 * r["score"]
                    else:
                        # Exact filename match stays at top, but reranker nudges ties
                        r["score"] = 1.5 + 0.01 * norm
            except Exception as e:
                logger.warning(f"Reranker failed, falling back to RRF score: {e}")

        # AST-aware symbol boost: if the query references a symbol name we have
        # indexed, boost chunks from the defining file (+0.5) and co-located
        # chunks in the same directory (+0.15). Uses the existing symbol table
        # with zero additional inference cost.
        if self.symbol_table is not None:
            try:
                _symbol_tokens = set()
                for tok in _re.findall(r'[A-Za-z_][A-Za-z0-9_]+', query):
                    if len(tok) >= 4 and not tok.islower() and not tok.isupper():
                        _symbol_tokens.add(tok)
                # Also pick up camelCase tokens the filename boost already detected
                _symbol_tokens.update(t for t in _re.findall(r'[A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+', query) if len(t) >= 4)
                _defining_files: set = set()
                _defining_dirs: set = set()
                for sym in _symbol_tokens:
                    hits = self.lookup_symbol(sym)
                    for h in hits[:3]:  # cap: avoid pathological 50-hit expansion
                        _defining_files.add(h["file"])
                        _defining_dirs.add(os.path.dirname(h["file"]))
                if _defining_files:
                    for r in results:
                        if r["source"] in _defining_files:
                            r["score"] += 0.5
                        elif os.path.dirname(r["source"]) in _defining_dirs:
                            r["score"] += 0.15
            except Exception as e:
                logger.warning(f"AST-aware boost failed: {e}")

        results.sort(key=lambda x: -x["score"])
        results = results[:top_k]

        # Auto-KB enrichment: tag each result with relevant knowledge constraints
        # Module-name embeddings are cached to avoid re-encoding the same module name
        # for every search call (up to 30 per call without cache → O(1) with cache).
        if self.knowledge_table is not None:
            for r in results:
                module = os.path.basename(r["source"]).replace(".js", "").replace(".ts", "")
                try:
                    cached_vec = self._module_embed_cache.get(module)
                    if cached_vec is None:
                        cached_vec = _encode_text_query(self.text_model, module).tolist()
                        self._module_embed_cache.set(module, cached_vec)
                    kb_hits = self.knowledge_table.search(cached_vec).limit(2).to_list()
                    # Filter by distance. 999 sentinel (arbitrary large value)
                    # is only used as "definitely bigger than threshold"; the
                    # real lance search rows always include _distance. Use
                    # explicit None check instead of silent .get(_, default).
                    def _kb_keep(h):
                        d = h.get("_distance")
                        return d is not None and d < 1.2
                    kb_tags = [h["title"] for h in kb_hits if _kb_keep(h)]
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
                except Exception as _e:
                    logger.debug(f"count_tokens: cannot read {key_path} ({type(_e).__name__})")
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
                    _body = resp.json()
                    count = _body["input_tokens"] if "input_tokens" in _body else (len(text) // 4)
                    self._token_cache[cache_key] = count
                    return count
            except Exception as _e:
                logger.debug(f"count_tokens: Anthropic API call failed ({type(_e).__name__})")

        # BERT tokenizer: same model already loaded, much more accurate than len//4
        try:
            tok = getattr(self.model, "tokenizer", None)
            if tok is not None:
                count = len(tok.encode(text))
                self._token_cache[cache_key] = count
                return count
        except Exception as _e:
            logger.debug(f"count_tokens: tokenizer probe failed ({type(_e).__name__})")

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
