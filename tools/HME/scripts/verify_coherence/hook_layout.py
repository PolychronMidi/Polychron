"""Hook registration, matcher validity, executability, decorator order."""
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


class HookExecutabilityVerifier(Verifier):
    """Every non-helper hook script must be +x."""
    name = "hook-executability"
    category = "code"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        broken = []
        total = 0
        for f in sorted(os.listdir(_HOOKS_DIR)):
            if not f.endswith(".sh"):
                continue
            if f.startswith("_"):  # helpers, sourced not executed
                continue
            total += 1
            path = os.path.join(_HOOKS_DIR, f)
            if not os.access(path, os.X_OK):
                broken.append(f)
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} dispatcher hooks are executable")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} hooks not executable",
                       [f"chmod +x tools/HME/hooks/{name}" for name in broken])


class DecoratorOrderVerifier(Verifier):
    """Every @chained tool must have @ctx.mcp.tool() OUTERMOST."""
    name = "decorator-order"
    category = "code"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        import ast
        violations = []
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
                    decs = node.decorator_list
                    has_chained = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Name)
                        and d.func.id == "chained"
                        for d in decs
                    )
                    has_tool = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Attribute)
                        and d.func.attr == "tool"
                        for d in decs
                    )
                    if not has_chained:
                        continue
                    total += 1
                    if not has_tool:
                        violations.append(f"{os.path.relpath(path, _PROJECT)}::{node.name} (no @ctx.mcp.tool())")
                        continue
                    # decorator_list[0] is OUTERMOST
                    outermost = decs[0]
                    is_tool = (
                        isinstance(outermost, ast.Call)
                        and isinstance(outermost.func, ast.Attribute)
                        and outermost.func.attr == "tool"
                    )
                    if not is_tool:
                        violations.append(f"{os.path.relpath(path, _PROJECT)}::{node.name} (@chained outside @ctx.mcp.tool())")
        if total == 0:
            return _result(SKIP, 1.0, "no @chained tools found")
        if not violations:
            return _result(PASS, 1.0, f"{total}/{total} chained tools have correct order")
        score = 1.0 - len(violations) / total
        return _result(FAIL, score, f"{len(violations)}/{total} chained tools wrong order",
                       violations)



# Verifiers — STATE category


class HookRegistrationVerifier(Verifier):
    """Every matcher in hooks.json points to a real .sh file."""
    name = "hook-registration"
    category = "coverage"
    subtag = "structural-integrity"
    weight = 1.5

    def run(self) -> VerdictResult:
        hooks_json = os.path.join(_HOOKS_DIR, "hooks.json")
        try:
            with open(hooks_json) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"hooks.json invalid: {e}")
        missing = []
        total = 0
        for _event_name, entries in data.get("hooks", {}).items():
            for entry in entries:
                for hook in entry.get("hooks", []):
                    cmd = hook.get("command", "")
                    m = re.search(r'(?:CLAUDE_PLUGIN_ROOT|hooks)/(\w+\.sh)', cmd)
                    if m:
                        total += 1
                        script = os.path.join(_HOOKS_DIR, m.group(1))
                        if not os.path.isfile(script):
                            missing.append(m.group(1))
        if total == 0:
            return _result(SKIP, 1.0, "no hook registrations found")
        if not missing:
            return _result(PASS, 1.0, f"{total}/{total} hook registrations resolve")
        score = 1.0 - len(missing) / total
        return _result(FAIL, score, f"{len(missing)}/{total} hooks reference missing files",
                       missing)


class HookMatcherValidityVerifier(Verifier):
    """Post-MCP-decoupling surface check. Every `i/<tool>` wrapper in the
    project's `i/` directory must either (a) have a matching dispatch branch
    in `posttooluse_bash.sh` for post-hooks that need to run after it, or
    (b) be explicitly known-not-to-have-a-posthook. Conversely, every
    dispatch branch in `posttooluse_bash.sh` must reference a wrapper that
    actually exists. Catches the drift where a wrapper is renamed but the
    hook still dispatches on the old name (or vice versa) — silently dead
    hook path.
    """
    name = "hook-matcher-validity"
    category = "coverage"
    weight = 2.0  # high: silently-dead hooks are a major self-coherence failure

    # Wrappers that have no posttooluse side-effect by design. Claude just
    # reads the response; there's no nexus state to update.
    #   help / why       — static / rationale-lookup; read-only
    #   freeze           — flips a flag file; posttooluse doesn't need to know
    #   pattern          — pattern-file reader; read-only
    #   substrate        — four-arc status; read-only
    _NO_POSTHOOK_OK = {
        "status", "trace", "evolve", "hme-admin", "todo", "hme",
        "help", "why", "freeze", "pattern", "substrate",
    }

    def run(self) -> VerdictResult:
        import re

        project_root = os.environ.get("PROJECT_ROOT", _PROJECT)
        i_dir = os.path.join(project_root, "i")
        if not os.path.isdir(i_dir):
            return _result(FAIL, 0.0, "i/ directory missing — HME tool wrappers not installed")

        # Enumerate wrappers (executable shell scripts in i/).
        wrappers = set()
        try:
            for name in os.listdir(i_dir):
                p = os.path.join(i_dir, name)
                if os.path.isfile(p) and os.access(p, os.X_OK):
                    wrappers.add(name)
        except OSError as e:
            return _result(FAIL, 0.0, f"i/ unreadable: {e}")

        # Read posttooluse_bash.sh and collect dispatched tool names.
        posthook_path = os.path.join(_HOOKS_DIR, "posttooluse", "posttooluse_bash.sh")
        try:
            with open(posthook_path) as fp:
                posthook_src = fp.read()
        except OSError as e:
            return _result(FAIL, 0.0, f"posttooluse_bash.sh unreadable: {e}")

        # Pattern: `i/<tool>\b` inside regexes within the dispatcher block.
        dispatched = set(re.findall(r'i/([a-z-]+)\\b', posthook_src))

        # A wrapper with a posthook dispatch is "covered". A wrapper on the
        # NO_POSTHOOK_OK list is "explicitly excluded". Anything else is
        # silently uncovered.
        uncovered = [w for w in wrappers
                     if w not in dispatched and w not in self._NO_POSTHOOK_OK]
        # Conversely, any dispatch target that doesn't correspond to a
        # wrapper is a dead branch.
        dead_dispatches = [t for t in dispatched if t not in wrappers]

        errors = []
        for w in uncovered:
            errors.append(f"wrapper i/{w} has no posthook dispatch and is not in _NO_POSTHOOK_OK")
        for t in dead_dispatches:
            errors.append(f"posttooluse_bash.sh dispatches on i/{t} but no such wrapper exists")

        total_checks = len(wrappers) + len(dispatched)
        if total_checks == 0:
            return _result(SKIP, 1.0, "no wrappers or dispatches to check")
        if not errors:
            return _result(
                PASS, 1.0,
                f"{len(wrappers)} wrappers × {len(dispatched)} dispatches all resolve"
            )
        score = 1.0 - len(errors) / total_checks
        return _result(FAIL, score, f"{len(errors)} wrapper/dispatch mismatch(es)", errors)


