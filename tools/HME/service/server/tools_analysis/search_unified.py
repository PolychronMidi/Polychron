"""HME find -- unified search tool that auto-routes by intent.

Merges search_code (semantic), grep (exact), find_callers (call graph),
and find_anti_pattern (boundary check) into one tool with auto-detection.
"""
import re
import time
import logging

from server import context as ctx
from . import _track, _budget_gate, BUDGET_TOOL
from ._dispatch import dispatch
from .synthesis_session import append_session_narrative, get_session_narrative

logger = logging.getLogger("HME")

# Circuit breaker: dedup identical (query, mode, path) within a short window.
# Prevents runaway retries from MCP client or looping callers.
_recent_finds: dict[tuple, tuple[float, str]] = {}  # (query, mode, path) -> (timestamp, result)
_FIND_DEDUP_WINDOW_S = 60  # return cached result if same query within 60s
_FIND_DEDUP_MAX = 50  # max entries before pruning


def find(query: str, path: str = "", mode: str = "auto") -> str:
    """Deprecated -- absorbed into grep (search modes), glob_search (structural modes),
    and evolve (analysis modes). Kept as internal function for backward compatibility."""
    _track("find")
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Error: query cannot be empty."

    # Circuit breaker: return cached result for identical query within dedup window
    _dedup_key = (query.strip(), mode, path)
    _now = time.monotonic()
    _cached = _recent_finds.get(_dedup_key)
    if _cached and (_now - _cached[0]) < _FIND_DEDUP_WINDOW_S:
        _age = int(_now - _cached[0])
        logger.info(f"find() dedup hit: '{query[:40]}' mode={mode} -- returning cached result ({_age}s old)")
        return _cached[1] + f"\n\n(cached result from {_age}s ago -- identical query)"

    append_session_narrative("find", f"{mode}: {query[:80]}")

    routed = dispatch(mode, {
        "think": lambda: _think(query),
        "diagnose": lambda: _diagnose(query),
        "blast": lambda: _blast(query),
        "coupling": lambda: _coupling(query),
        "symbols": lambda: _symbols(query),
        "lookup": lambda: _lookup(query),
        "map": lambda: _map(query),
        "hierarchy": lambda: _hierarchy(query),
        "rename": lambda: _rename(query),
        "xref": lambda: _xref(query),
    })
    if routed is not None:
        return routed

    if mode == "auto":
        mode = _detect_intent(query)

    def _cache_and_return(result: str) -> str:
        _recent_finds[_dedup_key] = (time.monotonic(), result)
        if len(_recent_finds) > _FIND_DEDUP_MAX:
            _cutoff = time.monotonic() - _FIND_DEDUP_WINDOW_S
            for k in [k for k, v in _recent_finds.items() if v[0] < _cutoff]:
                del _recent_finds[k]
        return result

    routed = dispatch(mode, {
        "callers": lambda: _callers(query, path),
        "boundary": lambda: _boundary(query, path),
        "grep": lambda: _grep(query, path, regex=True),
    })
    if routed is not None:
        return _cache_and_return(routed)

    # Default: semantic search -- prepend session thread for investigation continuity
    from server.tools_search import search_code as _sc
    result = _sc(query, path=path, response_format="detailed")
    narrative = get_session_narrative(max_entries=20)
    if narrative:
        result = narrative + result
    return _cache_and_return(_budget_gate(result))


def _detect_intent(query: str) -> str:
    """Detect search intent from natural language query."""
    q = query.lower().strip()
    if re.match(r'^(callers? of|who calls|find callers)\s+', q):
        return "callers"
    if re.search(r'\bshould use\b|\bnot\b.*\binstead\b|\banti.?pattern\b|\bboundary\b', q):
        return "boundary"
    # Regex-like patterns: contains *, +, [, \, ^, $, |
    if re.search(r'[*+\[\]\\^$|]', query) and not re.search(r'[a-z]{8,}', q):
        return "grep"
    # Short symbol-like queries (single camelCase word, no spaces)
    if ' ' not in query.strip() and re.match(r'^[a-zA-Z_]\w*$', query.strip()):
        return "grep"
    return "semantic"
