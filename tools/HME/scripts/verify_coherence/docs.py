"""Documentation verifiers: drift, numeric claims, docstring presence."""
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


class DocDriftVerifier(Verifier):
    name = "doc-drift"
    category = "doc"
    weight = 2.0  # critical: stale docs mislead every agent

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-doc-sync.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found", [script])
        rc, out, err = _run_subprocess(script)
        hits = None
        for ln in out.splitlines():
            if ln.startswith("Drift hits:"):
                try:
                    hits = int(ln.split(":", 1)[1].strip())
                except ValueError:
                    pass
                break
        if hits is None:
            return _result(ERROR, 0.0, "could not parse verifier output", [err[:500]])
        if hits == 0:
            return _result(PASS, 1.0, "no legacy tool references in any doc")
        score = max(0.0, 1.0 - hits / 20.0)  # 20 hits = score 0
        return _result(FAIL, score, f"{hits} legacy tool reference(s)",
                       out.splitlines()[:30])


class NumericClaimDriftVerifier(Verifier):
    """Markdown docs that state specific counts (e.g. `19 hypermeta
    controllers`, `12 CIM dials`, `38 verifiers`) must match the live
    codebase count. Delegates to verify-numeric-drift.py, which owns the
    claims manifest and the ground-truth counters."""
    name = "numeric-claim-drift"
    category = "doc"
    weight = 1.5

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-numeric-drift.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse verifier output", [err[:500]])
        drift_count = payload.get("drift_count", 0)
        if drift_count == 0:
            return _result(PASS, 1.0,
                           f"all numeric claims match code (truth: {payload.get('truth', {})})")
        # 10 drifts = score 0. The threshold is tight — each drift is a
        # specific doc claim that now misleads readers.
        score = max(0.0, 1.0 - drift_count / 10.0)
        examples = [f"{d['file']}:{d['line']} {d['claim']} stated={d['stated']} actual={d['actual']}"
                    for d in payload.get("drifts", [])[:20]]
        return _result(FAIL, score,
                       f"{drift_count} numeric drift(s) across "
                       f"{len(set(d['claim'] for d in payload.get('drifts', [])))} claim(s)",
                       examples)


class DocstringPresenceVerifier(Verifier):
    """Every @ctx.mcp.tool() function has a non-empty docstring."""
    name = "tool-docstrings"
    category = "doc"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        missing = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    has_tool_dec = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Attribute)
                        and d.func.attr == "tool"
                        for d in node.decorator_list
                    )
                    if not has_tool_dec:
                        continue
                    total += 1
                    docstring = ast.get_docstring(node)
                    if not docstring or len(docstring.strip()) < 30:
                        missing.append(f"{f}::{node.name}")
        if total == 0:
            return _result(SKIP, 1.0, "no @ctx.mcp.tool() functions found")
        score = 1.0 - len(missing) / total
        if not missing:
            return _result(PASS, 1.0, f"{total}/{total} tools have docstrings")
        return _result(FAIL if score < 0.7 else WARN, score,
                       f"{len(missing)}/{total} tools missing/short docstrings",
                       missing)



# Verifiers — CODE category


