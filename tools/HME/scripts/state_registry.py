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
REQUIRED_ENTRY_FIELDS = {
    "path", "owner", "readers", "writers", "retention", "generated",
    "committed", "schema", "repair",
}


def load_state_registry(root: Path | None = None) -> dict[str, Any]:
    path = (root or PROJECT_ROOT) / "tools" / "HME" / "config" / "state-files.json"
    data = load_jsonc(path)
    if not isinstance(data.get("single_owner", []), list):
        raise ValueError(f"{path}: single_owner must be a list")
    if not isinstance(data.get("multi_writer", []), list):
        raise ValueError(f"{path}: multi_writer must be a list")
    for section in ("single_owner", "multi_writer"):
        for idx, entry in enumerate(data.get(section, [])):
            missing = sorted(REQUIRED_ENTRY_FIELDS - set(entry))
            if missing:
                raise ValueError(f"{path}: {section}[{idx}] missing required fields: {', '.join(missing)}")
            if not isinstance(entry.get("readers"), list) or not isinstance(entry.get("writers"), list):
                raise ValueError(f"{path}: {section}[{idx}] readers/writers must be lists")
            if not isinstance(entry.get("generated"), bool) or not isinstance(entry.get("committed"), bool):
                raise ValueError(f"{path}: {section}[{idx}] generated/committed must be booleans")
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
