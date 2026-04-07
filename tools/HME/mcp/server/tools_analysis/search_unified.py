"""HME find — unified search tool that auto-routes by intent.

Merges search_code (semantic), grep (exact), find_callers (call graph),
and find_anti_pattern (boundary check) into one tool with auto-detection.
"""
import re
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def find(query: str, path: str = "", mode: str = "auto") -> str:
    """Smart search — auto-routes by query intent. mode='auto' (default) detects
    intent from the query: 'callers of X' → find_callers, 'X should use Y' →
    find_anti_pattern, regex patterns → grep, natural language → search_code.
    mode='semantic'|'grep'|'callers'|'boundary' to force a specific engine.
    path scopes all engines to a directory."""
    _track("find")
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Error: query cannot be empty."

    if mode == "auto":
        mode = _detect_intent(query)

    if mode == "callers":
        symbol = re.sub(r'^(callers? of|who calls|find callers)\s+', '', query, flags=re.IGNORECASE).strip()
        from server.tools_search import find_callers as _fc
        return _fc(symbol, path=path)

    if mode == "boundary":
        # Parse "X should use Y" or "X not Y"
        m = re.match(r'(\S+)\s+(?:should use|not|instead of|vs)\s+(\S+)', query, re.IGNORECASE)
        if m:
            from server.tools_search import find_anti_pattern as _fap
            return _fap(wrong_symbol=m.group(1), right_symbol=m.group(2), path=path)
        return "Error: boundary mode needs 'wrong_symbol should use right_symbol' format."

    if mode == "grep":
        from server.tools_search import grep as _grep
        return _grep(query, path=path, regex=True)

    # Default: semantic search
    from server.tools_search import search_code as _sc
    return _sc(query, path=path, response_format="detailed")


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
