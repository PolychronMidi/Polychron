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


def _think(query: str) -> str:
    from .reasoning_think import think as _th
    return _th(about=query)


def _diagnose(query: str) -> str:
    from .workflow_audit import diagnose_error as _de
    return _de(query)


def _blast(query: str) -> str:
    from .reasoning_think import blast_radius as _br
    return _br(query)


def _coupling(query: str) -> str:
    from .coupling import coupling_intel as _ci
    return _budget_gate(_ci(mode=query or "full"))


def _symbols(query: str) -> str:
    from .symbols import search_symbols as _ss
    return _ss(query)


def _lookup(query: str) -> str:
    from .symbols import lookup_symbol as _ls
    return _ls(query)


def _map(query: str) -> str:
    from .symbols import get_module_map as _gmm
    return _gmm(query or "")


def _hierarchy(query: str) -> str:
    from .symbols import type_hierarchy as _th2
    return _th2(query)


def _rename(query: str) -> str:
    parts = query.split("->") if "->" in query else query.split("->")
    if len(parts) == 2:
        from .symbols import bulk_rename_preview as _brp
        return _brp(parts[0].strip(), parts[1].strip())
    return "Error: rename mode needs 'old_name->new_name' format."


def _xref(query: str) -> str:
    from .symbols import cross_language_trace as _clt
    return _clt(query)


def _callers(query: str, path: str) -> str:
    symbol = re.sub(r'^(callers? of|who calls|find callers)\s+', '', query, flags=re.IGNORECASE).strip()
    from server.tools_search import find_callers as _fc
    return _fc(symbol, path=path)


def _boundary(query: str, path: str) -> str:
    m = re.match(r'(\S+)\s+(?:should use|not|instead of|vs)\s+(\S+)', query, re.IGNORECASE)
    if m:
        from server.tools_search import find_anti_pattern as _fap
        return _fap(wrong_symbol=m.group(1), right_symbol=m.group(2), path=path)
    tokens = re.findall(r'[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*', query)
    symbols = [t for t in tokens if len(t) > 3 and t.lower() not in
               {'should', 'using', 'instead', 'hardcoded', 'names', 'strings', 'not'}]
    if len(symbols) >= 2:
        from server.tools_search import find_anti_pattern as _fap
        return _fap(wrong_symbol=symbols[0], right_symbol=symbols[1], path=path)
    if len(symbols) == 1:
        return _grep(symbols[0], path or "src/", regex=False)
    return ("Error: could not extract symbols from query. Use either:\n"
            "  - 'wrong_symbol should use right_symbol' format\n"
            "  - Natural language with at least one identifiable symbol")


def _grep(query: str, path: str, *, regex: bool) -> str:
    from server.tools_search import grep as _grep_impl
    return _grep_impl(query, path=path, regex=regex)


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
