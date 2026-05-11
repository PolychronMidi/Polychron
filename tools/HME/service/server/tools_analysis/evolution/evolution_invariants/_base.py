"""Declarative invariant battery -- loads checks from config/invariants.json.

No LLM, pure programmatic. Add new invariants by editing the JSON file.
"""
import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

_PROJECT_ROOT_FALLBACK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", ".."))
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(ctx.PROJECT_ROOT or _PROJECT_ROOT_FALLBACK, "output", "metrics"))
_CONFIG_REL = os.path.join("tools", "HME", "config", "invariants.json")


def _load_invariants() -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, _CONFIG_REL)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("invariants", [])


def _resolve(rel_path: str) -> str:
    if rel_path.startswith("~/"):
        return os.path.expanduser(rel_path)
    return os.path.join(ctx.PROJECT_ROOT, rel_path)


def _excluded(basename: str, exclude: list[str]) -> bool:
    return any(fnmatch.fnmatch(basename, pat) for pat in exclude)


def _resolve_glob(inv_glob) -> list[str]:
    """Accept either a string or a list of glob patterns; return matched files."""
    patterns = inv_glob if isinstance(inv_glob, list) else [inv_glob]
    seen = set()
    out = []
    for p in patterns:
        for f in globmod.glob(os.path.join(ctx.PROJECT_ROOT, p), recursive=True):
            if f not in seen:
                seen.add(f)
                out.append(f)
    return out


# Check type implementations

def _is_regex(s: str) -> bool:
    return any(c in s for c in r"\.[](){}*+?^$|")


