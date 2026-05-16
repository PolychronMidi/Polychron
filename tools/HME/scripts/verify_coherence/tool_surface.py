"""Tool-surface and native TodoWrite contract verifiers."""
from __future__ import annotations

import ast
import os
import re

from ._base import (
    Verifier, VerdictResult, _result,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _SERVER_DIR,
)


class ToolSurfaceCoverageVerifier(Verifier):
    """Every public @ctx.mcp.tool() function appears in either templates/ONBOARDING.md
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
                    # silent-ok: optional fallback path.
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
        primer = os.path.join(_PROJECT, "doc", "templates", "ONBOARDING.md")
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



# Verifiers -- RUNTIME category


class TodoMergeHookConsistencyVerifier(Verifier):
    """The native TodoWrite hook should merge updatedInput without blocking."""
    name = "todowrite-hook-nonblock"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        hook = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "native_hooks", "todo.js")
        if not os.path.isfile(hook):
            return _result(SKIP, 1.0, "native TodoWrite hook not found")
        try:
            with open(hook) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        m = re.search(r'async function pretoolTodoWrite\(.*?\n}\n\nasync function posttoolTodoWrite', src, re.DOTALL)
        if not m:
            return _result(FAIL, 0.0, "pretoolTodoWrite handler not found")
        body = m.group(0)
        if "hookBlock(" in body or '"decision":"block"' in body or "'decision':'block'" in body:
            return _result(FAIL, 0.0,
                           "TodoWrite handler has a blocking decision -- native TodoWrite will be frozen",
                           ["return allow(...updatedInput...) so native TodoWrite proceeds"])
        if "updatedInput" not in body or "return allow" not in body:
            return _result(FAIL, 0.5,
                           "TodoWrite handler does not visibly return allow(...updatedInput...)",
                           ["preserve native TodoWrite with a merged updatedInput payload"])
        return _result(PASS, 1.0, "TodoWrite hook allows native TodoWrite to proceed")
