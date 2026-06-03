"""Dispatcher routing contract: declared routes must match the switch cases."""
from __future__ import annotations

import json
import os
import re

from ._base import (
    VerdictResult,
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
)

_DISPATCHER = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "dispatcher.js")
_ROUTES = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "dispatcher-routes.json")

# Lifecycle/tool events handled by the switch. Observation events take a
# separate pre-switch path and are declared under observation_events.
_SWITCH_CASE = re.compile(r"case\s+'([A-Za-z]+)'\s*:")


@register
class DispatcherRouteContractVerifier(Verifier):
    """Every switch case in dispatcher.js must be declared in
    dispatcher-routes.json and vice versa. Closes the implicit-contract gap
    where an event's policy context (e.g. PermissionRequest reusing
    PreToolUse) lived only as a hardcoded string in code."""
    name = "dispatcher-route-contract"
    category = "coverage"
    subtag = "interface-contract"
    weight = 2.0

    def run(self) -> VerdictResult:
        try:
            with open(_ROUTES, encoding="utf-8") as f:
                contract = json.load(f)
        except Exception as e:
            return failed(summary=f"dispatcher-routes.json invalid: {e}")
        try:
            with open(_DISPATCHER, encoding="utf-8") as f:
                src = f.read()
        except OSError as e:
            return failed(summary=f"dispatcher.js unreadable: {e}")

        declared = {r["event"] for r in contract.get("routes", [])}
        observation = set(contract.get("observation_events", []))
        # Switch cases, minus those routed pre-switch as observation events.
        cases = set(_SWITCH_CASE.findall(src)) - observation

        errors = []
        for ev in sorted(cases - declared):
            errors.append(f"switch case '{ev}' has no entry in dispatcher-routes.json")
        for ev in sorted(declared - cases):
            errors.append(f"dispatcher-routes.json declares '{ev}' but no switch case exists")

        # The non-derivable fact this contract exists to protect: confirm the
        # PermissionRequest route still declares the PreToolUse policy context
        ctx = {r["event"]: r.get("policyContext") for r in contract.get("routes", [])}
        if ctx.get("PermissionRequest") != "PreToolUse":
            errors.append("PermissionRequest must declare policyContext 'PreToolUse'")
        if "policyContext('PermissionRequest')" not in src:
            errors.append("dispatcher.js must resolve PermissionRequest policy via policyContext()")

        # Every declared hook script must exist on disk under tools/HME/hooks/.
        # The route-name contract above does not catch a typo'd script path
        hooks_dir = os.path.join(_PROJECT, "tools", "HME", "hooks")
        declared_scripts = set()
        for r in contract.get("routes", []):
            for s in r.get("scripts", []) or []:
                declared_scripts.add(s)
            for s in r.get("universalScripts", []) or []:
                declared_scripts.add(s)
            if r.get("hmePrimerScript"):
                declared_scripts.add(r["hmePrimerScript"])
            for arr in (r.get("shellByTool") or {}).values():
                for s in arr or []:
                    declared_scripts.add(s)
        for s in sorted(declared_scripts):
            if not os.path.exists(os.path.join(hooks_dir, s)):
                errors.append(f"declared hook script missing on disk: tools/HME/hooks/{s}")

        total = len(declared | cases) + len(declared_scripts) + 2
        if not errors:
            return passed(summary=f"{len(declared)} routes declared, switch + contract agree")
        score = max(0.0, 1.0 - len(errors) / max(1, total))
        return failed(score=score, summary=f"{len(errors)} route contract mismatch(es)", details=errors)
