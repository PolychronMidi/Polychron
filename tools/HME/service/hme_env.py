"""Fail-fast HME environment loader.

Every HME configuration value lives in the project-root .env file. Missing
keys raise instead of drifting through silent defaults. Runtime/transient
values remain explicit via the runtime_* accessors.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class _EnvLoader:
    """Singleton loader that reads root .env once and exposes typed accessors."""

    _instance: "_EnvLoader | None" = None

    def __new__(cls) -> "_EnvLoader":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._values = {}
            cls._instance._loaded = False
            cls._instance._path = ""
        return cls._instance

    def _resolve_project_root(self) -> Path:
        for var in ("HME_PROJECT_ROOT", "PROJECT_ROOT"):
            val = os.environ.get(var)
            if val and Path(val).is_dir():
                return Path(val)
        here = Path(__file__).resolve()
        for parent in [here] + list(here.parents):
            if (parent / ".env").exists() and (parent / "doc" / "templates" / "AGENTS.md").exists():
                return parent
        raise RuntimeError("hme_env: cannot resolve project root; set PROJECT_ROOT or HME_PROJECT_ROOT")

    def _parse(self, env_path: Path) -> dict[str, str]:
        parsed: dict[str, str] = {}
        with open(env_path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].lstrip()
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                else:
                    hash_at = val.find(" #")
                    if hash_at == -1:
                        hash_at = val.find("\t#")
                    if hash_at != -1:
                        val = val[:hash_at].rstrip()
                if key:
                    parsed[key] = val
        return parsed

    def _expand(self, parsed: dict[str, str]) -> dict[str, str]:
        expanded: dict[str, str] = {}
        resolving: set[str] = set()

        def resolve(key: str) -> str:
            if key in expanded:
                return expanded[key]
            if key in resolving:
                raise RuntimeError(f"hme_env: cyclic .env interpolation involving {key}")
            if key not in parsed:
                raise RuntimeError(f"hme_env: .env references undefined key {key}")
            resolving.add(key)

            def repl(match: re.Match[str]) -> str:
                ref = match.group(1)
                value = resolve(ref)
                if value == "":
                    raise RuntimeError(f"hme_env: unresolved .env interpolation {key} references {ref}")
                return value

            value = _VAR_RE.sub(repl, parsed[key])
            resolving.discard(key)
            expanded[key] = value
            return value

        for key in parsed:
            resolve(key)
        return expanded

    def load(self, force: bool = False) -> None:
        if self._loaded and not force:
            return
        root = self._resolve_project_root()
        env_path = root / ".env"
        if not env_path.is_file():
            raise RuntimeError(f"hme_env: missing required root .env at {env_path}")
        parsed = self._expand(self._parse(env_path))
        self._values = parsed
        self._path = str(env_path)
        self._loaded = True
        for key, val in parsed.items():
            os.environ[key] = val

    def _raw(self, key: str) -> str | None:
        if not self._loaded:
            self.load()
        return self._values.get(key)

    def require(self, key: str) -> str:
        val = self._raw(key)
        if val is None or val == "":
            raise KeyError(f"hme_env: required key {key!r} is missing from {self._path}")
        return val

    def require_int(self, key: str) -> int:
        val = self.require(key)
        try:
            return int(val)
        except ValueError as e:
            raise ValueError(f"hme_env: {key}={val!r} in {self._path} is not a valid int") from e

    def require_float(self, key: str) -> float:
        val = self.require(key)
        try:
            return float(val)
        except ValueError as e:
            raise ValueError(f"hme_env: {key}={val!r} in {self._path} is not a valid float") from e

    def require_bool(self, key: str) -> bool:
        val = self.require(key).lower()
        if val in ("1", "true", "yes", "on"):
            return True
        if val in ("0", "false", "no", "off"):
            return False
        raise ValueError(f"hme_env: {key}={val!r} in {self._path} is not a valid bool")

    def optional(self, key: str, default: str) -> str:
        return self.require(key)

    def optional_int(self, key: str, default: int) -> int:
        return self.require_int(key)

    def optional_float(self, key: str, default: float) -> float:
        return self.require_float(key)

    def optional_bool(self, key: str, default: bool) -> bool:
        return self.require_bool(key)

    def runtime_optional(self, key: str, default: str) -> str:
        val = os.environ.get(key)
        return val if val else default

    def runtime_int(self, key: str, default: int) -> int:
        val = os.environ.get(key)
        if val is None or val == "":
            return default
        try:
            return int(val)
        except ValueError as e:
            raise ValueError(f"hme_env: runtime {key}={val!r} is not a valid int") from e

    def runtime_bool(self, key: str, default: bool = False) -> bool:
        val = os.environ.get(key)
        if val is None or val == "":
            return default
        v = val.lower()
        if v in ("1", "true", "yes", "on"):
            return True
        if v in ("0", "false", "no", "off"):
            return False
        raise ValueError(f"hme_env: runtime {key}={val!r} is not a valid bool")

    def path(self) -> str:
        if not self._loaded:
            self.load()
        return self._path

    def keys(self) -> list[str]:
        if not self._loaded:
            self.load()
        return sorted(self._values.keys())


ENV = _EnvLoader()
ENV.load()


def _validate_local_model_aliases() -> None:
    """Arbiter and coder must be distinct local llama-server aliases."""
    arbiter = ENV.require("HME_ARBITER_MODEL")
    coder = ENV.require("HME_CODER_MODEL")
    if arbiter == coder:
        raise RuntimeError(
            f"hme_env: local llama-server alias collision in {ENV.path()} -- "
            f"HME_ARBITER_MODEL={arbiter!r} equals HME_CODER_MODEL={coder!r}. "
            "The arbiter and coder must be distinct local instances."
        )


_validate_local_model_aliases()
