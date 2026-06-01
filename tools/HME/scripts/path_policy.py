#!/usr/bin/env python3
"""Shared repo path policy loaded from tools/HME/config/repo-hygiene.json."""
from __future__ import annotations

import fnmatch
import json
import os
from pathlib import Path
from typing import Any


def project_root() -> Path:
    return Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])


def load_policy(root: str | Path | None = None) -> dict[str, Any]:
    base = Path(root) if root is not None else project_root()
    path = base / "tools" / "HME" / "config" / "repo-hygiene.json"
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def norm_rel(path: str | Path) -> str:
    return str(path).replace("\\", "/").lstrip("./")


def path_matches(path: str, pattern: str) -> bool:
    p = norm_rel(path)
    pat = norm_rel(pattern)
    return fnmatch.fnmatch(p, pat)


def blocked_path_reason(path: str, policy: dict[str, Any] | None = None) -> str | None:
    cfg = policy or load_policy()
    p = norm_rel(path)
    allow = {norm_rel(x) for x in cfg.get("path_allowlist", [])}
    if p in allow:
        return None
    reasons = cfg.get("blocked_path_reasons", {})
    for pat in cfg.get("blocked_paths", []):
        if path_matches(p, pat):
            return reasons.get(pat, "blocked by repo hygiene policy")
    name = p.rsplit("/", 1)[-1]
    parts = set(p.split("/"))
    if name.endswith(".jsonl") and parts.intersection(cfg.get("blocked_jsonl_dirs", [])):
        return "runtime/log/metrics jsonl is not source"
    return None


def skip_syntax(path: str, policy: dict[str, Any] | None = None) -> bool:
    cfg = policy or load_policy()
    parts = set(norm_rel(path).split("/"))
    return bool(parts.intersection(cfg.get("syntax_skip_dirs", [])))
