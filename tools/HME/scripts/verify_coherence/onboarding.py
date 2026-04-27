"""Onboarding flow, state integrity, chain import, state sync."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class StatesSyncVerifier(Verifier):
    name = "states-sync"
    category = "state"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-states-sync.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found")
        rc, out, _err = _run_subprocess(script, timeout=5)
        if rc == 0:
            return _result(PASS, 1.0, "Python and shell STATES match",
                           [out.splitlines()[0] if out else ""])
        if rc == 1:
            return _result(FAIL, 0.0, "Python ↔ shell STATES drift", out.splitlines())
        return _result(ERROR, 0.0, "verifier returned unexpected code", out.splitlines())


class OnboardingFlowVerifier(Verifier):
    name = "onboarding-flow"
    category = "state"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-onboarding-flow.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found")
        rc, out, _err = _run_subprocess(script)
        passed = sum(1 for ln in out.splitlines() if "PASS:" in ln)
        failed = sum(1 for ln in out.splitlines() if "FAIL:" in ln)
        total = passed + failed
        if total == 0:
            return _result(ERROR, 0.0, "verifier produced no PASS/FAIL output")
        score = passed / total
        if rc == 0:
            return _result(PASS, score, f"all {total} onboarding tests pass")
        return _result(FAIL, score, f"{failed}/{total} onboarding tests failed",
                       [ln for ln in out.splitlines() if "FAIL:" in ln])


class OnboardingStateIntegrityVerifier(Verifier):
    """If state file exists, its value must be in STATES."""
    name = "onboarding-state-integrity"
    category = "state"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        state_file = os.path.join(_PROJECT, "tmp", "hme-onboarding.state")
        if not os.path.isfile(state_file):
            return _result(PASS, 1.0, "no state file (graduated or fresh)")
        try:
            with open(state_file) as f:
                cur = f.read().strip()
        except Exception as e:
            return _result(ERROR, 0.0, f"could not read state file: {e}")
        # Parse STATES from onboarding_chain.py
        chain_py = os.path.join(_SERVER_DIR, "onboarding_chain.py")
        try:
            with open(chain_py) as f:
                src = f.read()
            m = re.search(r'^STATES\s*=\s*\[(.*?)\]', src, re.DOTALL | re.MULTILINE)
            valid = re.findall(r'"([^"]+)"', m.group(1)) if m else []
        except Exception as e:
            return _result(ERROR, 0.0, f"could not parse STATES: {e}")
        if cur in valid:
            return _result(PASS, 1.0, f"state '{cur}' is valid")
        return _result(FAIL, 0.0, f"state '{cur}' is NOT in STATES",
                       [f"valid: {valid}"])


class OnboardingChainImportVerifier(Verifier):
    """onboarding_chain.py should import cleanly (no syntax errors or
    top-level side effects that require the MCP server)."""
    name = "onboarding-chain-importable"
    category = "state"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        path = os.path.join(_SERVER_DIR, "onboarding_chain.py")
        if not os.path.isfile(path):
            return _result(FAIL, 0.0, "onboarding_chain.py missing — state machine broken")
        try:
            with open(path) as f:
                tree = ast.parse(f.read())
        except SyntaxError as e:
            return _result(FAIL, 0.0, f"syntax error: {e}")
        # Check for top-level statements that would block import
        risky_patterns = ("FastMCP(", "mcp.tool(", "ensure_ready_sync(")
        for node in tree.body:
            if isinstance(node, ast.Expr):
                src_snippet = ast.unparse(node) if hasattr(ast, 'unparse') else ""
                for pat in risky_patterns:
                    if pat in src_snippet:
                        return _result(
                            WARN, 0.5,
                            f"top-level {pat} — would block standalone import",
                        )
        return _result(PASS, 1.0, "onboarding_chain parses and has no risky top-level calls")



# Registry


