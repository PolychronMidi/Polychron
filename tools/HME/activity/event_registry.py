#!/usr/bin/env python3
"""Read the canonical HME telemetry event registry."""
from __future__ import annotations

from functools import lru_cache
import json
import re
from pathlib import Path
from typing import Any


REGISTRY_PATH = Path(__file__).with_name("event_registry.json")
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class EventRegistryError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_registry() -> dict[str, Any]:
    try:
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise EventRegistryError(f"could not load {REGISTRY_PATH}: {err}") from err
    records = data.get("events")
    if not isinstance(records, list):
        raise EventRegistryError("event_registry.json must contain an events list")
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise EventRegistryError("each registry event must be an object")
        name = record.get("name")
        if not isinstance(name, str) or not _NAME_RE.match(name):
            raise EventRegistryError(f"invalid event name: {name!r}")
        if name in seen:
            raise EventRegistryError(f"duplicate event name: {name}")
        seen.add(name)
        for field in ("streams", "groups"):
            values = record.get(field)
            if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
                raise EventRegistryError(f"{name}.{field} must be a string list")
        if not isinstance(record.get("category"), str) or not record["category"]:
            raise EventRegistryError(f"{name}.category is required")
        if not isinstance(record.get("summary"), str) or not record["summary"]:
            raise EventRegistryError(f"{name}.summary is required")
    return data


def events() -> list[dict[str, Any]]:
    return list(load_registry()["events"])


def event_names(*, stream: str | None = None, group: str | None = None) -> set[str]:
    names: set[str] = set()
    for record in events():
        if stream and stream not in record["streams"]:
            continue
        if group and group not in record["groups"]:
            continue
        names.add(record["name"])
    return names


def stream_names(stream: str) -> set[str]:
    return event_names(stream=stream)


def group_names(group: str, *, stream: str | None = None) -> set[str]:
    return event_names(stream=stream, group=group)


def registry_path() -> Path:
    return REGISTRY_PATH
