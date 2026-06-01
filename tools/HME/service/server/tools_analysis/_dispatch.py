"""Small dispatch helpers for tools_analysis mode/action tables."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import TypeVar

T = TypeVar("T")


def dispatch(key: str, table: Mapping[str, Callable[[], T]]) -> T | None:
    handler = table.get(key)
    if handler is None:
        return None
    return handler()
