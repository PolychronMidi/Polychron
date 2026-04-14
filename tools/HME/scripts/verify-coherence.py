#!/usr/bin/env python3
"""HME unified self-coherence engine.

Treats HME's self-coherence the same way Polychron treats musical coherence:
as a multi-dimensional signal space. Each dimension is a `Verifier` that
produces a numeric score; the aggregate is the HME Coherence Index (HCI)
on a 0-100 scale.

This script unifies all individual verifiers (verify-doc-sync, verify-states-sync,
verify-onboarding-flow, etc.) into one extensible registry, so HME can
audit its own coherence with one command and produce machine-readable
output that can be diffed across sessions.

Architecture:
  - `Verifier` (abstract): defines run() -> VerdictResult
  - `Registry`: maps verifier name -> instance
  - `Engine`: runs all registered verifiers, aggregates scores, formats report
  - `VerdictResult`: status + score 0-1 + summary + details + duration

Output formats:
  --text (default): human-readable per-category report + HCI banner
  --json: machine-readable full snapshot, suitable for diffing
  --score: just the HCI integer (for shell pipelines and statusline)

Wired into hme_admin(action='selftest') alongside the standalone verifiers
it subsumes. Future verifiers should be added by appending to REGISTRY.

Exit codes:
  0 — HCI >= threshold (default 80)
  1 — HCI < threshold
  2 — engine error (internal failure, not a coherence failure)
"""
import dataclasses
import json
import os
import re
import subprocess
import sys
import time
from typing import Callable

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "mcp", "server")
_SCRIPTS_DIR = os.path.join(_PROJECT, "tools", "HME", "scripts")
_DOC_DIRS = [os.path.join(_PROJECT, "doc"), os.path.join(_PROJECT, "tools", "HME", "skills")]


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"
SKIP = "SKIP"
ERROR = "ERROR"


@dataclasses.dataclass
class VerdictResult:
    status: str          # PASS | WARN | FAIL | SKIP | ERROR
    score: float         # 0.0 - 1.0
    summary: str         # one-line summary
    details: list        # list of strings (multi-line context)
    duration_ms: float = 0.0

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def _result(status: str, score: float, summary: str, details=None) -> VerdictResult:
    return VerdictResult(status=status, score=max(0.0, min(1.0, score)),
                         summary=summary, details=details or [])


# --------------------------------------------------------------------------
# Verifier base + helpers
# --------------------------------------------------------------------------

class Verifier:
    """Each subclass declares name, category, weight, and run()."""
    name: str = ""
    category: str = ""
    weight: float = 1.0

    def run(self) -> VerdictResult:
        raise NotImplementedError

    def execute(self) -> VerdictResult:
        t0 = time.time()
        try:
            result = self.run()
        except Exception as e:
            import traceback
            result = _result(ERROR, 0.0, f"verifier crashed: {type(e).__name__}: {e}",
                             [traceback.format_exc()])
        result.duration_ms = (time.time() - t0) * 1000
        return result


def _run_subprocess(script: str, timeout: int = 30) -> tuple:
    """Run a verifier subprocess, return (returncode, stdout, stderr)."""
    rc = subprocess.run(
        ["python3", script],
        capture_output=True, text=True, timeout=timeout,
        env={**os.environ, "PROJECT_ROOT": _PROJECT},
    )
    return rc.returncode, rc.stdout, rc.stderr


# --------------------------------------------------------------------------
# Verifiers — DOC category
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# Verifiers — CODE category
# --------------------------------------------------------------------------

class PythonSyntaxVerifier(Verifier):
    name = "python-syntax"
    category = "code"
    weight = 3.0  # critical: broken Python = broken HME server

    def run(self) -> VerdictResult:
        import ast
        broken = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                total += 1
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        ast.parse(fp.read())
                except SyntaxError as e:
                    broken.append(f"{os.path.relpath(path, _PROJECT)}:{e.lineno}: {e.msg}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} Python files parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} Python files broken", broken)


class ShellSyntaxVerifier(Verifier):
    name = "shell-syntax"
    category = "code"
    weight = 2.0

    def run(self) -> VerdictResult:
        broken = []
        total = 0
        for f in os.listdir(_HOOKS_DIR):
            if not f.endswith(".sh"):
                continue
            total += 1
            path = os.path.join(_HOOKS_DIR, f)
            rc = subprocess.run(["bash", "-n", path], capture_output=True, text=True)
            if rc.returncode != 0:
                broken.append(f"{f}: {rc.stderr.strip()[:100]}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} shell hooks parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} shell hooks broken", broken)


class HookExecutabilityVerifier(Verifier):
    """Every non-helper hook script must be +x."""
    name = "hook-executability"
    category = "code"
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


# --------------------------------------------------------------------------
# Verifiers — STATE category
# --------------------------------------------------------------------------

class StatesSyncVerifier(Verifier):
    name = "states-sync"
    category = "state"
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


class TodoStoreSchemaVerifier(Verifier):
    """Every entry in todos.json has the required canonical fields."""
    name = "todo-store-schema"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        store = os.path.join(_PROJECT, ".claude", "mcp", "HME", "todos.json")
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


# --------------------------------------------------------------------------
# Verifiers — COVERAGE category
# --------------------------------------------------------------------------

class HookRegistrationVerifier(Verifier):
    """Every matcher in hooks.json points to a real .sh file."""
    name = "hook-registration"
    category = "coverage"
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
    """Every `mcp__HME__*` matcher in hooks.json refers to a tool that
    actually exists in the current tool surface. Catches post-unification
    drift where a matcher is pinned to a renamed/removed tool — the hook
    is then silently dead because the MCP event never fires it.
    """
    name = "hook-matcher-validity"
    category = "coverage"
    weight = 2.0  # high: silently-dead hooks are a major self-coherence failure

    def run(self) -> VerdictResult:
        import ast
        # Collect actual tool names from the server source
        actual: set = set()
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
                    if any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Attribute)
                        and d.func.attr == "tool"
                        for d in node.decorator_list
                    ):
                        actual.add(f"mcp__HME__{node.name}")

        # Read hooks.json and collect all mcp__HME__* matchers
        hooks_json = os.path.join(_HOOKS_DIR, "hooks.json")
        try:
            with open(hooks_json) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"hooks.json invalid: {e}")

        dead = []
        checked = 0
        for _event, entries in data.get("hooks", {}).items():
            for entry in entries:
                matcher = entry.get("matcher", "")
                # Skip empty matcher (matches all), non-MCP matchers, and the
                # broad `mcp__HME__` prefix matcher which is a prefix filter.
                if not matcher:
                    continue
                if not matcher.startswith("mcp__HME__"):
                    continue
                if matcher == "mcp__HME__":
                    continue  # prefix matcher — matches any HME tool
                checked += 1
                if matcher not in actual:
                    dead.append(matcher)

        if checked == 0:
            return _result(SKIP, 1.0, "no specific mcp__HME__ matchers to check")
        if not dead:
            return _result(PASS, 1.0, f"{checked}/{checked} HME matchers resolve to real tools")
        score = 1.0 - len(dead) / checked
        return _result(
            FAIL, score,
            f"{len(dead)}/{checked} HME matchers point at dead tools",
            [f"{m} — no @ctx.mcp.tool() function with this name" for m in dead],
        )


class ToolSurfaceCoverageVerifier(Verifier):
    """Every public @ctx.mcp.tool() function appears in either AGENT_PRIMER.md
    or HME.md. Hidden tools don't need to be documented."""
    name = "tool-surface-coverage"
    category = "coverage"
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


# --------------------------------------------------------------------------
# Verifiers — RUNTIME category
# --------------------------------------------------------------------------

class ShimHealthVerifier(Verifier):
    name = "shim-health"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:7734/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    return _result(PASS, 1.0, "shim /health responds 200")
                return _result(WARN, 0.5, f"shim /health returned {r.status}")
        except Exception as e:
            return _result(WARN, 0.0, f"shim unreachable: {type(e).__name__}",
                           [str(e)])


class ErrorLogVerifier(Verifier):
    """Open LIFESAVER errors should be zero or very few."""
    name = "error-log"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        log = os.path.join(_PROJECT, "log", "hme-errors.log")
        if not os.path.isfile(log):
            return _result(PASS, 1.0, "no error log (clean)")
        try:
            with open(log) as f:
                lines = [l for l in f if l.strip()]
        except Exception as e:
            return _result(ERROR, 0.0, f"could not read error log: {e}")
        watermark = os.path.join(_PROJECT, "tmp", "hme-errors.lastread")
        last = 0
        if os.path.isfile(watermark):
            try:
                with open(watermark) as f:
                    last = int(f.read().strip() or 0)
            except Exception:
                pass
        unread = max(0, len(lines) - last)
        if unread == 0:
            return _result(PASS, 1.0, f"all {len(lines)} historical errors acknowledged")
        score = max(0.0, 1.0 - unread / 10.0)
        return _result(FAIL if unread > 5 else WARN, score,
                       f"{unread} unacknowledged errors", lines[-min(5, unread):])


# --------------------------------------------------------------------------
# Verifiers — TOPOLOGY category
# --------------------------------------------------------------------------

class LifesaverRateVerifier(Verifier):
    """Scores LIFESAVER rate using multi-window recency:
        acute  (last 1h):  strongest signal of current problem
        medium (last 6h):  recent problem, possibly ongoing
        recent (last 24h): historical residue, weakest signal
    HCI reflects CURRENT health. Old events age out automatically and stop
    dragging the score down once they fall past the acute window.
    """
    name = "lifesaver-rate"
    category = "runtime"
    weight = 2.0

    def run(self) -> VerdictResult:
        data_path = os.path.join(_PROJECT, "metrics", "hme-tool-effectiveness.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no effectiveness data yet — run analyze-tool-effectiveness.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        acute = data.get("lifesaver_acute_events", 0)
        medium = data.get("lifesaver_medium_events", 0)
        recent = data.get("lifesaver_recent_events", 0)
        all_time = data.get("lifesaver_total_events", 0)
        # Weighted penalty: acute worth 1.0, medium 0.3, recent 0.1 per event
        weighted = acute * 1.0 + (medium - acute) * 0.3 + (recent - medium) * 0.1
        score = max(0.0, 1.0 - weighted / 5.0)
        summary = (
            f"acute(1h)={acute} medium(6h)={medium} recent(24h)={recent} "
            f"all-time={all_time}"
        )
        if acute >= 3:
            return _result(
                FAIL, score, summary,
                ["3+ LIFESAVER events in the last HOUR — acute problem",
                 "investigate log/hme-errors.log"],
            )
        if acute >= 1 or medium >= 5:
            return _result(WARN, score, summary, ["recent LIFESAVER activity"])
        if recent == 0:
            return _result(PASS, 1.0, f"0 LIFESAVER events in last 24h (all-time: {all_time})")
        return _result(PASS, score, summary + " (no acute activity)")


class MetaObserverCoherenceVerifier(Verifier):
    """Scores meta-observer L14 alerts using the ACUTE (1h) window. Historical
    alerts in the 6h and 24h windows contribute weakly — the focus is on
    whether HME is currently unstable."""
    name = "meta-observer-coherence"
    category = "runtime"
    weight = 2.0

    def run(self) -> VerdictResult:
        data_path = os.path.join(_PROJECT, "metrics", "hme-tool-effectiveness.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no effectiveness data yet")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        acute = data.get("acute_coherence_events", {}) or {}
        medium = data.get("medium_coherence_events", {}) or {}
        acute_worst = max((acute.get(k, 0) for k in
                           ("deep_degradation", "restart_churn", "frequent_instability")),
                          default=0)
        medium_worst = max((medium.get(k, 0) for k in
                            ("deep_degradation", "restart_churn", "frequent_instability")),
                           default=0)
        # Weighted: 1 acute event = 1 point penalty, 1 medium = 0.2 point
        penalty = acute_worst + (medium_worst - acute_worst) * 0.2
        score = max(0.0, 1.0 - penalty / 10.0)
        summary = (
            f"acute(1h)_worst={acute_worst} medium(6h)_worst={medium_worst} "
            f"(degradation/churn/instability)"
        )
        if acute_worst >= 5:
            return _result(
                FAIL, score, summary,
                ["HME unstable RIGHT NOW — 5+ alerts in last hour",
                 "check meta-observer recovery logic"],
            )
        if acute_worst >= 2:
            return _result(WARN, score, summary,
                           ["elevated meta-observer events in last hour"])
        return _result(PASS, score, summary)


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


class VerifierCoverageGapVerifier(Verifier):
    """H13 consumer: reads metrics/hme-verifier-coverage.json and flags
    gaps — fix commits with no matching verifier. Low weight because
    this is aspirational."""
    name = "verifier-coverage-gap"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(_PROJECT, "metrics", "hme-verifier-coverage.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no coverage report — run suggest-verifiers.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        gaps = data.get("gap_count", 0)
        scanned = data.get("commits_scanned", 0)
        if scanned == 0:
            return _result(SKIP, 1.0, "no recent fix commits to check")
        if gaps == 0:
            return _result(PASS, 1.0, f"{scanned} fix commits, all have verifier coverage")
        ratio = gaps / max(1, scanned)
        score = max(0.0, 1.0 - ratio * 2)
        return _result(
            WARN, score,
            f"{gaps}/{scanned} fix commits without matching verifiers",
            [f"first gap: {data.get('gaps', [{}])[0].get('message', '?')[:80]}"] if gaps else [],
        )


class MemeticDriftVerifier(Verifier):
    """H16 consumer: reads metrics/hme-memetic-drift.json and flags rules
    with elevated violation counts. Low weight because the signal is noisy
    (violation detection is heuristic)."""
    name = "memetic-drift"
    category = "doc"
    weight = 0.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(_PROJECT, "metrics", "hme-memetic-drift.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no memetic drift report")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        violations = data.get("violation_counts", {})
        if not violations:
            return _result(PASS, 1.0, "no violations detected")
        worst = max(violations.values()) if violations else 0
        total = sum(violations.values())
        if worst >= 3:
            score = max(0.0, 1.0 - worst / 10.0)
            return _result(
                WARN, score,
                f"{total} total violations, worst rule: {worst} occurrences",
                [f"{k}: {v}" for k, v in sorted(violations.items(), key=lambda x: -x[1])[:3] if v > 0],
            )
        return _result(PASS, 1.0, f"{total} violations across {len(violations)} tracked rules (none severe)")


class TransientErrorFilterVerifier(Verifier):
    """Ensures _log_error in hme_http_store.py uses SOURCE-based transient
    detection, not message-substring matching. The old detector looked for
    '/reindex' as a URL-path substring which broke when reindex timeout
    messages started with 'timeout indexing /home/...' (no /reindex in that
    string). This class of bug (format drift vs. classifier) must not return.
    """
    name = "transient-error-filter"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        store_py = os.path.join(_SERVER_DIR, "..", "hme_http_store.py")
        store_py = os.path.normpath(store_py)
        if not os.path.isfile(store_py):
            return _result(SKIP, 1.0, "hme_http_store.py not found")
        try:
            with open(store_py) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Find the _log_error function
        m = re.search(
            r'def _log_error\([^)]*\)[^:]*:(.*?)(?=\ndef |\Z)',
            src, re.DOTALL,
        )
        if not m:
            return _result(FAIL, 0.0, "could not find _log_error definition")
        body = m.group(1)
        # Source-based markers we REQUIRE
        has_source_set = (
            "_transient_sources" in body
            or "source in {" in body
            or "source in (" in body
        )
        # URL-path markers we FORBID (regression guards)
        has_url_path_match = bool(
            re.search(r'"/reindex"\s+in\s+message', body)
            or re.search(r'"/enrich"\s+in\s+message', body)
            or re.search(r'"/audit"\s+in\s+message', body)
        )
        if has_url_path_match:
            return _result(
                FAIL, 0.0,
                "_log_error uses URL-path substring matching on message — "
                "drift-prone, will silently break when message format changes",
                ['refactor to source-based: "if source in _transient_sources and \'timeout\' in message"'],
            )
        if not has_source_set:
            return _result(
                WARN, 0.5,
                "_log_error transient detection is not source-based",
                ["recommended: check source argument instead of substring-matching the message"],
            )
        return _result(PASS, 1.0, "_log_error uses source-based transient detection")


class PredictiveHCIVerifier(Verifier):
    """H9: consumes metrics/hme-hci-forecast.json (produced by predict-hci.py)
    and scores based on predicted drift. This is the forward-looking layer —
    fire a WARN when HCI is projected to cross the 80 threshold before it
    actually does, so the agent has time to fix whatever's driving the drop."""
    name = "predictive-hci"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        forecast_path = os.path.join(_PROJECT, "metrics", "hme-hci-forecast.json")
        script = os.path.join(_SCRIPTS_DIR, "predict-hci.py")
        # Refresh forecast (cheap)
        if os.path.isfile(script):
            try:
                subprocess.run(
                    ["python3", script], capture_output=True, timeout=10,
                    env={**os.environ, "PROJECT_ROOT": _PROJECT},
                )
            except Exception:
                pass
        if not os.path.isfile(forecast_path):
            return _result(SKIP, 1.0, "no forecast data")
        try:
            with open(forecast_path) as f:
                forecast = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"forecast read error: {e}")
        if forecast.get("_warning"):
            return _result(SKIP, 1.0, forecast["_warning"])
        current = forecast.get("current_hci", 100)
        predicted = forecast.get("predicted_next_hci", 100)
        trend = forecast.get("trend", "flat")
        warning = forecast.get("warning")
        summary = f"current={current} predicted={predicted} trend={trend}"
        if warning:
            # Score: proportional to how far the prediction is below 80
            score = max(0.0, min(1.0, predicted / 100.0))
            return _result(WARN, score, summary, [warning])
        return _result(PASS, 1.0, summary)


class WarmContextFreshnessVerifier(Verifier):
    """H1: detect stale warm KV contexts and attempt auto-reprime.

    The HME synthesis stack primes warm KV contexts per model so tools get
    fast first-token latency. These contexts DECAY over time (models get
    evicted, KB changes, days pass). Currently nothing watches them — the
    selftest flagged 36-hour-old contexts that had been silently stale.

    This verifier:
      1. Checks warm-context-cache/*.json file ages
      2. Scores based on the oldest staleness
      3. Triggers background auto-reprime when staleness > 4 hours
      4. Fails only when auto-reprime has been unable to fix it repeatedly
    """
    name = "warm-context-freshness"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        cache_dir = os.path.join(_PROJECT, "tools", "HME", "warm-context-cache")
        if not os.path.isdir(cache_dir):
            return _result(SKIP, 1.0, "no warm-context-cache dir")
        files = [f for f in os.listdir(cache_dir) if f.endswith(".json")]
        if not files:
            return _result(SKIP, 1.0, "no warm context files yet")
        oldest_age = 0.0
        oldest_file = ""
        for f in files:
            path = os.path.join(cache_dir, f)
            age = time.time() - os.path.getmtime(path)
            if age > oldest_age:
                oldest_age = age
                oldest_file = f
        age_hours = oldest_age / 3600

        # Score: 0-4h = 1.0, 4-24h = WARN, >24h = FAIL
        if age_hours < 4:
            return _result(PASS, 1.0,
                           f"warmest cache fresh ({age_hours:.1f}h), oldest={oldest_file}")
        if age_hours < 24:
            # Attempt background auto-reprime — fire-and-forget
            _trigger_warm_reprime()
            return _result(
                WARN, 0.7,
                f"oldest warm cache {age_hours:.1f}h (re-prime triggered)",
                [f"oldest: {oldest_file}",
                 "auto-reprime: hme_admin(action='warm') fired in background"],
            )
        _trigger_warm_reprime()
        return _result(
            FAIL, 0.3,
            f"oldest warm cache {age_hours:.1f}h — priming bitrot",
            [f"oldest: {oldest_file}",
             "auto-reprime triggered; if this persists, selftest warm ctx check is broken"],
        )


def _trigger_warm_reprime() -> None:
    """Fire-and-forget background call to hme_admin(action='warm').
    Uses the HTTP shim if the MCP server isn't running in-process."""
    import threading
    def _bg():
        try:
            # Prefer the admin tool invocation via HTTP shim or subprocess.
            # Simple approach: drop a sentinel file that a sessionstart/admin
            # path will pick up. If hme_admin runs via Python inside the
            # server we can't invoke it from a hook, but we CAN touch a file
            # the server reads on next tick.
            sentinel = os.path.join(_PROJECT, "tmp", "hme-warm-reprime.request")
            os.makedirs(os.path.dirname(sentinel), exist_ok=True)
            with open(sentinel, "w") as f:
                f.write(str(time.time()))
        except Exception:
            pass
    threading.Thread(target=_bg, daemon=True).start()


class HookLatencyVerifier(Verifier):
    """H3: flag hooks whose p95 wall-time exceeds a budget.

    Hook latency is silent tax — every tool call pays it. A hook that
    regresses from 50ms to 500ms adds half a second to every Edit, which
    compounds across a session. This verifier reads metrics/hme-hook-latency.jsonl
    (populated by hooks themselves via the _timestamp_hook helper) and
    flags hooks exceeding 500ms p95.
    """
    name = "hook-latency"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        log_path = os.path.join(_PROJECT, "metrics", "hme-hook-latency.jsonl")
        if not os.path.isfile(log_path):
            return _result(SKIP, 1.0, "no hook latency log yet (first run)")
        try:
            by_hook = {}
            with open(log_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    by_hook.setdefault(entry.get("hook", "?"), []).append(
                        float(entry.get("duration_ms", 0))
                    )
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        if not by_hook:
            return _result(SKIP, 1.0, "log exists but empty")
        # Compute p95 per hook
        slow = []
        total = 0
        for hook_name, durations in by_hook.items():
            total += 1
            durations_sorted = sorted(durations)
            n = len(durations_sorted)
            if n >= 20:
                p95 = durations_sorted[int(n * 0.95)]
            else:
                p95 = durations_sorted[-1]
            if p95 > 500:
                slow.append(f"{hook_name}: p95={p95:.0f}ms (n={n})")
        if not slow:
            return _result(PASS, 1.0, f"{total} hooks all under 500ms p95")
        score = max(0.0, 1.0 - len(slow) / total)
        return _result(
            WARN if len(slow) < 3 else FAIL, score,
            f"{len(slow)}/{total} hooks exceed 500ms p95 budget", slow,
        )


class PlanOutputValidityVerifier(Verifier):
    """H4: validate that plans produced by agent_local --mode plan reference
    real files only. Plans live in /tmp/hme-agent-*.md when emitted via the
    hook. Scan recent plans for file paths and confirm each exists.
    Hallucinated file paths in plans are the plan-mode analog of
    hallucinated code in edit mode — both are capability failures."""
    name = "plan-output-validity"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        import glob
        plan_files = sorted(glob.glob("/tmp/hme-agent-*.md"))
        if not plan_files:
            return _result(SKIP, 1.0, "no recent plan outputs to validate")
        checked = 0
        bad = []
        for p in plan_files[-5:]:  # last 5
            try:
                with open(p) as f:
                    content = f.read()
            except Exception:
                continue
            checked += 1
            # Extract file path claims (look for typical code-path patterns)
            paths = set(re.findall(r'[a-zA-Z0-9_/.-]+\.(?:js|py|sh|md|json|ts)', content))
            for pth in paths:
                # Only check paths that look like relative project paths
                if "/" not in pth or pth.startswith(".") or pth.startswith("/"):
                    continue
                full = os.path.join(_PROJECT, pth)
                if not os.path.isfile(full):
                    bad.append(f"{os.path.basename(p)}: claims {pth} — not found")
        if checked == 0:
            return _result(SKIP, 1.0, "no readable plan outputs")
        if not bad:
            return _result(PASS, 1.0, f"{checked} plan(s) cite only real files")
        score = 1.0 - min(1.0, len(bad) / 10.0)
        return _result(WARN, score, f"{len(bad)} suspicious path claim(s) in plans", bad[:5])


class GitCommitTestCoverageVerifier(Verifier):
    """H5: Check that recent 'fix'/'bug' commits add or modify a
    test/verifier in the same commit. Commits that claim fixes without a
    regression guard are a class of drift — next time the bug comes back
    there's nothing to catch it."""
    name = "git-commit-test-coverage"
    category = "runtime"
    weight = 0.5

    _FIX_KEYWORDS = ("fix", "bug", "regression", "repair", "patch", "correct", "error")

    def run(self) -> VerdictResult:
        try:
            rc = subprocess.run(
                ["git", "-C", _PROJECT, "log", "--oneline", "-50"],
                capture_output=True, text=True, timeout=3,
            )
            if rc.returncode != 0:
                return _result(SKIP, 1.0, "git log failed")
            log_lines = rc.stdout.splitlines()
        except Exception as e:
            return _result(ERROR, 0.0, f"git error: {e}")
        fix_commits = []
        for line in log_lines:
            parts = line.split(" ", 1)
            if len(parts) != 2:
                continue
            sha, msg = parts
            if any(kw in msg.lower() for kw in self._FIX_KEYWORDS):
                fix_commits.append((sha, msg))
        if not fix_commits:
            return _result(PASS, 1.0, "no fix commits in last 50 — nothing to check")
        uncovered = []
        for sha, msg in fix_commits[:10]:  # sample last 10 fix commits
            try:
                rc = subprocess.run(
                    ["git", "-C", _PROJECT, "show", "--name-only", "--format=", sha],
                    capture_output=True, text=True, timeout=3,
                )
                files = [f for f in rc.stdout.splitlines() if f.strip()]
            except Exception:
                continue
            has_test = any(
                ("verify-" in f or "test-" in f or "_test." in f
                 or "stress-test" in f or "verifier" in f.lower())
                for f in files
            )
            if not has_test:
                uncovered.append(f"{sha[:8]} {msg[:60]}")
        if not uncovered:
            return _result(PASS, 1.0, f"{len(fix_commits)} fix commits, all include test/verifier changes")
        # WARN not FAIL — this is aspirational, not mandatory. Small project
        # code fixes don't always need new tests.
        return _result(
            WARN, max(0.0, 1.0 - len(uncovered) / 10.0),
            f"{len(uncovered)} recent fix commit(s) without a new test/verifier",
            uncovered[:5],
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

        # 3. Ollama daemon (CPU port 11436 for arbiter)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:11436/api/tags")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    backends["ollama_arbiter"] = "11436"
                else:
                    backends["ollama_arbiter"] = None
        except Exception:
            backends["ollama_arbiter"] = None

        # 4. HME shim (port 7734 for RAG)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:7734/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                backends["hme_shim"] = "7734" if r.status == 200 else None
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


class LifesaverIntegrityVerifier(Verifier):
    """Enforce the LIFESAVER no-dilution rule at the code level.

    LIFESAVER's entire purpose is to be painful until the root cause is fixed.
    Any cooldown, throttle, deduplication, or suppression of LIFESAVER fires
    is a CRITICAL VIOLATION because it dilutes the signal that motivates fixes.
    A "false positive" LIFESAVER is itself a life-critical bug: either the
    detector is wrong (fix the detector at full urgency) or the condition is
    real (fix the condition at full urgency). NEVER reduce alert frequency
    without first eliminating the trigger.

    This verifier scans the call sites of register_critical_failure and the
    Meta-observer L14 alert emission loop. If it finds any gating logic
    (cooldowns, last_fired timestamps, _seen sets, dedup flags) in the call
    path, it FAILs with score 0 and weight 5 — enough to break HCI on its own.

    Reason: if this fails, LIFESAVER is lying about how bad things are,
    which is worse than the original problem.
    """
    name = "lifesaver-integrity"
    category = "runtime"
    weight = 5.0  # highest weight — silencing LIFESAVER is a category-killing bug

    def run(self) -> VerdictResult:
        # Files that contain LIFESAVER firing sites
        fire_sites = [
            os.path.join(_SERVER_DIR, "rag_proxy.py"),
            os.path.join(_SERVER_DIR, "context.py"),
            os.path.join(_SERVER_DIR, "meta_observer.py"),
        ]
        # Patterns that would indicate LIFESAVER gating / dampening
        # Note: _ALERT_LOG_COOLDOWN is an existing, intentional 30-min cooldown
        # on Meta-observer L14 ALERT LOGGING — not on LIFESAVER fires. That's
        # allowed because it only throttles the log message, not the
        # condition detection. But any NEW pattern matching "cooldown" near a
        # register_critical_failure call is a violation.
        forbidden_near_fire = [
            r"cooldown.*register_critical_failure",
            r"_last_.*_alert.*register_critical_failure",
            r"dedupe.*register_critical_failure",
            r"_suppress.*register_critical_failure",
            r"register_critical_failure.*cooldown",
            r"register_critical_failure.*if _now.*>=",
            r"register_critical_failure.*alerted_set",
        ]
        violations = []
        for path in fire_sites:
            if not os.path.isfile(path):
                continue
            try:
                with open(path) as f:
                    src = f.read()
            except Exception as e:
                return _result(ERROR, 0.0, f"read error on {path}: {e}")
            # Find every call to register_critical_failure and check the
            # surrounding 5 lines for gating patterns
            lines = src.splitlines()
            for i, line in enumerate(lines):
                if "register_critical_failure" not in line:
                    continue
                context_start = max(0, i - 5)
                context_end = min(len(lines), i + 5)
                window = "\n".join(lines[context_start:context_end])
                for pat in forbidden_near_fire:
                    if re.search(pat, window, re.IGNORECASE | re.DOTALL):
                        violations.append(
                            f"{os.path.basename(path)}:{i+1} — potential LIFESAVER gating near register_critical_failure: matched /{pat}/"
                        )
                        break
                # Explicit check: any `if _now - X >=` pattern within 3 lines
                # before register_critical_failure suggests a cooldown guard
                for j in range(max(0, i - 3), i):
                    if re.search(r"if\s+.*(now|time\.time\(\)).*(>=|>|<|<=).*\d", lines[j]):
                        if "register_critical_failure" in "\n".join(lines[j:i + 1]):
                            violations.append(
                                f"{os.path.basename(path)}:{j+1}-{i+1} — time-based guard immediately before register_critical_failure (possible cooldown subversion)"
                            )
                            break
        if not violations:
            return _result(PASS, 1.0,
                           "LIFESAVER fire paths are ungated (no cooldown/dampening detected)")
        return _result(
            FAIL, 0.0,
            f"{len(violations)} LIFESAVER gating pattern(s) found — CRITICAL: signal dilution subversion",
            violations + [
                "RULE: LIFESAVER must fire for every real occurrence. Dampening hides pain from the agent.",
                "If alert is 'false positive', fix the detector at life-critical urgency — do NOT silence it.",
            ],
        )


class ToolResponseLatencyVerifier(Verifier):
    """Baseline-relative latency verifier.

    Absolute thresholds (e.g. "> 5s is bad") don't work here because HME's
    synthesis stack runs on local LLMs on amateur hardware where 10+ second
    latency is normal. Instead, build a rolling baseline from the history
    file metrics/hme-latency-history.json (median of last 20 readings) and
    FAIL only when the CURRENT value is a significant regression from that
    machine-specific baseline. On the first run (no history), the current
    value becomes the first data point and the verifier passes.

    This removes the "HME is slow" false positive on slow hardware while
    still catching real regressions ("HME got suddenly slower").
    """
    name = "tool-response-latency"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        candidates = [
            os.path.join(_PROJECT, "tools", "HME", "mcp", "server", "hme-ops.json"),
            os.path.join(_PROJECT, ".claude", "mcp", "HME", "hme-ops.json"),
            os.path.join(_PROJECT, "tmp", "hme-ops.json"),
        ]
        ops_file = next((p for p in candidates if os.path.isfile(p)), None)
        if ops_file is None:
            return _result(SKIP, 1.0, "no hme-ops.json found")
        try:
            with open(ops_file) as f:
                ops = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        ema_ms = ops.get("tool_response_ms_ema", 0.0)
        if ema_ms <= 0:
            return _result(SKIP, 1.0, "no tool_response_ms_ema data")

        history_file = os.path.join(_PROJECT, "metrics", "hme-latency-history.json")
        history: list = []
        try:
            if os.path.isfile(history_file):
                with open(history_file) as hf:
                    history = json.load(hf)
        except Exception:
            history = []

        # Record the current reading (persist after scoring so the FIRST run
        # sees its own history as empty — baseline establishes on 2nd run)
        new_history = history + [{"ts": time.time(), "ema_ms": ema_ms}]
        # Keep at most 50 entries
        new_history = new_history[-50:]
        try:
            os.makedirs(os.path.dirname(history_file), exist_ok=True)
            with open(history_file, "w") as hf:
                json.dump(new_history, hf)
        except Exception:
            pass

        # Score based on history
        if len(history) < 3:
            return _result(
                PASS, 1.0,
                f"tool response EMA {ema_ms:.0f}ms (baseline forming: {len(history)}/3 samples)",
                [f"no FAIL until baseline established — {3 - len(history)} more samples needed"],
            )

        prior_values = sorted(h["ema_ms"] for h in history)
        median = prior_values[len(prior_values) // 2]
        p75 = prior_values[int(len(prior_values) * 0.75)]

        # Regression scoring: how much WORSE is current vs historical median?
        # 0-1.5x median: PASS
        # 1.5-3x median: WARN
        # >3x median or >3x p75: FAIL
        ratio_med = ema_ms / median if median > 0 else 1.0
        ratio_p75 = ema_ms / p75 if p75 > 0 else 1.0
        details = [
            f"current={ema_ms:.0f}ms",
            f"baseline_median={median:.0f}ms ({len(history)} samples)",
            f"ratio={ratio_med:.2f}× median",
        ]

        if ratio_med >= 3.0 or ratio_p75 >= 3.0:
            score = max(0.0, 1.0 - (ratio_med - 1.5) / 3.0)
            return _result(
                FAIL, score,
                f"latency regression: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}×)",
                details + ["latency spiked — investigate recent changes"],
            )
        if ratio_med >= 1.5:
            return _result(
                WARN, 0.7,
                f"latency elevated: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}×)",
                details,
            )
        return _result(
            PASS, 1.0,
            f"latency within baseline: {ema_ms:.0f}ms (median {median:.0f}ms)",
            details,
        )


class TrajectoryTrendVerifier(Verifier):
    """Reads metrics/hme-trajectory.json and scores the HCI trend direction.
    A prolonged downward trend or a predicted drift below threshold 80 is a
    FAIL even if the CURRENT HCI is still green — predictive coherence."""
    name = "trajectory-trend"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(_PROJECT, "metrics", "hme-trajectory.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no trajectory data — run analyze-hci-trajectory.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        if data.get("holograph_count", 0) < 2:
            return _result(SKIP, 1.0, "need 2+ holographs for trend analysis")
        trend = data.get("trend", {})
        pred = data.get("prediction") or {}
        direction = trend.get("direction", "flat")
        slope = trend.get("slope_per_day", 0.0)
        current = data.get("current", {}).get("hci", 100)

        # Predicted drop below 80 is a hard fail
        if pred.get("warning"):
            return _result(
                FAIL, 0.4,
                f"trajectory warning: {pred.get('warning')}",
                [f"current={current:.1f}", f"predicted={pred.get('next_hci_predicted', '?')}"],
            )
        if direction == "down" and abs(slope) > 1.0:
            return _result(
                WARN, 0.7,
                f"HCI declining at {slope:.2f}/day",
                ["downward trend >1 point/day"],
            )
        if direction == "down":
            return _result(
                PASS, 0.9,
                f"HCI flat-ish downward ({slope:.2f}/day) — monitor",
            )
        return _result(PASS, 1.0, f"HCI trend {direction} ({slope:+.2f}/day)")


class FeedbackGraphVerifier(Verifier):
    """metrics/feedback_graph.json validates against scripts/validate-feedback-graph.js"""
    name = "feedback-graph"
    category = "topology"
    weight = 1.0

    def run(self) -> VerdictResult:
        graph = os.path.join(_PROJECT, "metrics", "feedback_graph.json")
        if not os.path.isfile(graph):
            return _result(SKIP, 1.0, "no feedback_graph.json")
        try:
            with open(graph) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"feedback_graph.json invalid: {e}")
        loops = data.get("loops", [])
        ports = data.get("firewallPorts", [])
        return _result(PASS, 1.0,
                       f"{len(loops)} loops + {len(ports)} firewall ports declared")


class ReloadableModuleSyncVerifier(Verifier):
    """Every module in RELOADABLE list in evolution_selftest.py actually exists."""
    name = "reloadable-sync"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        selftest = os.path.join(_SERVER_DIR, "tools_analysis", "evolution_selftest.py")
        if not os.path.isfile(selftest):
            return _result(SKIP, 1.0, "no selftest file")
        try:
            with open(selftest) as f:
                src = f.read()
            m = re.search(r'RELOADABLE\s*=\s*\[(.*?)\]', src, re.DOTALL)
            if not m:
                return _result(ERROR, 0.0, "could not find RELOADABLE list")
            declared = re.findall(r'"([^"]+)"', m.group(1))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error: {e}")
        ta_dir = os.path.join(_SERVER_DIR, "tools_analysis")
        missing = [name for name in declared
                   if not os.path.isfile(os.path.join(ta_dir, f"{name}.py"))]
        if not missing:
            return _result(PASS, 1.0, f"{len(declared)}/{len(declared)} modules exist")
        score = 1.0 - len(missing) / len(declared)
        return _result(FAIL, score, f"{len(missing)}/{len(declared)} reloadable modules missing",
                       missing)


class MCPInstructionsEmptyVerifier(Verifier):
    """FastMCP instructions field in main.py should be empty per the A1 fix —
    SKILL.md is the single source of truth. A populated instructions field
    risks drifting out of sync with the actual tool surface."""
    name = "mcp-instructions-empty"
    category = "coverage"
    weight = 1.0

    def run(self) -> VerdictResult:
        main_py = os.path.join(_SERVER_DIR, "main.py")
        if not os.path.isfile(main_py):
            return _result(SKIP, 1.0, "main.py not found")
        try:
            with open(main_py) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Find FastMCP(...) call and check if it has an instructions kwarg
        m = re.search(r'FastMCP\s*\(\s*"HME"\s*(,\s*[^)]*)?\)', src, re.DOTALL)
        if not m:
            return _result(ERROR, 0.0, "FastMCP call not found")
        args = m.group(1) or ""
        if "instructions" in args:
            return _result(
                WARN, 0.5,
                "FastMCP has instructions= field — risks drift from SKILL.md",
                ["consider removing to keep SKILL.md as single source of truth"],
            )
        return _result(PASS, 1.0, "FastMCP instructions field not set (SKILL.md is source of truth)")


class TodoMergeHookConsistencyVerifier(Verifier):
    """The TodoWrite hook should NOT block — it should exit 0 so native
    TodoWrite proceeds. If it ever goes back to exit 2 / decision:block the
    agent's session-visible todo list freezes. This regression check."""
    name = "todowrite-hook-nonblock"
    category = "code"
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


class OnboardingChainImportVerifier(Verifier):
    """onboarding_chain.py should import cleanly (no syntax errors or
    top-level side effects that require the MCP server)."""
    name = "onboarding-chain-importable"
    category = "state"
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


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

REGISTRY = [
    DocDriftVerifier(),
    DocstringPresenceVerifier(),
    PythonSyntaxVerifier(),
    ShellSyntaxVerifier(),
    HookExecutabilityVerifier(),
    DecoratorOrderVerifier(),
    TodoMergeHookConsistencyVerifier(),
    StatesSyncVerifier(),
    OnboardingFlowVerifier(),
    OnboardingStateIntegrityVerifier(),
    OnboardingChainImportVerifier(),
    TodoStoreSchemaVerifier(),
    ReloadableModuleSyncVerifier(),
    HookRegistrationVerifier(),
    HookMatcherValidityVerifier(),
    MCPInstructionsEmptyVerifier(),
    ToolSurfaceCoverageVerifier(),
    ShimHealthVerifier(),
    ErrorLogVerifier(),
    SubagentModeVerifier(),
    SubagentPassthroughVerifier(),
    SubagentGuardVerifier(),
    SubagentBackendsVerifier(),
    WarmContextFreshnessVerifier(),
    HookLatencyVerifier(),
    PlanOutputValidityVerifier(),
    GitCommitTestCoverageVerifier(),
    TransientErrorFilterVerifier(),
    VerifierCoverageGapVerifier(),
    MemeticDriftVerifier(),
    PredictiveHCIVerifier(),
    LifesaverIntegrityVerifier(),
    LifesaverRateVerifier(),
    MetaObserverCoherenceVerifier(),
    ToolResponseLatencyVerifier(),
    TrajectoryTrendVerifier(),
    FeedbackGraphVerifier(),
]


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------

def run_engine() -> dict:
    results = {}
    by_category: dict = {}
    for v in REGISTRY:
        result = v.execute()
        results[v.name] = {
            "category": v.category,
            "weight": v.weight,
            **result.to_dict(),
        }
        by_category.setdefault(v.category, []).append((v, result))

    # Aggregate weighted score per category, then overall
    category_scores = {}
    for cat, entries in by_category.items():
        total_w = sum(v.weight for v, _r in entries)
        weighted = sum(v.weight * r.score for v, r in entries)
        category_scores[cat] = {
            "score": (weighted / total_w) if total_w > 0 else 0.0,
            "verifier_count": len(entries),
            "weight_total": total_w,
        }

    total_w = sum(v.weight for v in REGISTRY)
    weighted = sum(v.weight * results[v.name]["score"] for v in REGISTRY)
    hci = (weighted / total_w * 100.0) if total_w > 0 else 0.0

    return {
        "hci": round(hci, 1),
        "verifier_count": len(REGISTRY),
        "categories": category_scores,
        "verifiers": results,
        "timestamp": time.time(),
        "project_root": _PROJECT,
    }


# --------------------------------------------------------------------------
# Output formatters
# --------------------------------------------------------------------------

def format_text(report: dict) -> str:
    lines = []
    hci = report["hci"]
    bar = "█" * int(hci / 5) + "░" * (20 - int(hci / 5))
    lines.append("# HME Coherence Index")
    lines.append("")
    lines.append(f"  HCI: {hci:5.1f} / 100  [{bar}]")
    lines.append(f"  {report['verifier_count']} verifiers across {len(report['categories'])} categories")
    lines.append("")

    lines.append("## Categories")
    for cat in sorted(report["categories"].keys()):
        info = report["categories"][cat]
        score_pct = info["score"] * 100
        lines.append(f"  {cat:12} {score_pct:5.1f}%   ({info['verifier_count']} verifier{'s' if info['verifier_count'] != 1 else ''})")
    lines.append("")

    lines.append("## Verifiers (status / score / summary)")
    by_cat: dict = {}
    for name, info in report["verifiers"].items():
        by_cat.setdefault(info["category"], []).append((name, info))
    for cat in sorted(by_cat.keys()):
        lines.append(f"")
        lines.append(f"### {cat}")
        for name, info in sorted(by_cat[cat]):
            score_pct = info["score"] * 100
            lines.append(f"  {info['status']:5}  {score_pct:5.1f}%  {name:30}  {info['summary']}")
            if info["status"] in (FAIL, ERROR) and info["details"]:
                for d in info["details"][:5]:
                    lines.append(f"           {d}")
    lines.append("")
    return "\n".join(lines)


def main(argv: list) -> int:
    threshold = 80.0
    output_mode = "text"
    for arg in argv:
        if arg == "--json":
            output_mode = "json"
        elif arg == "--score":
            output_mode = "score"
        elif arg.startswith("--threshold="):
            try:
                threshold = float(arg.split("=", 1)[1])
            except ValueError:
                pass

    try:
        report = run_engine()
    except Exception as e:
        import traceback
        sys.stderr.write(f"engine error: {e}\n{traceback.format_exc()}")
        return 2

    if output_mode == "json":
        print(json.dumps(report, indent=2))
    elif output_mode == "score":
        print(int(round(report["hci"])))
    else:
        print(format_text(report))

    return 0 if report["hci"] >= threshold else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
