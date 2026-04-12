import json as _json
import logging
import os as _os
import time
import uuid
import numpy as np

from .utils import _TTLCache, _bm25_search, _rrf_fuse, _cross_encode_rerank, _sanitize

logger = logging.getLogger(__name__)

_ACCESS_LOG_SAVE_INTERVAL = 10


class RAGKnowledgeMixin:
    """Mixin providing knowledge base operations for RAGEngine."""

    def _sanitize(self, value: str) -> str:
        return _sanitize(value)

    def _access_log_path(self) -> str:
        return _os.path.join(self.db_path, "knowledge_access.json")

    def _load_access_log(self):
        path = self._access_log_path()
        if not _os.path.exists(path):
            return
        try:
            with open(path) as f:
                data = _json.load(f)
            if isinstance(data, dict):
                self._access_log = data
                logger.info(f"FSRS-6: loaded access log ({len(data)} entries)")
        except Exception as e:
            logger.info(f"FSRS-6: access log load failed: {e}")

    def _save_access_log(self):
        path = self._access_log_path()
        try:
            with open(path, "w") as f:
                _json.dump(self._access_log, f)
        except Exception as e:
            logger.info(f"FSRS-6: access log save failed: {e}")

    _access_log_writes: int = 0

    def _try_open_knowledge_table(self):
        try:
            self.knowledge_table = self.db.open_table("knowledge")
        except Exception:
            self.knowledge_table = None

    def add_knowledge(self, title: str, content: str, category: str = "general", tags: list[str] | None = None, related_to: str = "", relation_type: str = "") -> dict:
        # Prediction error gating: check if this knowledge is redundant, contradictory, or novel
        prediction_action = "store"  # default: novel -> store
        superseded_id = None
        if self.knowledge_table is not None:
            embed_text_check = f"{title}\n{content}"
            check_vec = self.model.encode(embed_text_check).tolist()
            try:
                existing = self.knowledge_table.search(check_vec).limit(3).to_list()
                for ex in existing:
                    similarity = 1.0 / (1.0 + ex.get("_distance", 999))
                    if similarity > 0.85:
                        # Very similar -> merge (redundant)
                        prediction_action = "merge"
                        superseded_id = ex["id"]
                        # Merge content only if new content differs from existing
                        if content.strip() != ex["content"].strip():
                            merged_content = ex["content"] + "\n[Updated] " + content
                        else:
                            merged_content = ex["content"]
                        deleted = False
                        try:
                            self.knowledge_table.delete(f"id = '{_sanitize(ex['id'])}'")
                            deleted = True
                        except Exception:
                            pass
                        if not deleted:
                            # Delete failed — don't proceed with merge to avoid duplicates
                            prediction_action = "store"
                            superseded_id = None
                            break
                        content = merged_content
                        title = ex["title"]  # keep original title
                        category = ex["category"]
                        break
                    elif similarity > 0.78 and category == ex.get("category", ""):
                        # Moderately similar + same category -> supersede only if titles share keywords
                        import re as _re
                        def _title_tokens(t: str) -> set:
                            return {w.lower() for w in _re.findall(r'[a-zA-Z]{4,}', t)
                                    if w.lower() not in {"with", "from", "that", "this", "callers", "module"}}
                        new_tokens = _title_tokens(title)
                        old_tokens = _title_tokens(ex.get("title", ""))
                        if not (new_tokens & old_tokens):
                            # No shared title keywords — different modules, don't supersede
                            break
                        superseded_candidate = ex["id"]
                        deleted = False
                        try:
                            self.knowledge_table.delete(f"id = '{_sanitize(ex['id'])}'")
                            deleted = True
                        except Exception:
                            pass
                        if not deleted:
                            # Delete failed — don't supersede to avoid losing the original
                            break
                        prediction_action = "supersede"
                        superseded_id = superseded_candidate
                        break
            except Exception:
                pass  # gating failure -> store normally

        entry_id = uuid.uuid4().hex[:12]
        tags_str = ",".join(tags) if tags else ""
        # Typed relationship: store as "type:id" for graph traversal
        if related_to:
            rel_tag = f"{relation_type}:{related_to}" if relation_type else related_to
            tags_str = f"{tags_str},{rel_tag}" if tags_str else rel_tag
        if superseded_id and prediction_action == "supersede":
            tags_str = f"{tags_str},supersedes:{superseded_id}" if tags_str else f"supersedes:{superseded_id}"
        embed_text = f"{title}\n{content}"
        vector = self.model.encode(embed_text).tolist()

        record = {
            "id": entry_id,
            "title": title,
            "content": content,
            "category": category,
            "tags": tags_str,
            "timestamp": time.time(),
            "vector": vector,
        }

        if self.knowledge_table is not None:
            self.knowledge_table.add([record])
        else:
            self.knowledge_table = self.db.create_table("knowledge", data=[record], schema=self._knowledge_schema, mode="overwrite")

        self._knowledge_cache.invalidate()
        self._search_cache.invalidate()  # code search results include KB enrichment
        return {"id": entry_id, "title": title, "category": category, "action": prediction_action, "superseded": superseded_id}

    def search_knowledge(self, query: str, top_k: int = 10, category: str | None = None) -> list[dict]:
        if self.knowledge_table is None:
            return []

        cache_key = ("kb", query, top_k, category)
        cached = self._knowledge_cache.get(cache_key)
        if cached:  # don't cache empty results — empty could be stale from pre-init
            return cached

        fetch_k = min(top_k * 3, 30)
        cached_qvec = self._module_embed_cache.get(f"kbq:{query}")
        if cached_qvec is None:
            cached_qvec = self.model.encode(query).tolist()
            self._module_embed_cache.set(f"kbq:{query}", cached_qvec)
        query_vec = cached_qvec
        builder = self.knowledge_table.search(query_vec).limit(fetch_k)
        if category:
            builder = builder.where(f"category = '{_sanitize(category)}'")
        try:
            sem_rows = builder.to_list()
        except Exception as e:
            logger.error(f"Knowledge search failed: {e}")
            return []

        if not sem_rows:
            return []

        # BM25 over combined title+content
        corpus = [f"{r['title']} {r['content']}" for r in sem_rows]
        bm25_hits = _bm25_search(corpus, query, top_k=fetch_k)
        bm25_ranked = [i for i, _ in bm25_hits]
        fused = _rrf_fuse(list(range(len(sem_rows))), bm25_ranked)[:top_k]

        candidates = [sem_rows[i] for i in fused]

        # Cross-encoder reranking for knowledge (prose queries benefit most)
        reranked = _cross_encode_rerank(query, candidates, text_key=lambda r: f"{r['title']} {r['content']}")

        # FSRS-6 inspired spaced repetition: entries decay based on access patterns, not just age.
        # Frequently retrieved entries stay strong; rarely accessed entries fade faster.
        # retrieval_strength = base_decay * access_boost
        now = time.time()
        results = []
        for r, score in reranked:
            age_days = (now - r.get("timestamp", now)) / 86400
            access_count = self._access_log.get(r["id"], 0)
            # Base decay: linear with age (same as before)
            base_decay = 1.05 if age_days < 1 else max(0.5, 1.0 - (age_days - 7) * 0.015) if age_days > 7 else 1.0
            # Access boost: frequently retrieved entries resist decay
            access_boost = min(1.3, 1.0 + access_count * 0.05) if access_count > 0 else 1.0
            # Combined: accessed entries can be up to 1.3x stronger than decay alone
            temporal_factor = base_decay * access_boost
            # Track this retrieval
            self._access_log[r["id"]] = access_count + 1
            staleness_tag = ""
            if age_days > 30 and access_count == 0:
                staleness_tag = " [UNVERIFIED — last confirmed >30d ago]"
            results.append({
                "id": r["id"],
                "title": r["title"] + staleness_tag,
                "content": r["content"],
                "category": r["category"],
                "tags": r["tags"].split(",") if r["tags"] else [],
                "score": max(0.0, score) * temporal_factor,
            })

        # Debounced persistence of access log
        self._access_log_writes = getattr(self, "_access_log_writes", 0) + 1
        if self._access_log_writes >= _ACCESS_LOG_SAVE_INTERVAL:
            self._access_log_writes = 0
            self._save_access_log()

        if results:  # don't cache empty results
            self._knowledge_cache.set(cache_key, results)
        return results

    def remove_knowledge(self, entry_id: str) -> bool:
        if self.knowledge_table is None:
            return False
        try:
            count_before = self.knowledge_table.count_rows()
            self.knowledge_table.delete(f"id = '{_sanitize(entry_id)}'")
            count_after = self.knowledge_table.count_rows()
            if count_after < count_before:
                self._knowledge_cache.invalidate()
                self._search_cache.invalidate()  # code search results include KB enrichment
                return True
            return False  # entry not found
        except Exception as e:
            logger.error(f"Knowledge remove failed: {e}")
            return False

    def list_knowledge_full(self, category: str | None = None) -> list[dict]:
        """Like list_knowledge but includes content + timestamp for health checks."""
        if self.knowledge_table is None:
            return []
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            return [
                {"id": r["id"], "title": r["title"], "content": r.get("content", ""),
                 "category": r["category"], "tags": r.get("tags", ""),
                 "timestamp": r.get("timestamp", 0)}
                for r in rows
            ]
        except Exception:
            return []

    def list_knowledge(self, category: str | None = None) -> list[dict]:
        if self.knowledge_table is None:
            return []
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "category": r["category"],
                    "tags": r["tags"].split(",") if r["tags"] else [],
                }
                for r in rows
            ]
        except Exception:
            return []

    def get_knowledge_status(self) -> dict:
        if self.knowledge_table is None:
            return {"has_knowledge": False, "total_entries": 0, "categories": []}
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            categories = list({r["category"] for r in rows})
            return {
                "has_knowledge": True,
                "total_entries": len(rows),
                "categories": categories,
            }
        except Exception:
            return {"has_knowledge": False, "total_entries": 0, "categories": []}

    def compact_knowledge(self, similarity_threshold: float = 0.85) -> dict:
        similarity_threshold = max(0.5, min(1.0, similarity_threshold))
        if self.knowledge_table is None:
            return {"removed": 0, "kept": 0}

        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
        except Exception:
            return {"removed": 0, "kept": 0}

        if len(rows) < 2:
            return {"removed": 0, "kept": len(rows)}

        vectors = np.array([r["vector"] for r in rows])
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normalized = vectors / norms

        remove_ids = set()
        for i in range(len(rows)):
            if rows[i]["id"] in remove_ids:
                continue
            for j in range(i + 1, len(rows)):
                if rows[j]["id"] in remove_ids:
                    continue
                sim = float(np.dot(normalized[i], normalized[j]))
                if sim >= similarity_threshold:
                    # Remove the older entry; on equal timestamps, remove i (keep the later-indexed j)
                    ts_i = rows[i].get("timestamp", 0)
                    ts_j = rows[j].get("timestamp", 0)
                    older = i if ts_i <= ts_j else j
                    remove_ids.add(rows[older]["id"])

        if remove_ids:
            kept = [r for r in rows if r["id"] not in remove_ids]
            if kept:
                self.knowledge_table = self.db.create_table(
                    "knowledge", data=kept, schema=self._knowledge_schema, mode="overwrite"
                )
            else:
                try:
                    self.db.drop_table("knowledge")
                except Exception:
                    pass
                self.knowledge_table = None

        if remove_ids:
            self._knowledge_cache.invalidate()
            self._search_cache.invalidate()  # code search results include KB enrichment
        return {"removed": len(remove_ids), "kept": len(rows) - len(remove_ids)}

    def export_knowledge(self, category: str | None = None) -> str:
        if self.knowledge_table is None:
            return ""
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
        except Exception:
            return ""

        lines = []
        by_cat: dict[str, list] = {}
        for r in rows:
            by_cat.setdefault(r["category"], []).append(r)

        for cat, entries in sorted(by_cat.items()):
            lines.append(f"## {cat}")
            for e in entries:
                tags = e["tags"] if e["tags"] else ""
                lines.append(f"### {e['title']}" + (f" [{tags}]" if tags else ""))
                lines.append(e["content"])
                lines.append("")

        return "\n".join(lines)
