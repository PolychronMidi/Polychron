"""Shared utilities for tools/HME/service/ — keep narrow.

Only put truly cross-cutting helpers here (log bounding, retry shells,
thread utilities). Anything domain-specific (KB, synthesis, reasoning)
goes in its own module next to the callers.

Public surface — what external callers may import from `common`:
"""
from .bounded_log import maybe_trim_append  # noqa: F401
