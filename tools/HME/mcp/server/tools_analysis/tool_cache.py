"""Shared TTL cache for cross-tool KB search and caller scan results.

Prevents redundant llama.cpp/RAG work when the same module or query is accessed
by multiple tools within a short window (e.g. read(before) → review(forget)).

Keys are independent of file mtime — the TTL handles expiry.
workflow.py's mtime-keyed caches remain authoritative for synthesis results;
this cache covers raw KB and caller lookups shared across tools.
"""
import time
import logging
from server import context as ctx

logger = logging.getLogger("HME")

_TTL_KB = 60.0       # KB search results — 1 min (KB rarely updated mid-session)
_TTL_CALLERS = 120.0  # caller scan results — 2 min (callers don't change between saves)


def _get_ttl_cache() -> dict:
    if not hasattr(ctx, "_tool_ttl_cache"):
        ctx._tool_ttl_cache = {}
    return ctx._tool_ttl_cache


def _cache_get(key: tuple):
    cache = _get_ttl_cache()
    entry = cache.get(key)
    if entry is None:
        return None, False
    value, ts, ttl = entry
    if time.monotonic() - ts > ttl:
        cache.pop(key, None)
        return None, False
    return value, True


def _cache_set(key: tuple, value, ttl: float):
    _get_ttl_cache()[key] = (value, time.monotonic(), ttl)


def cached_kb_search(query: str, top_k: int, engine) -> list:
    """KB search with 60s TTL — avoids redundant scans when the same module is
    looked up by multiple tools in sequence (e.g. read → review → diagnose)."""
    key = ("kb", id(engine), query[:120], top_k)
    result, hit = _cache_get(key)
    if hit:
        logger.debug(f"tool_cache: KB hit '{query[:40]}' top_k={top_k}")
        return result
    result = engine.search_knowledge(query, top_k)
    _cache_set(key, result, _TTL_KB)
    return result


def cached_find_callers(module_name: str, project_root: str, find_fn) -> list:
    """Caller scan with 120s TTL — callers don't change between individual file saves."""
    key = ("callers", module_name, project_root)
    result, hit = _cache_get(key)
    if hit:
        logger.debug(f"tool_cache: callers hit '{module_name}'")
        return result
    result = find_fn(module_name, project_root)
    _cache_set(key, result, _TTL_CALLERS)
    return result


def cache_invalidate_kb(query: str | None = None):
    """Invalidate KB entries — call after add_knowledge or index rebuild.
    Pass query=None to clear all KB cache entries."""
    cache = _get_ttl_cache()
    if query is None:
        keys = [k for k in cache if k[0] == "kb"]
    else:
        keys = [k for k in cache if k[0] == "kb" and k[2].startswith(query[:60])]
    for k in keys:
        cache.pop(k, None)
    if keys:
        logger.debug(f"tool_cache: invalidated {len(keys)} KB entries")
