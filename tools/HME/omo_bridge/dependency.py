"""OMO dependency resolver for Python-side bridge callers."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _env_required(name: str) -> str:
    try:
        return os.environ[name]
    except KeyError as exc:
        raise ValueError(f"missing required environment key {name}") from exc


def _git_commit(root: Path) -> str:
    try:
        proc = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=2)
    except Exception:
        return ""
    return proc.stdout.strip() if proc.returncode == 0 else ""


def _package_json(root: Path) -> dict:
    path = root / "package.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def resolve_omo(*, enabled: bool | None = None, source: str | None = None, path: str | None = None, package_name: str | None = None, required: bool = False) -> dict:
    is_enabled = enabled if enabled is not None else _env_required("HME_OMO_ENABLED") == "1"
    src = source if source is not None else _env_required("HME_OMO_SOURCE")
    if not is_enabled or src == "disabled":
        return {"enabled": False, "source": "disabled", "status": "disabled"}
    try:
        if src == "path":
            configured = path if path is not None else _env_required("HME_OMO_PATH")
            if not configured:
                raise ValueError("HME_OMO_PATH is required when HME_OMO_SOURCE=path")
            p = Path(configured)
            root = p if p.is_absolute() else PROJECT_ROOT / p
            root = root.resolve()
            if not str(root).startswith(str(PROJECT_ROOT.resolve())):
                raise ValueError("HME_OMO_PATH must be relative to or inside PROJECT_ROOT")
            if not root.exists():
                raise ValueError(f"HME_OMO_PATH does not exist: {configured}")
        elif src == "package":
            pkg = package_name if package_name is not None else _env_required("HME_OMO_PACKAGE")
            if not pkg:
                raise ValueError("HME_OMO_PACKAGE is required when HME_OMO_SOURCE=package")
            raise ValueError("Python package resolution for OMO package source is not available; use JS resolver or path mode")
        else:
            raise ValueError(f"unsupported HME_OMO_SOURCE: {src}")
        pkg_json = _package_json(root)
        return {
            "enabled": True,
            "source": src,
            "status": "ok",
            "root": str(root),
            "package": pkg_json.get("name", ""),
            "version": pkg_json.get("version", ""),
            "commit": _git_commit(root),
        }
    except Exception as exc:
        if required:
            raise
        return {"enabled": True, "source": src, "status": "error", "error": str(exc)}
