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
    """Checks that the public HME agent tool exposes only agent_local modes."""
    name = "subagent-mode-sync"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        agent_py = os.path.join(_PROJECT, "tools", "HME", "service", "agent_local", "research.py")
        tool_py = os.path.join(_SERVER_DIR, "tools_analysis", "agent_unified.py")
        if not os.path.isfile(agent_py) or not os.path.isfile(tool_py):
            return _result(SKIP, 1.0, "agent_local or HME agent tool missing")
        try:
            with open(agent_py) as f:
                src = f.read()
            m = re.search(r'_MODE_CONFIGS\s*=\s*\{(.*?)^\}', src, re.DOTALL | re.MULTILINE)
            if not m:
                return _result(FAIL, 0.0, "could not find _MODE_CONFIGS in agent_local/research.py")
            declared_modes = set(re.findall(r'"(\w+)"\s*:\s*\{', m.group(1)))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on agent_local/research.py: {e}")
        try:
            with open(tool_py) as f:
                tool_src = f.read()
            m = re.search(r'if\s+mode\s+not\s+in\s+\((.*?)\):', tool_src, re.DOTALL)
            if not m:
                return _result(FAIL, 0.0, "could not find mode allowlist in agent_unified.py")
            routed = set(re.findall(r'"(\w+)"|\'(\w+)\'', m.group(1)))
            routed = {a or b for a, b in routed}
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on HME agent tool: {e}")

        missing = routed - declared_modes
        extra = declared_modes - routed
        if missing:
            return _result(
                FAIL, 0.0,
                f"HME agent tool exposes modes missing from agent_local: {sorted(missing)}",
                [f"declared: {sorted(declared_modes)}", f"routed: {sorted(routed)}"],
            )
        return _result(
            PASS, 1.0,
            f"HME agent tool exposes {sorted(routed)} -> agent_local declares {sorted(declared_modes)}",
            [f"unused mode configs: {sorted(extra)}"] if extra else [],
        )


class SubagentPassthroughVerifier(Verifier):
    """The native Agent hook routes via team_agent_router, not local read-only stubs."""
    name = "subagent-router-type-tier"
    category = "coverage"
    subtag = "interface-contract"
    weight = 3.0

    _REQUIRED_TYPES = ("general-purpose", "statusline-setup", "Plan", "Explore")

    def run(self) -> VerdictResult:
        router_py = os.path.join(_SCRIPTS_DIR, "team_agent_router.py")
        if not os.path.isfile(router_py):
            return _result(SKIP, 1.0, "team_agent_router.py missing")
        try:
            with open(router_py) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        m = re.search(r'TYPE_TIER\s*:\s*dict\[str,\s*str\]\s*=\s*\{(.*?)^\}', src, re.DOTALL | re.MULTILINE)
        if not m:
            return _result(FAIL, 0.0, "could not find TYPE_TIER in team_agent_router.py")
        pairs = dict(re.findall(r'"([^"]+)"\s*:\s*"(E[1-5])"', m.group(1)))
        missing = [name for name in self._REQUIRED_TYPES if name not in pairs]
        invalid = [f"{name}={tier}" for name, tier in pairs.items() if not re.fullmatch(r"E[1-5]", tier)]
        if missing or invalid:
            return _result(
                FAIL, 0.0,
                "team_agent_router TYPE_TIER is missing required native Agent type coverage",
                [f"missing: {missing}", f"invalid: {invalid}", f"known: {sorted(pairs)}"],
            )
        return _result(
            PASS, 1.0,
            f"team_agent_router maps native Agent types: {sorted(pairs.items())}",
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
    subtag = "interface-contract"
    weight = 0.5

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "stress-test-subagent.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "stress-test script not found")
        service_root = os.path.join(_PROJECT, "tools", "HME", "service")
        agent_pkg = os.path.join(service_root, "agent_local", "__main__.py")
        if not os.path.isfile(agent_pkg):
            return _result(FAIL, 0.0, "agent_local package entry point not found")
        env = {**os.environ, "PROJECT_ROOT": _PROJECT}
        old_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = service_root if not old_pythonpath else f"{service_root}:{old_pythonpath}"
        try:
            probe = subprocess.run(
                ["python3", "-m", "agent_local", "--stdin", "--json", "--project", _PROJECT],
                input='{"prompt":"?","mode":"explore"}',
                capture_output=True, text=True, timeout=5,
                env=env,
            )
            if not probe.stdout.strip():
                return _result(FAIL, 0.0, "agent_local returned empty for short-prompt guard")
            parsed = json.loads(probe.stdout)
            answer = (parsed.get("answer") or "").lower()
            if "declined" not in answer or "short" not in answer:
                return _result(FAIL, 0.0, "agent_local short-prompt guard returned wrong payload",
                               [probe.stdout[:300]])
        except subprocess.TimeoutExpired:
            return _result(FAIL, 0.0, "agent_local short-prompt guard timed out")
        except Exception as e:
            return _result(FAIL, 0.0, f"agent_local guard probe failed: {e}")
        try:
            rc = subprocess.run(
                ["python3", script, "--only", "1"],
                capture_output=True, text=True, timeout=15,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return _result(
                FAIL, 0.0,
                "short-prompt guard didn't fire in 15s -- agent_local may be missing the early-exit",
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
    subtag = "interface-contract"
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
            # silent-ok: optional fallback path.
            backends["grep"] = None

        # 2. Python (always available since we're running)
        backends["python"] = "python3"

        # 3. llama-server arbiter. Port 11436 was retired (see
        _arbiter_port = os.environ['HME_ARBITER_PORT']
        try:
            import urllib.request
            req = urllib.request.Request(f"http://127.0.0.1:{_arbiter_port}/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    backends["llamacpp_arbiter"] = _arbiter_port
                else:
                    backends["llamacpp_arbiter"] = None
        except Exception:
            # silent-ok: optional fallback path.
            backends["llamacpp_arbiter"] = None

        # 4. HME worker
        try:
            import urllib.request
            sys.path.insert(0, _SCRIPTS_DIR)
            from service_registry import service_map, service_port, service_url
            worker = service_map()["worker"]
            req = urllib.request.Request(service_url(worker))
            with urllib.request.urlopen(req, timeout=2) as r:
                backends["hme_worker"] = str(service_port(worker)) if r.status == 200 else None
        except Exception:
            # silent-ok: optional fallback path.
            backends["hme_worker"] = None

        missing = [k for k, v in backends.items() if v is None]
        score = 1.0 - len(missing) / len(backends)
        details = [f"{k}={v or 'MISSING'}" for k, v in backends.items()]

        if not missing:
            return _result(PASS, 1.0, "all subagent backends available", details)
        if "grep" in missing:
            return _result(
                FAIL, score,
                f"subagent grep backend missing -- agent will silently fail every search",
                details + ["install ripgrep or ensure GNU grep is on PATH"],
            )
        return _result(
            WARN, score,
            f"{len(missing)} subagent backend(s) missing: {', '.join(missing)}",
            details,
        )


class AgentJobContractVerifier(Verifier):
    """Codex/Claude/team agent launchers must share one filesystem contract."""
    name = "agent-job-contract"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        helper = os.path.join(_SCRIPTS_DIR, "agent_jobs.py")
        wrapper = os.path.join(_SCRIPTS_DIR, "codex-agent-job.py")
        missing = [p for p in (helper, wrapper) if not os.path.isfile(p)]
        if missing:
            return _result(FAIL, 0.0, "agent job contract file(s) missing", missing)
        try:
            rc = subprocess.run(
                [sys.executable, "-m", "py_compile", helper, wrapper],
                capture_output=True,
                text=True,
                timeout=10,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
        except Exception as e:
            return _result(ERROR, 0.0, f"py_compile invocation failed: {e}")
        if rc.returncode != 0:
            return _result(
                FAIL, 0.0,
                "agent job contract does not compile",
                (rc.stderr or rc.stdout).splitlines()[-10:],
            )
        try:
            with open(helper) as f:
                src = f.read()
        except OSError as e:
            return _result(ERROR, 0.0, f"agent_jobs.py unreadable: {e}")
        required = [
            'tools" / "HME" / "runtime" / "agent-jobs',
            "request.json",
            "output.txt",
            "stderr.txt",
            "events.jsonl",
            "status.json",
            "atomic_write_json",
            "append_event",
        ]
        gaps = [needle for needle in required if needle not in src]
        if gaps:
            return _result(FAIL, 0.0, "agent job contract missing required paths/helpers", gaps)
        return _result(PASS, 1.0, "agent job contract present, compile-clean, and file-backed")
