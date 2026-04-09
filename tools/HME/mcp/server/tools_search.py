"""HME search tools — re-export shim for backward compatibility."""
from .search_basic import grep, file_lines, count_lines
from .search_context import get_context
from .search_hybrid import search_code
from .search_similarity import find_similar_code
from .search_symbols import find_callers, find_anti_pattern

__all__ = [
    "grep", "file_lines", "count_lines",
    "get_context",
    "search_code",
    "find_similar_code",
    "find_callers", "find_anti_pattern",
]
