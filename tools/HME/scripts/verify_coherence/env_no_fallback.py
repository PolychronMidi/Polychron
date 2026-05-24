"""Delegate env fail-fast coherence to the central checker."""
from __future__ import annotations

from pathlib import Path

from ._base import (
    VerdictResult,
    Verifier,
    _PROJECT,
    _run_subprocess,
    failed,
    passed,
    register,
)

_CHECKER_REL = Path("tools") / "HME" / "scripts" / "check-env-failfast.py"


def _details(stdout: str, stderr: str) -> list[str]:
    return [line for line in f"{stdout}\n{stderr}".splitlines() if line.strip()][:80]


@register
class EnvNoFallbackVerifier(Verifier):
    """Run the centralized env fail-fast invariant."""

    name = "env-no-fallback"
    category = "code"
    subtag = "interface-contract"

    def run(self) -> VerdictResult:
        script = str(Path(_PROJECT) / _CHECKER_REL)
        rc, stdout, stderr = _run_subprocess(script, timeout=60)
        if rc != 0:
            return failed("env fail-fast invariant failed", details=_details(stdout, stderr))
        lines = _details(stdout, stderr)
        return passed(lines[-1] if lines else "env fail-fast invariant passed")
