"""Disk-backed dict-like cache with in-RAM LRU hot tier.

Replaces the in-process Python dicts that bounded warm-pre-edit-cache to
~200 files per session AND lost everything across MCP server restarts.
With this:

  HOT  (recent N keys)            in RAM, O(1)
  WARM (everything ever computed) on disk (SQLite), O(1)
  COLD (never computed)           triggers fresh computation

The on-disk store is a single SQLite file `tmp/hme-disk-cache.sqlite3`
shared by all named buckets (caller_cache / kb_hits_cache / etc.). Each
get/set is O(1) regardless of total entries; no whole-file rewrite per
update like the legacy `before-editing-cache.json` pattern. RAM stays
bounded by `ram_limit` (default 256 entries per bucket).

Concurrency: SQLite WAL mode + per-connection serialization. Multiple
threads in the MCP server can read/write safely. A single .commit per
.set call so a crash mid-warm-loop loses at most the in-flight entry.

Value serialization: JSON. Keeps the store inspectable, safe (no pickle
deserialization risk), and small. Values must be JSON-serializable --
this matches caller-list-of-paths, kb-list-of-dicts, etc.
"""
from __future__ import annotations

import collections
import json
import logging
import os
import sqlite3
import threading
import time
from typing import Any

logger = logging.getLogger("HME")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    last_accessed REAL NOT NULL,
    PRIMARY KEY (bucket, key)
);
CREATE INDEX IF NOT EXISTS idx_last_accessed ON cache (last_accessed);
"""


class DiskCache:
    """Dict-like (subset) cache with on-disk persistence + RAM LRU.

    Supports the dict ops used by workflow.py:
      `key in cache`, `cache[key]`, `cache[key] = value`, `cache.get(key)`,
      `cache.get(key, default)`, `len(cache)`.

    Keys may be tuples, strings, or any object whose `repr()` is stable
    (we serialize via json.dumps with default=repr to handle tuples).
    """

    def __init__(self, bucket: str, db_path: str, ram_limit: int = 256):
        self._bucket = bucket
        self._db_path = db_path
        self._ram_limit = max(1, int(ram_limit))
        self._ram: collections.OrderedDict[str, Any] = collections.OrderedDict()
        self._lock = threading.RLock()
        self._init_db()

    def _init_db(self) -> None:
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        # check_same_thread=False + per-call connection so threads don't
        conn = sqlite3.connect(self._db_path, timeout=5.0, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    @staticmethod
    def _serialize_key(key: Any) -> str:
        # Tuples in JSON become lists; round-trip won't be lossless for
        try:
            return json.dumps(key, default=repr, sort_keys=True)
        except (TypeError, ValueError):
            return repr(key)

    def __contains__(self, key: Any) -> bool:
        return self.get(key, _MISSING) is not _MISSING

    def __getitem__(self, key: Any) -> Any:
        result = self.get(key, _MISSING)
        if result is _MISSING:
            raise KeyError(key)
        return result

    def __setitem__(self, key: Any, value: Any) -> None:
        self.set(key, value)

    def __len__(self) -> int:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM cache WHERE bucket = ?",
                (self._bucket,),
            ).fetchone()
            return int(row[0]) if row else 0

    def get(self, key: Any, default: Any = None) -> Any:
        skey = self._serialize_key(key)
        with self._lock:
            # RAM hot tier hit -- promote to most-recently-used.
            if skey in self._ram:
                self._ram.move_to_end(skey)
                return self._ram[skey]
        # SQLite warm tier.
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT value FROM cache WHERE bucket = ? AND key = ?",
                    (self._bucket, skey),
                ).fetchone()
        except sqlite3.Error as e:
            logger.warning(f"DiskCache[{self._bucket}].get db error: {e}")
            return default
        if row is None:
            return default
        try:
            value = json.loads(row[0])
        except (TypeError, ValueError) as e:
            logger.warning(f"DiskCache[{self._bucket}].get parse error: {e}")
            return default
        # Touch last_accessed AND populate RAM tier so next access stays hot.
        try:
            with self._connect() as conn:
                conn.execute(
                    "UPDATE cache SET last_accessed = ? WHERE bucket = ? AND key = ?",
                    (time.time(), self._bucket, skey),
                )
                conn.commit()
        except sqlite3.Error:
            pass  # silent-ok: diagnostic; failure non-fatal  # best-effort; LRU on disk is advisory
        with self._lock:
            self._ram[skey] = value
            self._ram.move_to_end(skey)
            self._evict_ram_if_needed()
        return value

    def set(self, key: Any, value: Any) -> None:
        skey = self._serialize_key(key)
        try:
            sval = json.dumps(value, default=repr)
        except (TypeError, ValueError) as e:
            logger.warning(f"DiskCache[{self._bucket}].set serialize error: {e}")
            return
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO cache (bucket, key, value, last_accessed) "
                    "VALUES (?, ?, ?, ?)",
                    (self._bucket, skey, sval, time.time()),
                )
                conn.commit()
        except sqlite3.Error as e:
            logger.warning(f"DiskCache[{self._bucket}].set db error: {e}")
            return
        with self._lock:
            self._ram[skey] = value
            self._ram.move_to_end(skey)
            self._evict_ram_if_needed()

    def _evict_ram_if_needed(self) -> None:
        # Caller holds self._lock.
        while len(self._ram) > self._ram_limit:
            self._ram.popitem(last=False)  # pop least-recently-used

    def stats(self) -> dict:
        """Diagnostic snapshot. Cheap; safe to call from health endpoints."""
        with self._lock:
            ram_size = len(self._ram)
        try:
            disk_size = len(self)
        except sqlite3.Error:
            disk_size = -1
        return {
            "bucket": self._bucket,
            "ram_entries": ram_size,
            "ram_limit": self._ram_limit,
            "disk_entries": disk_size,
        }


# Sentinel for "missing key" without colliding with a legitimate None value.
_MISSING = object()


_default_path = None
_instances: dict[str, DiskCache] = {}
_instances_lock = threading.Lock()


def get_cache(bucket: str, project_root: str, ram_limit: int = 256) -> DiskCache:
    """Module-level cache registry. One DiskCache per bucket per process,
    sharing the same SQLite file. Idempotent."""
    db_path = os.path.join(project_root, "tmp", "hme-disk-cache.sqlite3")
    with _instances_lock:
        existing = _instances.get(bucket)
        if existing is not None and existing._db_path == db_path:
            return existing
        cache = DiskCache(bucket, db_path, ram_limit=ram_limit)
        _instances[bucket] = cache
        return cache
