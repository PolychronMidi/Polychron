"""Shared-state ownership registry loader."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from jsonc import load_jsonc


PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[3]
)
REGISTRY_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "state-files.json"


def load_state_registry(root: Path | None = None) -> dict[str, Any]:
    path = (root or PROJECT_ROOT) / "tools" / "HME" / "config" / "state-files.json"
    data = load_jsonc(path)
    if not isinstance(data.get("single_owner", []), list):
        raise ValueError(f"{path}: single_owner must be a list")
    if not isinstance(data.get("multi_writer", []), list):
        raise ValueError(f"{path}: multi_writer must be a list")
    return data


def ownership_map(root: Path | None = None) -> dict[str, set[str]]:
    data = load_state_registry(root)
    out: dict[str, set[str]] = {}
    for entry in data.get("single_owner", []):
        path = str(entry.get("path", "")).strip()
        owner = str(entry.get("owner", "")).strip()
        if path and owner:
            out.setdefault(path, set()).add(owner)
    for entry in data.get("multi_writer", []):
        path = str(entry.get("path", "")).strip()
        writers = entry.get("writers", [])
        if path and isinstance(writers, list):
            out.setdefault(path, set()).update(str(w).strip() for w in writers if str(w).strip())
    return out
