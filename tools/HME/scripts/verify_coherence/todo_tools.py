"""Todo store schema + merge consistency + tool-surface coverage."""
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


class TodoStoreSchemaVerifier(Verifier):
    """Every entry in todos.json has the required canonical fields."""
    name = "todo-store-schema"
    category = "state"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
        if not os.path.isfile(store):
            return _result(SKIP, 1.0, "no todo store (fresh project)")
        try:
            with open(store) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"todos.json invalid JSON: {e}")
        if not isinstance(data, list):
            return _result(FAIL, 0.0, "todos.json is not a JSON array")
        violations = []
        # First entry should be _meta (or be a regular entry from legacy schema)
        for i, entry in enumerate(data):
            if not isinstance(entry, dict):
                violations.append(f"[{i}] not a dict")
                continue
            if entry.get("id") == 0 and "_meta" in entry:
                # Header entry
                continue
            for required in ("id", "text", "status", "done"):
                if required not in entry:
                    violations.append(f"[{i}] missing field '{required}'")
                    break
        score = 1.0 - min(1.0, len(violations) / max(1, len(data)))
        if not violations:
            return _result(PASS, 1.0, f"{len(data)} entries pass schema check")
        return _result(WARN, score, f"{len(violations)} schema violations", violations[:10])



# Verifiers — COVERAGE category


class ToolSurfaceCoverageVerifier(Verifier):
    """Every public @ctx.mcp.tool() function appears in either AGENT_PRIMER.md
    or HME.md. Hidden tools don't need to be documented."""
    name = "tool-surface-coverage"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        public_tools = set()
        hidden_tools = set()
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path) as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    for dec in node.decorator_list:
                        if not (isinstance(dec, ast.Call)
                                and isinstance(dec.func, ast.Attribute)
                                and dec.func.attr == "tool"):
                            continue
                        # Check meta={"hidden": True}
                        is_hidden = False
                        for kw in dec.keywords:
                            if kw.arg == "meta" and isinstance(kw.value, ast.Dict):
                                for k, v in zip(kw.value.keys, kw.value.values):
                                    if (isinstance(k, ast.Constant) and k.value == "hidden"
                                            and isinstance(v, ast.Constant) and v.value):
                                        is_hidden = True
                        if is_hidden:
                            hidden_tools.add(node.name)
                        else:
                            public_tools.add(node.name)
        if not public_tools:
            return _result(SKIP, 1.0, "no public tools found")
        # Check each public tool appears in primer/HME.md
        primer = os.path.join(_PROJECT, "doc", "AGENT_PRIMER.md")
        hmemd = os.path.join(_PROJECT, "doc", "HME.md")
        text = ""
        for p in (primer, hmemd):
            if os.path.isfile(p):
                with open(p) as f:
                    text += f.read()
        missing = sorted(t for t in public_tools if t not in text)
        if not missing:
            return _result(PASS, 1.0, f"all {len(public_tools)} public tools documented",
                           [f"public: {sorted(public_tools)}", f"hidden: {sorted(hidden_tools)}"])
        score = 1.0 - len(missing) / len(public_tools)
        return _result(WARN, score, f"{len(missing)}/{len(public_tools)} public tools undocumented",
                       missing)



# Verifiers — RUNTIME category


class TodoMergeHookConsistencyVerifier(Verifier):
    """The TodoWrite hook should NOT block — it should exit 0 so native
    TodoWrite proceeds. If it ever goes back to exit 2 / decision:block the
    agent's session-visible todo list freezes. This regression check."""
    name = "todowrite-hook-nonblock"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        hook = os.path.join(_HOOKS_DIR, "pretooluse_todowrite.sh")
        if not os.path.isfile(hook):
            return _result(SKIP, 1.0, "todowrite hook not found")
        try:
            with open(hook) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Regression check: must NOT contain a blocking decision
        if '"decision":"block"' in src or "'decision':'block'" in src:
            return _result(FAIL, 0.0,
                           "TodoWrite hook has a blocking decision — native TodoWrite will be frozen",
                           ["remove the decision: block to restore native TodoWrite"])
        if "exit 2" in src:
            return _result(FAIL, 0.5,
                           "TodoWrite hook has exit 2 — may block native TodoWrite",
                           ["replace exit 2 with exit 0 so native TodoWrite proceeds"])
        if "exit 0" not in src:
            return _result(WARN, 0.5, "TodoWrite hook has no explicit exit 0")
        return _result(PASS, 1.0, "TodoWrite hook allows native TodoWrite to proceed")


