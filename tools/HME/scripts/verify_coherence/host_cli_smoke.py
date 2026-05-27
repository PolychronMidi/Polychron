"""Optional real host CLI smoke verifier.

Gated because it spends live model/provider calls and can take minutes.
Enable explicitly with HME_RUN_CLI_SMOKE=1.
"""
from __future__ import annotations

import json
import os
import subprocess

from ._base import VerdictResult, Verifier, _PROJECT, passed, failed, skipped, register


@register
class HostCliSmokeVerifier(Verifier):
    """Run end-to-end CLI smoke across Claude, Codex, and OpenCode when enabled."""

    name = "host-cli-smoke"
    category = "runtime"
    subtag = "end-to-end"
    weight = 1.0

    def run(self) -> VerdictResult:
        if os.environ.get("HME_RUN_CLI_SMOKE") != "1":
            return skipped(summary="set HME_RUN_CLI_SMOKE=1 to run live Claude/Codex/OpenCode CLI smoke")
        script = os.path.join(_PROJECT, "tools", "HME", "scripts", "smoke_host_cli.py")
        timeout = int(os.environ.get("HME_CLI_SMOKE_TIMEOUT", "180"))
        proc = subprocess.run(
            ["python3", script, "--all", "--timeout", str(timeout), "--json"],
            cwd=_PROJECT,
            capture_output=True,
            text=True,
            timeout=timeout * 3 + 30,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        try:
            results = json.loads(proc.stdout or "[]")
        except Exception as exc:
            return failed(summary=f"CLI smoke did not produce JSON: {exc}",
                          details=[(proc.stdout or "")[-1000:], (proc.stderr or "")[-1000:]])
        failures: list[str] = []
        for row in results:
            if row.get("ok"):
                continue
            host = row.get("host", "unknown")
            for item in row.get("failures", []) or ["unknown failure"]:
                failures.append(f"{host}: {item}")
            if row.get("stderr_tail"):
                failures.append(f"{host} stderr_tail: {row.get('stderr_tail')[-300:]}")
        if failures:
            return failed(summary=f"{len(failures)} host CLI smoke issue(s)", details=failures[:20])
        return passed(summary="Claude, Codex, and OpenCode CLI smoke passed")
