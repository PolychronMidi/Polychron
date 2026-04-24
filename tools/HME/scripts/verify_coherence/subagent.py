"""Subagent mode/passthrough/guard/backends verifiers."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

import urllib.request

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class SubagentModeVerifier(Verifier):
    """Checks that agent_local.py's declared modes match what pretooluse_agent.sh
    routes to. If the hook intercepts 'Plan' but agent_local doesn't have a
    'plan' mode config, the subprocess crashes silently and the result file
    stays empty. This catches the drift at HCI time."""
    name = "subagent-mode-sync"
    category = "coverage"
    weight = 1.0

    def run(self) -> VerdictResult:
        agent_py = os.path.join(_PROJECT, "tools", "HME", "mcp", "agent_local.py")
        hook_sh = os.path.join(_HOOKS_DIR, "pretooluse_agent.sh")
        if not os.path.isfile(agent_py) or not os.path.isfile(hook_sh):
            return _result(SKIP, 1.0, "agent_local or hook missing")
        # Parse agent_local.py for _MODE_CONFIGS keys
        try:
            with open(agent_py) as f:
                src = f.read()
            m = re.search(r'_MODE_CONFIGS\s*=\s*\{(.*?)^\}', src, re.DOTALL | re.MULTILINE)
            if not m:
                return _result(FAIL, 0.0, "could not find _MODE_CONFIGS in agent_local.py")
            declared_modes = set(re.findall(r'"(\w+)"\s*:\s*\{', m.group(1)))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on agent_local.py: {e}")
        # Parse pretooluse_agent.sh for routed modes (HME_MODE="...")
        try:
            with open(hook_sh) as f:
                hook_src = f.read()
            routed = set(re.findall(r'HME_MODE="(\w+)"', hook_src))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on hook: {e}")

        missing = routed - declared_modes
        extra = declared_modes - routed
        if missing:
            return _result(
                FAIL, 0.0,
                f"hook routes to modes missing from agent_local: {sorted(missing)}",
                [f"declared: {sorted(declared_modes)}", f"routed: {sorted(routed)}"],
            )
        return _result(
            PASS, 1.0,
            f"hook routes {sorted(routed)} → agent_local declares {sorted(declared_modes)}",
            [f"unused mode configs: {sorted(extra)}"] if extra else [],
        )


class SubagentPassthroughVerifier(Verifier):
    """The general-purpose subagent type must remain a passthrough because it
    needs Write/Edit/Bash capabilities, which the read-only agent_local.py
    cannot provide. If someone hastily adds 'general-purpose' to the
    interception case, the verifier fails at weight 3.0 — this regression
    would downgrade every general-purpose agent call to a read-only stub."""
    name = "subagent-general-purpose-passthrough"
    category = "coverage"
    weight = 3.0

    _FORBIDDEN_INTERCEPTS = ("general-purpose", "statusline-setup")

    def run(self) -> VerdictResult:
        hook_sh = os.path.join(_HOOKS_DIR, "pretooluse_agent.sh")
        if not os.path.isfile(hook_sh):
            return _result(SKIP, 1.0, "hook missing")
        try:
            with open(hook_sh) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")

        # Walk the `case` block and look for each forbidden subagent type
        # being assigned a HME_MODE. If any appear as intercept targets, fail.
        violations = []
        for forbidden in self._FORBIDDEN_INTERCEPTS:
            # Match: "general-purpose)" followed by "HME_MODE=..."
            pat = re.compile(
                re.escape(forbidden) + r'\)\s*HME_MODE="(\w+)"',
                re.DOTALL,
            )
            m = pat.search(src)
            if m:
                violations.append(
                    f"{forbidden} → intercepted as mode={m.group(1)} "
                    f"(read-only replacement = capability downgrade)"
                )

        if violations:
            return _result(
                FAIL, 0.0,
                f"{len(violations)} forbidden intercept(s) — read-only replacement",
                violations + [
                    "RULE: general-purpose and statusline-setup must passthrough to Claude.",
                    "general-purpose needs Edit/Write/Bash which local agent cannot provide.",
                    "Revert the intercept; keep these types in the default branch of the case statement.",
                ],
            )
        return _result(
            PASS, 1.0,
            f"general-purpose + statusline-setup correctly passthrough to Claude",
        )


class SubagentGuardVerifier(Verifier):
    """Runs test 1 of the stress battery: the short-prompt guard.

    Passing test: agent_local.py receives "?" and returns the guard message
    in <1 second. Failing: agent_local doesn't guard against short prompts,
    wastes the arbiter's 120s budget, and times out. This is cheap (~0.1s)
    and catches regressions in the short-prompt early-exit.
    """
    name = "subagent-short-prompt-guard"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "stress-test-subagent.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "stress-test script not found")
        # Skip if agent_local backend is unreachable — a missing backend makes
        # the JSON decode fail (empty stdout), which is a backend outage not a
        # guard regression. The subagent-backends verifier covers this separately.
        agent = os.path.join(os.path.dirname(_SCRIPTS_DIR), "mcp", "agent_local.py")
        if not os.path.isfile(agent):
            return _result(SKIP, 1.0, "agent_local.py not found — skip guard test")
        try:
            probe = subprocess.run(
                ["python3", agent, "--stdin", "--json", "--project", _PROJECT],
                input='{"prompt":"?","mode":"explore"}',
                capture_output=True, text=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if not probe.stdout.strip():
                return _result(SKIP, 1.0, "agent_local returned empty — backend down, skipping guard test")
        except (subprocess.TimeoutExpired, Exception):
            return _result(SKIP, 1.0, "agent_local unreachable — backend down, skipping guard test")
        try:
            rc = subprocess.run(
                ["python3", script, "--only", "1"],
                capture_output=True, text=True, timeout=15,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
        except subprocess.TimeoutExpired:
            return _result(
                FAIL, 0.0,
                "short-prompt guard didn't fire in 15s — agent_local may be missing the early-exit",
                ["regression: len<3 or words<2 prompts must return immediately"],
            )
        except Exception as e:
            return _result(ERROR, 0.0, f"stress test invocation failed: {e}")
        if rc.returncode == 0:
            return _result(PASS, 1.0, "short-prompt guard fires correctly (<1s)")
        return _result(
            FAIL, 0.5,
            "short-prompt guard did not pass",
            rc.stdout.splitlines()[-5:],
        )


class SubagentBackendsVerifier(Verifier):
    """Verifies that agent_local.py's external dependencies are present.

    The local subagent pipeline depends on several binaries and endpoints
    being available at runtime. If any are missing, the agent silently
    falls back and produces low-quality output (this exact pattern was
    discovered the hard way: ripgrep being absent meant every grep call
    returned ERROR, and synthesizers worked from KB-only context).
    """
    name = "subagent-backends"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        backends = {}
        # 1. grep (rg or grep)
        try:
            for binary in ("rg", "grep"):
                try:
                    subprocess.run([binary, "--version"], capture_output=True, timeout=2)
                    backends["grep"] = binary
                    break
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    continue
            else:
                backends["grep"] = None
        except Exception:
            backends["grep"] = None

        # 2. Python (always available since we're running)
        backends["python"] = "python3"

        # 3. llama.cpp daemon (CPU port 11436 for arbiter)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:11436/api/tags")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    backends["llamacpp_arbiter"] = "11436"
                else:
                    backends["llamacpp_arbiter"] = None
        except Exception:
            backends["llamacpp_arbiter"] = None

        # 4. HME worker (port 9098 — absorbs former shim role)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:9098/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                backends["hme_worker"] = "9098" if r.status == 200 else None
        except Exception:
            backends["hme_shim"] = None

        missing = [k for k, v in backends.items() if v is None]
        score = 1.0 - len(missing) / len(backends)
        details = [f"{k}={v or 'MISSING'}" for k, v in backends.items()]

        if not missing:
            return _result(PASS, 1.0, "all subagent backends available", details)
        if "grep" in missing:
            return _result(
                FAIL, score,
                f"subagent grep backend missing — agent will silently fail every search",
                details + ["install ripgrep or ensure GNU grep is on PATH"],
            )
        return _result(
            WARN, score,
            f"{len(missing)} subagent backend(s) missing: {', '.join(missing)}",
            details,
        )


