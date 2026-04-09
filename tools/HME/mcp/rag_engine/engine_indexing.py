"""RAGEngine indexing mixin — file and directory indexing."""
import logging
import os
from pathlib import Path

from .utils import BATCH_SIZE, _chunk_hash, _file_hash
from lang_registry import ext_to_lang

logger = logging.getLogger(__name__)


class RAGEngineIndexingMixin:
    def _collect_files(self, directory: str) -> list[Path]:
        from file_walker import walk_code_files
        return list(walk_code_files(directory))

    def _batch_encode(self, texts: list[str]) -> list[list[float]]:
        results = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i:i + BATCH_SIZE]
            embeddings = self.model.encode(batch, show_progress_bar=False)
            results.extend(embeddings.tolist())
        return results

    def index_file(self, abs_path: str) -> dict:
        """Index a single file (mini-reindex for per-file KB freshness)."""
        with self._index_lock:
            return self._index_file_locked(abs_path)

    def _index_file_locked(self, abs_path: str) -> dict:
        file_path = Path(abs_path)
        if not file_path.exists():
            return {"indexed": 0, "error": "file not found"}
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            return {"indexed": 0, "error": str(e)}

        file_key = str(file_path)
        content_hash = _file_hash(content)
        if self._file_hashes.get(file_key) == content_hash:
            return {"indexed": 0, "skipped_unchanged": 1}

        lang = ext_to_lang(file_path.suffix if file_path.suffix else file_path.name)
        from chunker import chunk_by_functions
        chunks = chunk_by_functions(content, lang)

        pending_chunks = []
        pending_texts = []
        for chunk in chunks:
            if len(chunk["content"].strip()) < 10:
                continue
            ch = _chunk_hash(chunk["content"])
            if ch in self._chunk_hashes:
                continue
            self._chunk_hashes.add(ch)
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

        if pending_texts:
            vectors = self._batch_encode(pending_texts)
            for chunk, vec in zip(pending_chunks, vectors):
                chunk["vector"] = vec

        if pending_chunks:
            if self.table is not None:
                try:
                    existing = self.table.to_arrow()
                    source_col = existing.column("source").to_pylist()
                    keep_mask = [s != file_key for s in source_col]
                    keep_table = existing.filter(keep_mask)
                    merged = keep_table.to_pylist()
                    for row in merged:
                        if "token_count" not in row or row["token_count"] is None:
                            row["token_count"] = len(row.get("content", "")) // 4
                    merged.extend(pending_chunks)
                    self.table = self.db.create_table("code_chunks", data=merged, schema=self._code_schema, mode="overwrite")
                except Exception as e:
                    logger.error(f"Table merge failed for {abs_path}: {e}")
                    self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")
            else:
                self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")

        self._file_hashes[file_key] = content_hash
        self._save_hashes()
        if pending_chunks:
            self._search_cache.invalidate()
        return {"indexed": 1, "chunks_created": len(pending_chunks)}

    def index_directory(self, directory: str) -> dict:
        with self._index_lock:
            return self._index_directory_locked(directory)

    def _index_directory_locked(self, directory: str) -> dict:
        # Block if clear is in progress
        if getattr(self, '_clearing', False):
            return {"total_files": 0, "indexed": 0, "skipped_unchanged": 0, "chunks_created": 0}
        # Validate cache integrity before any skip decisions —
        # catches desync from crashed clears, DB renames, race conditions
        self._validate_cache()
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
                    "token_count": len(chunk["content"]) // 4,
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
                    # Backfill token_count for rows from older schema that lack it
                    for row in merged:
                        if "token_count" not in row or row["token_count"] is None:
                            row["token_count"] = len(row.get("content", "")) // 4
                    merged.extend(pending_chunks)
                    self.table = self.db.create_table("code_chunks", data=merged, schema=self._code_schema, mode="overwrite")
                except Exception as e:
                    logger.error(f"Table merge failed, writing new chunks only: {e}")
                    self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")
            else:
                self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")

        # Only update file hashes after successful table write
        self._file_hashes.update(new_file_hashes)
        # Prune orphaned hashes (files deleted/moved since last index run)
        indexed_keys = {str(f) for f in files}
        for k in list(self._file_hashes.keys()):
            if k not in indexed_keys:
                del self._file_hashes[k]
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
