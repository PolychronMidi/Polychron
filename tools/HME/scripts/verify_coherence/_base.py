"""Base types and shared helpers for verify_coherence package.

VerdictResult + Verifier + _result + _run_subprocess + project paths.
Imported by every category module and by __main__.
"""
from __future__ import annotations

import dataclasses
import os
import subprocess
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(_PROJECT, "output", "metrics"))
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "mcp", "server")
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


class Verifier:
    """Each subclass declares name, category, weight, and run()."""
    name: str = ""
    category: str = ""
    weight: float = 1.0

    def run(self) -> VerdictResult:
        raise NotImplementedError

    def execute(self) -> VerdictResult:
        t0 = time.time()
        try:
            result = self.run()
        except Exception as e:
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
