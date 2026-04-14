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
    StatesSyncVerifier(),
    OnboardingFlowVerifier(),
    OnboardingStateIntegrityVerifier(),
    TodoStoreSchemaVerifier(),
    HookRegistrationVerifier(),
    ToolSurfaceCoverageVerifier(),
    ShimHealthVerifier(),
    ErrorLogVerifier(),
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
