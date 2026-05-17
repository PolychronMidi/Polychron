from __future__ import annotations

import json
import os
from pathlib import Path

from hme_paths import PROJECT_ROOT

DEFAULT_ADAPTER = {
    "project_id": "generic",
    "project_name": "Generic project",
    "domain": "software",
    "source_roots": ["src"],
    "project_docs": ["doc/composition.md"],
    "primary_doc": "doc/composition.md",
    "pipeline": {"main": "npm test"},
    "artifacts": {"metrics_dir": "src/output/metrics"},
    "optional_artifacts": [],
    "capabilities": {},
    "health": {},
}


def adapter_path(root: Path = PROJECT_ROOT) -> Path:
    override = os.environ.get("HME_PROJECT_ADAPTER")
    return Path(override).expanduser() if override else root / "config" / "project-adapter.json"


def load_adapter(root: Path = PROJECT_ROOT) -> dict:
    path = adapter_path(root)
    raw = {}
    if path.is_file():
        raw = json.loads(path.read_text(encoding="utf-8"))
    cfg = {**DEFAULT_ADAPTER, **raw}
    cfg["source_roots"] = cfg.get("source_roots") or ["src"]
    cfg["project_docs"] = cfg.get("project_docs") or [cfg.get("primary_doc", "doc/composition.md")]
    cfg["pipeline"] = cfg.get("pipeline") or {}
    cfg["artifacts"] = cfg.get("artifacts") or {}
    cfg["optional_artifacts"] = cfg.get("optional_artifacts") or []
    cfg["capabilities"] = cfg.get("capabilities") or {}
    cfg["health"] = cfg.get("health") or {}
    return cfg


def resolve_path(root: Path, rel_path: str) -> Path:
    candidate = (root / rel_path).resolve()
    candidate.relative_to(root.resolve())
    return candidate


def artifact_path(name: str, root: Path = PROJECT_ROOT, adapter: dict | None = None) -> Path | None:
    cfg = adapter or load_adapter(root)
    rel = cfg.get("artifacts", {}).get(name)
    return resolve_path(root, rel) if rel else None


def source_roots(root: Path = PROJECT_ROOT, adapter: dict | None = None) -> list[Path]:
    cfg = adapter or load_adapter(root)
    return [resolve_path(root, p) for p in cfg.get("source_roots", [])]


def project_docs(root: Path = PROJECT_ROOT, adapter: dict | None = None) -> list[Path]:
    cfg = adapter or load_adapter(root)
    return [resolve_path(root, p) for p in cfg.get("project_docs", [])]


def has_capability(name: str, root: Path = PROJECT_ROOT, adapter: dict | None = None) -> bool:
    cfg = adapter or load_adapter(root)
    return bool(cfg.get("capabilities", {}).get(name))
