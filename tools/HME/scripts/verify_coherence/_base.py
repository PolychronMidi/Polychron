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

# Invariant: no silent .env fallbacks. Required env keys MUST be present
# via .env (loaded by the entrypoint shim). Missing keys fail loud with a
# clear pointer. Enforced by EnvNoFallbackVerifier; do not reintroduce
# `os.environ.get(<KEY>) or <default>` for keys declared in .env.
_PROJECT = os.environ['PROJECT_ROOT']
METRICS_DIR = os.environ['HME_METRICS_DIR']
PROJECT_METRICS_DIR = os.environ.get("COMPOSITION_METRICS_DIR") or os.environ['METRICS_DIR']
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


def passed(summary: str, *, details=None, score: float = 1.0) -> VerdictResult:
    """Verdict: PASS. Score defaults to 1.0; override for graduated passes."""
    return _result(PASS, score, summary, details)


def warned(summary: str, *, details=None, score: float = 0.5) -> VerdictResult:
    """Verdict: WARN. Score defaults to 0.5; override per-warning severity."""
    return _result(WARN, score, summary, details)


def failed(summary: str, *, details=None, score: float = 0.0) -> VerdictResult:
    """Verdict: FAIL. Score defaults to 0.0; override for partial failures."""
    return _result(FAIL, score, summary, details)


def skipped(summary: str, *, details=None) -> VerdictResult:
    """Verdict: SKIP. Score is always 1.0 -- a skipped verifier doesn't
    dock the HCI; it just opts out for this run."""
    return _result(SKIP, 1.0, summary, details)


def errored(summary: str, *, details=None) -> VerdictResult:
    """Verdict: ERROR. Score is always 0.0 -- the verifier itself broke."""
    return _result(ERROR, 0.0, summary, details)


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


def telemetry_events() -> list[dict]:
    import sys
    activity_dir = os.path.join(_PROJECT, "tools", "HME", "activity")
    if activity_dir not in sys.path:
        sys.path.insert(0, activity_dir)
    from event_registry import events  # noqa: WPS433
    return events()


def telemetry_event_names(*, stream: str | None = None,
                          group: str | None = None) -> set[str]:
    return {
        event["name"]
        for event in telemetry_events()
        if (stream is None or stream in event["streams"])
        and (group is None or group in event["groups"])
    }


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


CORE_SKIP_DIRS = frozenset({
    ".git", ".venv", "venv", ".pytest_cache", "__pycache__",
    "node_modules", "log", "tmp", "runtime", ".claude",
})


def walk_tracked_files(root, *, suffixes=(), extra_skip_dirs=()):
    """Walk `root` yielding Path objects for files outside SKIP_DIRS.

    Prefers `git ls-files --cached --others --exclude-standard` so
    .gitignore is the source of truth; falls back to a SKIP_DIRS-filtered
    os.walk in non-git environments. `extra_skip_dirs` augments
    CORE_SKIP_DIRS for filesystem walks (no effect in the git path,
    which already respects .gitignore).
    """
    root = Path(root)
    skip = CORE_SKIP_DIRS | frozenset(extra_skip_dirs)
    suffix_set = frozenset(suffixes) if suffixes else None
    try:
        rc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--cached", "--others",
             "--exclude-standard"],
            capture_output=True, text=True, timeout=30, check=True,
        )
        for line in rc.stdout.splitlines():
            rel = line.strip()
            if not rel:
                continue
            p = Path(rel)
            if suffix_set is not None and p.suffix not in suffix_set:
                continue
            yield p
        return
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            FileNotFoundError, OSError):
        pass
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith(".")]
        for fn in filenames:
            try:
                rel = (Path(dirpath) / fn).relative_to(root)
            except ValueError:
                continue
            if suffix_set is not None and rel.suffix not in suffix_set:
                continue
            yield rel


_RUNTIME_CATEGORIES = frozenset({"runtime"})

_REGISTRY: list = []


def register(cls):
    """Decorator: add a verifier instance to the module-level _REGISTRY.

    The REGISTRY exposed from verify_coherence.__init__ is just this
    list, populated at import time. Order is import order -- file order
    in __init__.py times class-declaration order within each file.
    """
    _REGISTRY.append(cls())
    return cls


class Verifier:
    """Each subclass declares name, category, weight, and run().

    `subtag` -- finer classifier within a category (regression-prevention,
    drift-detection, freshness, structural-integrity, interface-contract).

    `kind` defaults to "runtime" iff category in _RUNTIME_CATEGORIES, else
    "static". Subclasses can override the `kind` class attribute to opt
    out (e.g. a verifier in category="state" that probes live processes).
    Static verifiers are deterministic file analyses that block commits;
    runtime verifiers touch the live system and surface observability
    without gating.
    """
    name: str = ""
    category: str = ""
    subtag: str = ""
    weight: float = 1.0

    @property
    def kind(self) -> str:
        return "runtime" if self.category in _RUNTIME_CATEGORIES else "static"

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
