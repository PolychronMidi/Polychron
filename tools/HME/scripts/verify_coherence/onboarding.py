"""Onboarding flow, state integrity, chain import, state sync."""
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
    _result,
    _run_subprocess,
    errored,
    failed,
    passed,
    register,
    skipped,
    warned,
)


@register
class StatesSyncVerifier(Verifier):
    name = "states-sync"
    category = "state"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-states-sync.py")
        if not os.path.isfile(script):
            return skipped(summary="verifier script not found")
        rc, out, _err = _run_subprocess(script, timeout=5)
        if rc == 0:
            return passed(summary="Python and shell STATES match", details=[out.splitlines()[0] if out else ""])
        if rc == 1:
            return failed(summary="Python <-> shell STATES drift", details=out.splitlines())
        return errored(summary="verifier returned unexpected code", details=out.splitlines())


@register
class OnboardingFlowVerifier(Verifier):
    name = "onboarding-flow"
    category = "state"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-onboarding-flow.py")
        if not os.path.isfile(script):
            return skipped(summary="verifier script not found")
        rc, out, _err = _run_subprocess(script)
        passed = sum(1 for ln in out.splitlines() if "PASS:" in ln)
        failed = sum(1 for ln in out.splitlines() if "FAIL:" in ln)
        total = passed + failed
        if total == 0:
            return errored(summary="verifier produced no PASS/FAIL output")
        score = passed / total
        if rc == 0:
            return passed(score=score, summary=f"all {total} onboarding tests pass")
        return failed(score=score, summary=f"{failed}/{total} onboarding tests failed", details=[ln for ln in out.splitlines() if "FAIL:" in ln])


@register
class OnboardingStateIntegrityVerifier(Verifier):
    """If state file exists, its value must be in STATES."""
    name = "onboarding-state-integrity"
    category = "state"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        state_file = os.path.join(_PROJECT, "tmp", "hme-onboarding.state")
        if not os.path.isfile(state_file):
            return passed(summary="no state file (graduated or fresh)")
        try:
            with open(state_file) as f:
                cur = f.read().strip()
        except Exception as e:
            return errored(summary=f"could not read state file: {e}")
        # rationale: STATES now loads from tools/HME/config/onboarding_states.json
        # via _load_states(). Check the JSON config first; fall back to inline parse.
        _cfg = os.path.join(_PROJECT, "tools", "HME", "config", "onboarding_states.json")
        try:
            if os.path.isfile(_cfg):
                with open(_cfg) as f:
                    _d = json.load(f)
                valid = _d.get("states", [])
            else:
                raise FileNotFoundError(_cfg)
        except Exception:
            # silent-ok: optional fallback path.
            chain_py = os.path.join(_SERVER_DIR, "onboarding_chain.py")
            try:
                with open(chain_py) as f:
                    src = f.read()
                m = re.search(r'^STATES\s*=\s*\[(.*?)\]', src, re.DOTALL | re.MULTILINE)
                valid = re.findall(r'"([^"]+)"', m.group(1)) if m else []
            except Exception as e:
                return errored(summary=f"could not parse STATES: {e}")
        if cur in valid:
            return passed(summary=f"state '{cur}' is valid")
        return failed(summary=f"state '{cur}' is NOT in STATES", details=[f"valid: {valid}"])


@register
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
            return failed(summary="onboarding_chain.py missing -- state machine broken")
        try:
            with open(path) as f:
                tree = ast.parse(f.read())
        except SyntaxError as e:
            return failed(summary=f"syntax error: {e}")
        # Check for top-level statements that would block import. Ignore the
        # module docstring: it documents decorator order and is not executable.
        risky_patterns = ("FastMCP(", "mcp.tool(", "ensure_ready_sync(")
        for node in tree.body:
            if (
                isinstance(node, ast.Expr)
                and isinstance(getattr(node, "value", None), ast.Constant)
                and isinstance(node.value.value, str)
            ):
                continue
            if isinstance(node, ast.Expr):
                src_snippet = ast.unparse(node) if hasattr(ast, 'unparse') else ""
                for pat in risky_patterns:
                    if pat in src_snippet:
                        return warned(summary=f"top-level {pat} -- would block standalone import")
        return passed(summary="onboarding_chain parses and has no risky top-level calls")



# Registry

