"""RAGEngine indexing mixin — file and directory indexing with chunk-level diffing."""
import logging
import os
from pathlib import Path

from .utils import BATCH_SIZE, _chunk_hash, _file_hash, _sanitize
from lang_registry import ext_to_lang

logger = logging.getLogger(__name__)


class RAGEngineIndexingMixin:
    def _collect_files(self, directory: str) -> list[Path]:
        from file_walker import walk_code_files
        return list(walk_code_files(directory))

    def _batch_encode(self, texts: list[str]) -> list[list[float]]:
        batch_size = getattr(self, "_embed_batch_size", BATCH_SIZE)
        results = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            embeddings = self.model.encode(batch, show_progress_bar=False)
            results.extend(embeddings.tolist())
        return results

    def index_file(self, abs_path: str) -> dict:
        """Index a single file with chunk-level diffing (only re-embeds changed chunks)."""
        with self._index_lock:
            return self._index_file_locked(abs_path)

    def _index_file_locked(self, abs_path: str) -> dict:
        file_path = Path(abs_path)
        file_key = str(file_path)

        if not file_path.exists():
            return self._remove_file_from_index(file_key)

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            return {"indexed": 0, "error": str(e)}

        content_hash = _file_hash(content)
        if self._file_hashes.get(file_key) == content_hash:
            return {"indexed": 0, "skipped_unchanged": 1}

        lang = ext_to_lang(file_path.suffix if file_path.suffix else file_path.name)
        from chunker import chunk_by_functions
        chunks = chunk_by_functions(content, lang)

        # Build new chunk descriptors with content hashes
        new_chunk_descs = []
        for chunk in chunks:
            if len(chunk["content"].strip()) < 10:
                continue
            ch = _chunk_hash(chunk["content"])
            new_chunk_descs.append({
                "_ch": ch,
                "id": f"{file_key}:{chunk['start_line']}-{chunk['end_line']}",
                "content": chunk["content"],
                "source": file_key,
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "language": lang,
                "token_count": len(chunk["content"]) // 4,
            })

        # Clear this file's old chunk hashes to prevent self-dedup
        old_file_chunks = self._per_file_chunks.get(file_key, set())
        self._chunk_hashes -= old_file_chunks

        # Cross-file dedup: skip chunks whose content exists in OTHER files
        deduped = []
        for c in new_chunk_descs:
            if c["_ch"] in self._chunk_hashes:
                continue
            deduped.append(c)

        # Identify chunks that can reuse existing vectors (content unchanged)
        new_hashes = {c["_ch"] for c in deduped}
        reusable_hashes = old_file_chunks & new_hashes

        # Read vectors for reusable chunks from existing table
        reuse_vectors: dict[str, list] = {}
        if reusable_hashes and self.table is not None:
            try:
                existing = self.table.to_arrow()
                src_col = existing.column("source").to_pylist()
                cnt_col = existing.column("content").to_pylist()
                vec_col = existing.column("vector").to_pylist()
                for i, src in enumerate(src_col):
                    if src == file_key:
                        ch = _chunk_hash(cnt_col[i])
                        if ch in reusable_hashes:
                            reuse_vectors[ch] = vec_col[i]
            except Exception as e:
                logger.warning(f"Vector reuse read failed for {file_key}: {e}")

        # Split: need embedding vs can reuse
        need_embed = [c for c in deduped if c["_ch"] not in reuse_vectors]
        can_reuse = [c for c in deduped if c["_ch"] in reuse_vectors]

        # Embed only new/changed chunks
        if need_embed:
            vectors = self._batch_encode([c["content"] for c in need_embed])
            for c, v in zip(need_embed, vectors):
                c["vector"] = v

        # Attach reused vectors
        for c in can_reuse:
            c["vector"] = reuse_vectors[c["_ch"]]

        # Build final rows (strip internal _ch key)
        all_rows = []
        for c in deduped:
            if "vector" not in c:
                continue
            all_rows.append({k: v for k, v in c.items() if k != "_ch"})

        # Update table: delete old file rows, add new
        if self.table is not None:
            try:
                self.table.delete(f"source = '{_sanitize(file_key)}'")
            except Exception as e:
                logger.warning(f"Table delete failed for {file_key}: {e}")

        if all_rows:
            if self.table is not None:
                try:
                    self.table.add(all_rows)
                except Exception as e:
                    logger.error(f"Table add failed for {file_key}, falling back to create: {e}")
                    self.table = self.db.create_table(
                        "code_chunks", data=all_rows, schema=self._code_schema, mode="overwrite"
                    )
            else:
                self.table = self.db.create_table(
                    "code_chunks", data=all_rows, schema=self._code_schema, mode="overwrite"
                )

        # Update caches
        new_file_chunk_set = {c["_ch"] for c in deduped if "vector" in c}
        self._per_file_chunks[file_key] = new_file_chunk_set
        self._chunk_hashes |= new_file_chunk_set
        self._file_hashes[file_key] = content_hash
        self._save_hashes()
        self._save_per_file_chunks()
        if need_embed:
            self._search_cache.invalidate()

        return {
            "indexed": 1,
            "chunks_embedded": len(need_embed),
            "chunks_reused": len(can_reuse),
            "chunks_total": len(all_rows),
        }

    def _remove_file_from_index(self, file_key: str) -> dict:
        """Remove a deleted file's chunks from the index."""
        removed = 0
        if self.table is not None:
            try:
                self.table.delete(f"source = '{_sanitize(file_key)}'")
                removed = 1
            except Exception as e:
                logger.warning(f"Table delete failed for {file_key}: {e}")

        old_chunks = self._per_file_chunks.pop(file_key, set())
        self._chunk_hashes -= old_chunks
        self._file_hashes.pop(file_key, None)
        self._save_hashes()
        self._save_per_file_chunks()
        if removed:
            self._search_cache.invalidate()
        return {"indexed": 0, "removed": removed}

    def index_directory(self, directory: str) -> dict:
        self._bulk_indexing.set()
        try:
            with self._index_lock:
                return self._index_directory_locked(directory)
        finally:
            self._bulk_indexing.clear()

    def _index_directory_locked(self, directory: str) -> dict:
        if getattr(self, '_clearing', False):
            return {"total_files": 0, "indexed": 0, "skipped_unchanged": 0, "chunks_created": 0}
        self._validate_cache()
        files = self._collect_files(directory)
        logger.info(f"Collected {len(files)} source files")

        # Phase 1: identify changed files (read once, cache content for phase 3)
        changed: dict[str, tuple] = {}  # file_key -> (content, file_path, content_hash, lang)
        skipped_files = 0
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
            changed[file_key] = (content, file_path, content_hash, lang)

        # Phase 2: clear chunk hashes for ALL changed files before processing
        # (prevents self-dedup where unchanged chunks in a modified file get
        # incorrectly skipped because their hashes are already in _chunk_hashes)
        for fk in changed:
            self._chunk_hashes -= self._per_file_chunks.get(fk, set())

        # Phase 3: chunk and collect embeddings needed
        pending_chunks: list[dict] = []
        pending_texts: list[str] = []
        indexed_files = 0
        new_file_hashes: dict[str, str] = {}
        new_per_file_chunks: dict[str, set] = {}

        for file_key, (content, file_path, content_hash, lang) in changed.items():
            from chunker import chunk_by_functions
            chunks = chunk_by_functions(content, lang)
            file_chunk_hashes = set()

            for chunk in chunks:
                if len(chunk["content"].strip()) < 10:
                    continue
                ch = _chunk_hash(chunk["content"])
                if ch in self._chunk_hashes:
                    continue  # genuine cross-file dedup
                self._chunk_hashes.add(ch)
                file_chunk_hashes.add(ch)
                chunk_id = f"{file_key}:{chunk['start_line']}-{chunk['end_line']}"
                pending_chunks.append({
                    "id": chunk_id,
                    "content": chunk["content"],
                    "source": file_key,
                    "start_line": chunk["start_line"],
                    "end_line": chunk["end_line"],
                    "language": lang,
                    "token_count": len(chunk["content"]) // 4,
                })
                pending_texts.append(chunk["content"])

            if file_chunk_hashes:
                new_file_hashes[file_key] = content_hash
                new_per_file_chunks[file_key] = file_chunk_hashes
            indexed_files += 1

        # Phase 4: embed and update table
        if pending_texts:
            logger.info(f"Encoding {len(pending_texts)} chunks...")
            vectors = self._batch_encode(pending_texts)
            for chunk, vec in zip(pending_chunks, vectors):
                chunk["vector"] = vec

        if pending_chunks:
            stale_sources = {c["source"] for c in pending_chunks}
            if self.table is not None:
                try:
                    for src in stale_sources:
                        self.table.delete(f"source = '{_sanitize(src)}'")
                    self.table.add(pending_chunks)
                except Exception as e:
                    logger.error(f"Table delete+add failed, falling back to full overwrite: {e}")
                    try:
                        existing = self.table.to_arrow()
                        source_col = existing.column("source").to_pylist()
                        keep_mask = [s not in stale_sources for s in source_col]
                        keep_table = existing.filter(keep_mask)
                        merged = keep_table.to_pylist()
                        for row in merged:
                            if "token_count" not in row or row["token_count"] is None:
                                row["token_count"] = len(row.get("content", "")) // 4
                        merged.extend(pending_chunks)
                        self.table = self.db.create_table(
                            "code_chunks", data=merged, schema=self._code_schema, mode="overwrite"
                        )
                    except Exception as e2:
                        logger.error(f"Fallback overwrite also failed: {e2}")
                        self.table = self.db.create_table(
                            "code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite"
                        )
            else:
                self.table = self.db.create_table(
                    "code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite"
                )

        # Phase 5: update caches
        self._file_hashes.update(new_file_hashes)
        self._per_file_chunks.update(new_per_file_chunks)
        # Prune orphaned hashes (files deleted/moved since last index run)
        indexed_keys = {str(f) for f in files}
        for k in list(self._file_hashes.keys()):
            if k not in indexed_keys:
                del self._file_hashes[k]
        for k in list(self._per_file_chunks.keys()):
            if k not in indexed_keys:
                self._per_file_chunks.pop(k, None)
        self._save_hashes()
        self._save_per_file_chunks()
        if pending_chunks:
            self._search_cache.invalidate()
            self._rebuild_chunk_hashes()

        return {
            "total_files": len(files),
            "indexed": indexed_files,
            "skipped_unchanged": skipped_files,
            "chunks_created": len(pending_chunks),
        }
