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
                    # silent-ok: optional fallback path.
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



# Verifiers -- STATE category


class HookRegistrationVerifier(Verifier):
    """hooks.json must route every event through the portable event kernel."""
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
        hooks = data.get("hooks", {})
        required = {
            "SessionStart", "PreToolUse", "PostToolUse", "UserPromptSubmit",
            "PreCompact", "PostCompact", "Stop", "StatusLine",
        }
        issues = []
        missing_events = sorted(required - set(hooks))
        if missing_events:
            issues.append(f"missing hook event(s): {missing_events}")
        adapter = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "claude_adapter.js")
        statusline = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "statusline.js")
        if not os.path.isfile(adapter):
            issues.append("missing event_kernel/claude_adapter.js")
        if not os.path.isfile(statusline):
            issues.append("missing event_kernel/statusline.js")
        total = 0
        for event in sorted(required & set(hooks)):
            entries = hooks.get(event)
            if not isinstance(entries, list) or not entries:
                issues.append(f"{event}: no hook entries")
                continue
            for entry in entries:
                for hook in entry.get("hooks", []):
                    total += 1
                    cmd = str(hook.get("command", ""))
                    timeout = hook.get("timeout")
                    if hook.get("type") != "command":
                        issues.append(f"{event}: hook type must be command")
                    if not isinstance(timeout, int) or timeout <= 0:
                        issues.append(f"{event}: timeout must be positive integer")
                    if event == "StatusLine":
                        if "event_kernel/statusline.js" not in cmd:
                            issues.append("StatusLine: must route through event_kernel/statusline.js")
                    else:
                        if "event_kernel/claude_adapter.js" not in cmd:
                            issues.append(f"{event}: must route through event_kernel/claude_adapter.js")
                        if event not in cmd:
                            issues.append(f"{event}: adapter command missing event argument")
                    if re.search(r"tools/HME/hooks/.+\.sh|/hooks/.+\.sh", cmd):
                        issues.append(f"{event}: direct shell hook command is not portable")
        if total == 0:
            issues.append("no command hooks registered")
        if not issues:
            return _result(PASS, 1.0, f"{len(required)} event-kernel hook registrations resolve")
        score = max(0.0, 1.0 - len(issues) / max(1, len(required)))
        return _result(FAIL, score, f"{len(issues)} hook registration issue(s)", issues[:12])


class HookMatcherValidityVerifier(Verifier):
    """Post-MCP-decoupling surface check. Every `i/<tool>` wrapper in the
    project's `i/` directory must either (a) have a matching dispatch branch
    in `posttooluse_bash.sh` for post-hooks that need to run after it, or
    (b) be explicitly known-not-to-have-a-posthook. Conversely, every
    dispatch branch in `posttooluse_bash.sh` must reference a wrapper that
    actually exists. Catches the drift where a wrapper is renamed but the
    hook still dispatches on the old name (or vice versa) -- silently dead
    hook path.
    """
    name = "hook-matcher-validity"
    category = "coverage"
    subtag = "structural-integrity"
    weight = 2.0  # high: silently-dead hooks are a major self-coherence failure

    _NO_POSTHOOK_OK = {
        "status", "trace", "evolve", "todo", "hme",
        "help", "why", "policies", "audit", "learn", "review",
    }

    def run(self) -> VerdictResult:
        import re

        project_root = os.environ.get("PROJECT_ROOT", _PROJECT)
        i_dir = os.path.join(project_root, "tools", "HME", "i")
        if not os.path.isdir(i_dir):
            return _result(FAIL, 0.0, "tools/HME/i directory missing -- HME tool wrappers not installed")

        # Enumerate wrappers (executable shell scripts in tools/HME/i/).
        wrappers = set()
        try:
            for name in os.listdir(i_dir):
                if name.startswith("_"):
                    continue
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

        # dispatch `i/<tool>` word-boundary pattern; r'\\b' bug fixed
        dispatched = set(re.findall(r'i/([a-z-]+)\b', posthook_src))

        # A wrapper with a posthook dispatch is "covered". A wrapper on the
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
                f"{len(wrappers)} wrappers * {len(dispatched)} dispatches all resolve"
            )
        score = 1.0 - len(errors) / total_checks
        return _result(FAIL, score, f"{len(errors)} wrapper/dispatch mismatch(es)", errors)
