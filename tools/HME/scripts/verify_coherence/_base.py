"""Base types and shared helpers for verify_coherence package.

VerdictResult + Verifier + _result + _run_subprocess + project paths.
Imported by every category module and by __main__.
"""
from __future__ import annotations

import dataclasses
import fnmatch
import os
import subprocess
import time
from pathlib import Path

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(_PROJECT, "output", "metrics"))
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "service", "server")
_SCRIPTS_DIR = os.path.join(_PROJECT, "tools", "HME", "scripts")
_DOC_DIRS = [
    os.path.join(_PROJECT, "doc"),
    os.path.join(_PROJECT, "tools", "HME", "skills"),
]

# Verdict status constants
PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"
SKIP = "SKIP"
ERROR = "ERROR"


@dataclasses.dataclass
class VerdictResult:
    status: str          # PASS | WARN | FAIL | SKIP | ERROR
    score: float         # 0.0 - 1.0
    summary: str         # one-line summary
    details: list        # list of strings (multi-line context)
    duration_ms: float = 0.0

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def _result(status: str, score: float, summary: str, details=None) -> VerdictResult:
    return VerdictResult(
        status=status, score=max(0.0, min(1.0, score)),
        summary=summary, details=details or [],
    )


def severity_for_status(status: str) -> int:
    return {
        PASS: 0,
        SKIP: 0,
        WARN: 1,
        FAIL: 2,
        ERROR: 3,
    }.get(status, 2)


def load_config_jsonc(rel_path: str):
    import sys
    scripts = os.path.join(_PROJECT, "tools", "HME", "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    from jsonc import load_jsonc  # noqa: WPS433
    return load_jsonc(Path(_PROJECT) / rel_path)


def ignore_match(path: str, patterns: list[str] | tuple[str, ...]) -> bool:
    rel = path.replace("\\", "/")
    return any(fnmatch.fnmatch(rel, pat) for pat in patterns)


def iter_project_files(
    roots: list[str] | tuple[str, ...],
    *,
    suffixes: tuple[str, ...] = (),
    ignore: tuple[str, ...] = ("**/__pycache__/**", "**/node_modules/**", "**/.git/**"),
):
    for root in roots:
        base = Path(root)
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            rel = str(p.relative_to(_PROJECT)) if str(p).startswith(_PROJECT) else str(p)
            if suffixes and p.suffix not in suffixes:
                continue
            if ignore_match(rel, ignore):
                continue
            yield p


class Verifier:
    """Each subclass declares name, category, weight, and run().

    `subtag` is an optional finer-grained classifier within a category --
    e.g. `regression-prevention`, `drift-detection`, `freshness`,
    `structural-integrity`, `interface-contract`. Defaults to "" for
    backwards compat; surfaced in text/JSON output so an agent can scan
    "what kind of broken is each red verifier?"."""
    name: str = ""
    category: str = ""
    subtag: str = ""
    weight: float = 1.0

    def run(self) -> VerdictResult:
        raise NotImplementedError

    def execute(self) -> VerdictResult:
        t0 = time.time()
        try:
            result = self.run()
        except Exception as e:
            # silent-ok: optional fallback path.
            import traceback
            result = _result(
                ERROR, 0.0, f"verifier crashed: {type(e).__name__}: {e}",
                [traceback.format_exc()],
            )
        result.duration_ms = (time.time() - t0) * 1000
        return result


def _run_subprocess(script, timeout: int = 30) -> tuple:
    """Run a verifier subprocess, return (returncode, stdout, stderr).
    `script` is either a path string or a [path, *args] list. When a list
    is passed, args are appended to the python3 invocation unchanged."""
    if isinstance(script, list):
        argv = ["python3", *script]
    else:
        argv = ["python3", script]
    rc = subprocess.run(
        argv,
        capture_output=True, text=True, timeout=timeout,
        env={**os.environ, "PROJECT_ROOT": _PROJECT},
    )
    return rc.returncode, rc.stdout, rc.stderr


def env_truthy(value: str | None) -> bool:
    """Truthy-string check for env values: 1/true/yes/on (case-insensitive)."""
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def read_env_var(name: str) -> str | None:
    """Read NAME from os.environ, falling back to project .env file lookup."""
    val = os.environ.get(name)
    if val is not None:
        return val
    env_path = os.path.join(_PROJECT, ".env")
    if not os.path.isfile(env_path):
        return None
    try:
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                stripped = line.strip()
                if stripped.startswith(f"{name}="):
                    return stripped[len(name) + 1:].split("#", 1)[0].strip()
    except OSError:
        return None  # silent-ok: best-effort fs op
    return None
