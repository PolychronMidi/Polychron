"""D1: static-validation cache (run via `python3` or import; intentionally no
shebang -- it is a library, not a standalone executable).

Memoize a review brief's / file's static validation result by content hash so
re-running a review round on an UNCHANGED input skips redundant re-derivation of
the same validation.

Cost-control charter (binding): this caches ONLY a static validation result. It
NEVER caches, truncates, or short-circuits a peer's exploration, dialogue, or
depth -- those always run live. The cache lives in ignored teams/runtime/ and is
keyed by the exact input bytes, so any edit invalidates it (no stale grounding
can slip through).
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Callable


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _default_cache_path(capsule_path: Path) -> Path:
    # <repo>/teams/<anything> -> teams/runtime/capsule-cache.json (ignored runtime)
    return capsule_path.resolve().parent.parent / "runtime" / "capsule-cache.json"


def _load_cache(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def cached_validation(
    capsule_path: str | Path,
    compute: Callable[[], dict],
    cache_path: str | Path | None = None,
) -> tuple[dict, bool]:
    """Return (result, cache_hit).

    `compute()` performs the real validation and returns a JSON-serializable dict
    (e.g. {"missing": [...], "gaps": [...]}). It is only invoked on a cache MISS
    (no entry, or the capsule bytes changed). The result is keyed by the SHA-256
    of the capsule's current bytes, so an edited capsule always re-validates.
    """
    p = Path(capsule_path)
    text = p.read_text(encoding="utf-8", errors="ignore")
    digest = _hash(text)
    cpath = Path(cache_path) if cache_path else _default_cache_path(p)
    cache = _load_cache(cpath)
    key = str(p.resolve())
    entry = cache.get(key)
    if isinstance(entry, dict) and entry.get("hash") == digest and "result" in entry:
        return entry["result"], True
    result = compute()
    cache[key] = {"hash": digest, "result": result, "ts": time.time()}
    try:
        cpath.parent.mkdir(parents=True, exist_ok=True)
        cpath.write_text(json.dumps(cache, sort_keys=True), encoding="utf-8")
    except OSError:
        pass  # silent-ok: cache is a best-effort cost optimization, never load-bearing
    return result, False
