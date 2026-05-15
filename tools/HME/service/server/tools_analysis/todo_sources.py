"""Canonical source registry for HME todo entries."""
from __future__ import annotations

TODO_SOURCES: dict[str, dict] = {
    "native": {
        "label": "Native TodoWrite",
        "preserve_in_native_merge": False,
        "can_be_critical": False,
        "can_be_archived": True,
        "surface": "public",
        "prefix": "",
    },
    "lifesaver": {
        "label": "LIFESAVER",
        "preserve_in_native_merge": True,
        "can_be_critical": True,
        "can_be_archived": True,
        "surface": "internal",
        "prefix": "[LIFESAVER] ",
    },
    "hme_todo": {
        "label": "HME todo",
        "preserve_in_native_merge": True,
        "can_be_critical": True,
        "can_be_archived": True,
        "surface": "internal",
        "prefix": "",
    },
    "todo_md": {
        "label": "TODO.md",
        "preserve_in_native_merge": True,
        "can_be_critical": False,
        "can_be_archived": True,
        "surface": "human-file",
        "prefix": "",
    },
    "codex_plan": {
        "label": "Codex plan",
        "preserve_in_native_merge": True,
        "can_be_critical": False,
        "can_be_archived": True,
        "surface": "codex-update-plan",
        "prefix": "",
    },
}

VALID_TODO_SOURCES = tuple(TODO_SOURCES)
PRESERVED_NATIVE_MERGE_SOURCES = tuple(
    source for source, meta in TODO_SOURCES.items()
    if meta.get("preserve_in_native_merge")
)


def validate_source(source: str) -> str:
    source = (source or "").strip()
    if source not in TODO_SOURCES:
        raise ValueError(f"unknown todo source {source!r}; expected one of {VALID_TODO_SOURCES}")
    return source


def source_prefix(source: str) -> str:
    return str(TODO_SOURCES.get(source, {}).get("prefix") or "")


def source_label(source: str) -> str:
    return str(TODO_SOURCES.get(source, {}).get("label") or source or "unknown")
