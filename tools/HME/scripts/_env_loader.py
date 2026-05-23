"""Python .env loader -- strict, no silent fallbacks.

Mirrors tools/HME/proxy/shared/load_env.js semantics for Python entrypoints:
  - Parses KEY=VALUE lines (with quoted-value support).
  - Resolves ${VAR} interpolation against earlier keys + process.environ.
  - Validates that every key declared in doc/templates/.env.example is
    present in the .env file (template = source of truth for required keys).
  - Fails LOUD with a precise message; never invents defaults.

Invariant enforced downstream by verify_coherence.env_no_fallback:
    No `os.environ.get(<KEY>) or <default>` style fallbacks for required
    env keys inside the verify_coherence package. Load .env at entrypoint
    instead; missing keys are bugs to surface, not bugs to paper over.

Usage (from any Python entrypoint, BEFORE importing modules that read env):
    from _env_loader import load_env
    load_env()        # auto-locates .env at project root
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
        eq = line.find("=")
        if eq < 1:
            continue
        k = line[:eq].strip()
        v = line[eq + 1 :].strip()
        # strip trailing " #comment"
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
            v = os.environ.get(key)
            if v is None:
                raise ValueError(f".env references undefined key {key}")
            return v
        resolving.add(key)
        raw = values[key]

        def sub(m: "re.Match[str]") -> str:
            ref = m.group(1)
            r = resolve(ref)
            if r is None or r == "":
                raise ValueError(f"unresolved .env interpolation: {key} references {ref}")
            return r

        out = _INTERP_RE.sub(sub, raw)
        resolving.discard(key)
        expanded[key] = out
        return out

    for k in values:
        resolve(k)
    return expanded


def _validate_against_template(env_path: Path, values: "dict[str, str]") -> None:
    # No .env fallback: HME_ENV_FAILFAST_TEMPLATE must be declared in .env.
    tpl_rel = os.environ['HME_ENV_FAILFAST_TEMPLATE']
    tpl = (env_path.parent / tpl_rel).resolve()
    if not tpl.exists():
        raise FileNotFoundError(
            f"env template missing at {tpl}; .env defaults must live in doc/templates/.env.example"
        )
    declared = {k for k, _ in _parse_env_file(tpl)}
    missing = sorted(declared - set(values.keys()))
    if missing:
        head = ", ".join(missing[:20])
        tail = f" ... {len(missing) - 20} more" if len(missing) > 20 else ""
        raise ValueError(f".env missing template key(s): {head}{tail}")


def _default_env_path() -> Path:
    # tools/HME/scripts/_env_loader.py -> ../../../.env
    return Path(__file__).resolve().parents[3] / ".env"


def load_env(env_path: "str | os.PathLike | None" = None, *, overwrite: bool = False) -> "dict[str, int]":
    """Load .env into os.environ. Returns {loaded, skipped}.

    Strict by design:
      - Missing .env file -> FileNotFoundError
      - Missing template -> FileNotFoundError
      - Missing template keys -> ValueError
      - Cyclic / unresolved interpolation -> ValueError
    """
    p = Path(env_path) if env_path is not None else _default_env_path()
    if not p.exists():
        raise FileNotFoundError(f"missing required .env at {p}")
    raw_pairs = _parse_env_file(p)
    raw_values: dict[str, str] = {}
    for k, v in raw_pairs:
        raw_values[k] = v  # last-wins, matching shell semantics
    values = _expand(raw_values)
    _validate_against_template(p, values)
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
        raise KeyError(
            f"missing required environment key {key}; declare in .env and doc/templates/.env.example"
        )
    return v


if __name__ == "__main__":
    info = load_env()
    print(f"loaded={info['loaded']} skipped={info['skipped']}")
