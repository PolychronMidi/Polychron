"""Central .env loader with fail-fast semantics.

Design rule (ONBOARDING + project-wide): every HME configuration value
lives in the project-root `.env` file. No silent fallbacks. If a required
key is missing the process dies at import or at the first accessor call --
we fail fast rather than drift through a broken run with a wrong default.

Usage:

    from hme_env import ENV

    # Required -- raises KeyError on miss
    ARBITER_MODEL = ENV.require("HME_ARBITER_MODEL")
    ARBITER_PORT  = ENV.require_int("HME_ARBITER_PORT")

    # Optional -- explicit opt-in to a default
    WARM_REASONER = ENV.optional_bool("HME_REASONER_WARM", default=False)

Deliberate deviations:
  - API keys (GEMINI_API_KEY, GROQ_API_KEY, ...) are accessed via the same
    loader so a missing credential surfaces at startup instead of on the
    first API call.
  - The loader overwrites os.environ with .env values (not the inverse),
    so a stale shell export can't override the declared project config.
  - Callers must NOT os.environ.get() for HME config. That's the
    violation the loader exists to prevent.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any


class _EnvLoader:
    """Singleton loader that reads .env once and exposes typed accessors."""

    _instance: "_EnvLoader | None" = None

    def __new__(cls) -> "_EnvLoader":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._values = {}
            cls._instance._loaded = False
            cls._instance._path = ""
        return cls._instance

    def _resolve_project_root(self) -> Path:
        # HME_PROJECT_ROOT > PROJECT_ROOT > walk up from this file looking for .env
        for var in ("HME_PROJECT_ROOT", "PROJECT_ROOT"):
            val = os.environ.get(var)
            if val and Path(val).is_dir():
                return Path(val)
        here = Path(__file__).resolve()
        for parent in [here] + list(here.parents):
            if (parent / ".env").exists() and (parent / "doc" / "templates" / "AGENTS.md").exists():
                return parent
        raise RuntimeError(
            "hme_env: cannot resolve project root. Set PROJECT_ROOT in .env "
            "or HME_PROJECT_ROOT in the environment."
        )

    def load(self, force: bool = False) -> None:
        if self._loaded and not force:
            return
        root = self._resolve_project_root()
        env_path = root / ".env"
        if not env_path.is_file():
            raise RuntimeError(
                f"hme_env: no .env file at {env_path}. HME requires a central "
                f".env for all configuration -- create it or set HME_PROJECT_ROOT."
            )
        parsed: dict[str, str] = {}
        with open(env_path, encoding="utf-8") as f:
            for lineno, raw in enumerate(f, 1):
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                # Strip matched surrounding quotes but not partial ones.
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                else:
                    _hash = val.find(" #")
                    if _hash == -1:
                        _hash = val.find("\t#")
                    if _hash != -1:
                        val = val[:_hash].rstrip()
                if not key:
                    continue
                parsed[key] = val
        # Variable expansion: replace ${VAR} references with previously
        import re
        _var_re = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}')
        for key in list(parsed):
            val = parsed[key]
            if '${' not in val:
                continue
            def _repl(m):
                ref = m.group(1)
                return parsed.get(ref, m.group(0))  # leave unknown as-is
            parsed[key] = _var_re.sub(_repl, val)

        self._validate_template_keys(root, parsed)
        self._values = parsed
        self._path = str(env_path)
        self._loaded = True
        # Push into os.environ so child processes (subprocess, llama-server,
        for key, val in parsed.items():
            os.environ[key] = val

    def _template_path(self, root: Path) -> Path:
        configured = os.environ.get("HME_ENV_FAILFAST_TEMPLATE")
        return (root / configured) if configured else (root / "doc" / "templates" / ".env.example")

    def _template_keys(self, path: Path) -> set[str]:
        if not path.is_file():
            raise RuntimeError(
                f"hme_env: missing env template at {path}. Defaults belong in "
                f"doc/templates/.env.example, not inline fallbacks."
            )
        keys: set[str] = set()
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key = line.split("=", 1)[0].strip()
                if key:
                    keys.add(key)
        return keys

    def _validate_template_keys(self, root: Path, parsed: dict[str, str]) -> None:
        template = self._template_path(root)
        missing = sorted(self._template_keys(template) - set(parsed))
        if missing:
            raise RuntimeError(
                "hme_env: .env is missing template key(s) from "
                f"{template}: {', '.join(missing[:20])}"
                + (f" ... {len(missing) - 20} more" if len(missing) > 20 else "")
            )

    def _raw(self, key: str) -> str | None:
        if not self._loaded:
            self.load()
        return self._values.get(key)

    # Required accessors (fail-fast)

    def require(self, key: str) -> str:
        val = self._raw(key)
        if val is None or val == "":
            raise KeyError(
                f"hme_env: required key {key!r} is missing from {self._path}. "
                f"Add it to .env -- no silent defaults are permitted."
            )
        return val

    def require_int(self, key: str) -> int:
        val = self.require(key)
        try:
            return int(val)
        except ValueError as e:
            raise ValueError(
                f"hme_env: {key}={val!r} in {self._path} is not a valid int"
            ) from e

    def require_float(self, key: str) -> float:
        val = self.require(key)
        try:
            return float(val)
        except ValueError as e:
            raise ValueError(
                f"hme_env: {key}={val!r} in {self._path} is not a valid float"
            ) from e

    def require_bool(self, key: str) -> bool:
        val = self.require(key).lower()
        if val in ("1", "true", "yes", "on"):
            return True
        if val in ("0", "false", "no", "off"):
            return False
        raise ValueError(
            f"hme_env: {key}={val!r} in {self._path} is not a valid bool "
            f"(use 1/0, true/false, yes/no, on/off)"
        )

    # Legacy optional accessors are fail-fast now. The default parameter is
    # retained for call-site compatibility only; defaults must be materialized
    # in doc/templates/.env.example and copied into .env.

    def optional(self, key: str, default: str) -> str:
        return self.require(key)

    def optional_int(self, key: str, default: int) -> int:
        return self.require_int(key)

    def optional_float(self, key: str, default: float) -> float:
        return self.require_float(key)

    def optional_bool(self, key: str, default: bool) -> bool:
        return self.require_bool(key)


    # Runtime/transient accessors (process env by design)

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

    # Introspection

    def path(self) -> str:
        if not self._loaded:
            self.load()
        return self._path

    def keys(self) -> list[str]:
        if not self._loaded:
            self.load()
        return sorted(self._values.keys())


ENV = _EnvLoader()
# Eager load so import-time failures surface immediately.
ENV.load()


def _validate_local_model_aliases() -> None:
    """Invariant: arbiter and coder are distinct llama-server aliases.

    Reasoning does NOT live in a local llama-server -- it's served by the
    ranked API cascade (gemini/groq/etc. via synthesis_reasoning). So the
    local-instance invariant is binary: arbiter vs coder. HME_REASONING_MODEL
    is kept for legacy callers but is not a local instance alias; don't
    validate it against the local aliases.

    Why this matters: the fallback chain in fix_antipattern is
    local-coder -> api-reasoning-cascade -> local-arbiter. If arbiter == coder,
    the first and third hop are the same instance and the "fallback" is
    actually a retry. Abort at boot so this can't silently degrade.
    """
    arbiter = ENV.require("HME_ARBITER_MODEL")
    coder = ENV.require("HME_CODER_MODEL")
    if arbiter == coder:
        raise RuntimeError(
            f"hme_env: local llama-server alias collision in {ENV.path()} -- "
            f"HME_ARBITER_MODEL={arbiter!r} equals HME_CODER_MODEL={coder!r}. "
            f"The arbiter and coder must be distinct local instances so the "
            f"synthesis fallback chain has a real last resort. Fix by setting "
            f"HME_ARBITER_MODEL to the arbiter alias (commonly 'hme-arbiter')."
        )


_validate_local_model_aliases()
