"""Strict root .env loader for Python entrypoints.

Semantics mirror tools/HME/proxy/shared/load_env.js:
  - Parses KEY=VALUE lines with quoted-value support.
  - Resolves ${VAR} interpolation only from the same .env file.
  - Fails loud on missing file, cyclic refs, unresolved refs, or missing keys.

Usage:
    from _env_loader import load_env
    load_env()
"""
from __future__ import annotations

import os
import re
from pathlib import Path

_INTERP_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _parse_env_file(path: Path) -> "list[tuple[str, str]]":
    pairs: list[tuple[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        eq = line.find("=")
        if eq < 1:
            continue
        k = line[:eq].strip()
        v = line[eq + 1 :].strip()
        hash_at = v.find(" #")
        if hash_at >= 0:
            v = v[:hash_at].strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        pairs.append((k, v))
    return pairs


def _expand(values: "dict[str, str]") -> "dict[str, str]":
    expanded: dict[str, str] = {}
    resolving: set[str] = set()

    def resolve(key: str) -> str:
        if key in expanded:
            return expanded[key]
        if key in resolving:
            raise ValueError(f"cyclic .env interpolation involving {key}")
        if key not in values:
            raise ValueError(f".env references undefined key {key}")
        resolving.add(key)
        raw = values[key]

        def sub(m: "re.Match[str]") -> str:
            ref = m.group(1)
            r = resolve(ref)
            if r == "":
                raise ValueError(f"unresolved .env interpolation: {key} references {ref}")
            return r

        out = _INTERP_RE.sub(sub, raw)
        resolving.discard(key)
        expanded[key] = out
        return out

    for k in values:
        resolve(k)
    return expanded


def _default_env_path() -> Path:
    return Path(__file__).resolve().parents[3] / ".env"


def load_env(env_path: "str | os.PathLike | None" = None, *, overwrite: bool = False) -> "dict[str, int]":
    """Load .env into os.environ. Returns {loaded, skipped}."""
    p = Path(env_path) if env_path is not None else _default_env_path()
    if not p.exists():
        raise FileNotFoundError(f"missing required .env at {p}")
    raw_values: dict[str, str] = {}
    for k, v in _parse_env_file(p):
        raw_values[k] = v
    values = _expand(raw_values)
    loaded = 0
    skipped = 0
    for k, v in values.items():
        if overwrite or os.environ.get(k) in (None, ""):
            os.environ[k] = v
            loaded += 1
        else:
            skipped += 1
    return {"loaded": loaded, "skipped": skipped}


def require_env(key: str) -> str:
    """Strict accessor used by callers that want a precise error message."""
    v = os.environ.get(key)
    if v is None or v == "":
        raise KeyError(f"missing required environment key {key}; declare it in root .env")
    return v


if __name__ == "__main__":
    info = load_env()
    print(f"loaded={info['loaded']} skipped={info['skipped']}")
