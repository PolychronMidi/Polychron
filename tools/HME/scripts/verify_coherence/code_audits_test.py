"""Test/runtime verifiers -- SilentFailureClass, TestIsolation, TestEnvUndefined.
Extracted from code_audits_runtime.py.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    ERROR,
    FAIL,
    METRICS_DIR,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _DOC_DIRS,
    _HOOKS_DIR,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _run_subprocess,
    failed,
    passed,
    register,
    skipped,
    warned,
)


@register
class SilentFailureClassVerifier(Verifier):
    """Delegates to tools/HME/scripts/audit-silent-failure-class.py, which surfaces
    broad-except / catch-and-swallow sites that lack a `silent-ok:`
    annotation.
    """
    name = "silent-failure-class"
    category = "code"
    subtag = "regression-prevention"
    weight = 0.5  # advisory -- annotate over time, don't block merges yet

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-silent-failure-class.py")
        if not os.path.isfile(script):
            return skipped(summary="audit script not found", details=[script])
        rc, out, err = _run_subprocess([script])
        if rc == 0 and "no unmarked silent-catch sites found" in out:
            return passed(summary="no unmarked silent-catch sites found")
        # Parse the "N unmarked silent-catch sites across K files" header
        import re as _re_sf
        m = _re_sf.search(r"(\d+) unmarked silent-catch sites across (\d+) files", out)
        if m:
            count = int(m.group(1))
            files = int(m.group(2))
            # Logarithmic scaling -- expected count is in the hundreds today;
            if count <= 50:
                return passed(summary=f"only {count} unmarked silent-catch sites (<=50 threshold)")
            score = max(0.0, 1.0 - (count - 50) / 1000.0)
            detail_lines = [l for l in out.splitlines() if ":" in l and "audit-silent-failure-class" not in l][:15]
            return warned(score=score, summary=f"{count} unmarked silent-catch sites across {files} files -- annotate with `silent-ok:` over time", details=detail_lines)
        return skipped(summary="could not parse audit output", details=[out[:200], err[:200]])




@register
class TestIsolationVerifier(Verifier):
    """Tests that exercise `runStopChain`, `dispatchEvent`, or `shellPolicy`
    spawn bash hooks that write to log/hme-errors.log via fail-loud
    helpers. Without sandboxing PROJECT_ROOT to a tmp dir AND busting
    require.cache for proxy/+policies/, those writes pollute the real log
    and trip the next Stop hook's LIFESAVER as 'UNADDRESSED ERRORS FROM
    PREVIOUS TURN'.

    Detects: any test file under tools/HME/tests/ that imports/calls one
    of those three symbols MUST also reference a sandbox helper or
    pattern that overrides PROJECT_ROOT to a tmp path."""
    name = "test-isolation-stop-chain"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RISKY_RE = re.compile(r"\b(runStopChain|dispatchEvent|shellPolicy)\b")
    _SANDBOX_RE = re.compile(
        r"_withChainSandbox|_withSandbox|"
        r"PROJECT_ROOT\s*=\s*(?:os\.path\.join\([^)]*tmp|fs\.mkdtempSync|tmp_)"
    )

    def run(self) -> VerdictResult:
        tests_dir = os.path.join(_PROJECT, "tools", "HME", "tests")
        if not os.path.isdir(tests_dir):
            return skipped(summary="tests dir not present")
        violations = []
        scanned = 0
        for r, _d, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith((".js", ".mjs", ".cjs", ".ts")):
                    continue
                scanned += 1
                p = os.path.join(r, f)
                try:
                    with open(p, encoding="utf-8") as fp:
                        src = fp.read()
                except OSError:
                    continue
                if not self._RISKY_RE.search(src):
                    continue
                if self._SANDBOX_RE.search(src):
                    continue
                # Find first risky line for the report
                line_no = "?"
                for i, line in enumerate(src.splitlines(), start=1):
                    if self._RISKY_RE.search(line):
                        line_no = str(i)
                        break
                violations.append(
                    f"{os.path.relpath(p, _PROJECT)}:{line_no}: "
                    f"references runStopChain/dispatchEvent/shellPolicy without "
                    f"_withChainSandbox / _withSandbox / tmp PROJECT_ROOT"
                )
        if not violations:
            return passed(summary=f"{scanned} test file(s) scanned; all stop-chain tests sandbox PROJECT_ROOT")
        score = max(0.0, 1.0 - len(violations) * 0.25)
        return failed(score=score, summary=f"{len(violations)} unsandboxed stop-chain test(s)", details=violations[:10])




@register
class TestEnvUndefinedVerifier(Verifier):
    """In Node test files, `process.env.X = undefined` does NOT delete the
    var -- it sets the literal string 'undefined' (truthy). Later tests
    inherit it and break || fallback patterns. The correct pattern when
    restoring an originally-unset env var is `delete process.env.X`.

    This verifier scans tools/HME/tests/ for the antipattern."""
    name = "test-env-undefined-antipattern"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RE = re.compile(r"process\.env\.[A-Z][A-Z0-9_]*\s*=\s*undefined\b")

    def run(self) -> VerdictResult:
        tests_dir = os.path.join(_PROJECT, "tools", "HME", "tests")
        if not os.path.isdir(tests_dir):
            return skipped(summary="tests dir not present")
        violations = []
        scanned = 0
        for r, _d, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith((".js", ".mjs", ".cjs", ".ts")):
                    continue
                scanned += 1
                p = os.path.join(r, f)
                try:
                    with open(p, encoding="utf-8") as fp:
                        for i, line in enumerate(fp, start=1):
                            stripped = line.lstrip()
                            # Skip JS line comments and block-comment continuations
                            if stripped.startswith("//") or stripped.startswith("*"):
                                continue
                            if self._RE.search(line):
                                violations.append(
                                    f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                    f"process.env.X = undefined (use `delete process.env.X`)"
                                )
                except OSError:
                    continue
        if not violations:
            return passed(summary=f"{scanned} test file(s) scanned; no env-undefined antipattern")
        score = max(0.0, 1.0 - len(violations) * 0.1)
        return failed(score=score, summary=f"{len(violations)} env-undefined antipattern(s)", details=violations[:10])



