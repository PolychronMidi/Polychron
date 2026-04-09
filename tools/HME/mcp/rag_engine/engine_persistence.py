"""RAGEngine persistence mixin — file hash cache and table validation."""
import json
import logging
import os

from .utils import _chunk_hash

logger = logging.getLogger(__name__)


class RAGEnginePersistenceMixin:
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
            except Exception as e:
                logger.warning(f"Cache validation failed (count_rows): {e}")

    def _rebuild_chunk_hashes(self):
        """Populate in-memory chunk hash set from existing table to enable dedup on re-index."""
        if self.table is None:
            return
        try:
            rows = self.table.to_arrow().to_pylist()
            self._chunk_hashes = {_chunk_hash(r["content"]) for r in rows}
        except Exception:
            self._chunk_hashes = set()
