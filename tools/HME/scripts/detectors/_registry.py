"""Shared loader for detectors/registry.json with default-from-name fallbacks.

Boilerplate-reducing convention: if a detector entry omits these fields, they
default from `name`:

  fires_when = name
  bash_var   = name.upper()
  reason_key = name.upper()
  module     = name

Consumers should call `load()` instead of opening registry.json directly so
the normalization is one-shot and shared.
"""
from __future__ import annotations

import json
from pathlib import Path

REGISTRY_PATH = Path(__file__).parent / "registry.json"


def _normalize(entry: dict) -> dict:
    name = entry.get("name") or ""
    if not name:
        return entry
    e = dict(entry)
    e.setdefault("fires_when", name)
    e.setdefault("bash_var", name.upper())
    e.setdefault("reason_key", name.upper())
    e.setdefault("module", name)
    return e


def load(path: Path = REGISTRY_PATH) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    detectors = data.get("detectors") or []
    data["detectors"] = [_normalize(d) for d in detectors]
    return data


def detectors(path: Path = REGISTRY_PATH) -> list[dict]:
    return load(path)["detectors"]
