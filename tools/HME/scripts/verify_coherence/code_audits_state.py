"""Code-audit verifiers -- extracted cluster. Imports re-export back to
the parent code_audits.py for stable __init__.py imports."""
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


# State + lifecycle + integration verifiers.

class StateFileOwnershipVerifier(Verifier):
    """Delegates to scripts/audit-state-file-ownership.py, which checks
    that every grep-detectable writer of a shared state file is declared
    in `tools/HME/config/state-files.json`. Pattern surfaced by peer-review
    iter 136 as the most-impactful unwatched architectural contract:
    HME spans 4+ runtimes that all touch shared filesystem state, and
    until this verifier existed nothing automated guarded against an
    unregistered writer.

    Weight 1.5 -- gating: a new writer of `hme-errors.log` or
    `hme-nexus.state` without coordination is a real risk class
    (concurrent append/truncate, source-tag confusion). FAIL on any
    detected drift; the JSON registry is the authoritative source.
    """
    name = "state-file-ownership"
    category = "code"
    subtag = "interface-contract"
    weight = 1.5

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-state-file-ownership.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script])
        if rc == 0:
            return _result(PASS, 1.0,
                           out.splitlines()[-1] if out else "all writers declared")
        # Drift detected -- failed verifier. Surface the drift lines.
        drift_lines = [l for l in out.splitlines()
                       if "drift" in l or " -- writer not declared" in l
                       or "writes detected but not in registry" in l]
        return _result(FAIL,
                       max(0.0, 1.0 - 0.1 * len(drift_lines)),
                       f"{len(drift_lines)} undeclared writer(s) of shared state",
                       drift_lines[:15])




class ClaudeSettingsJsonVerifier(Verifier):
    """Validates ~/.claude/settings.json parses as JSON, every hook command
    path resolves, and Claude lifecycle/tool hooks route through the event
    kernel adapter. This catches both syntax breaks and stale wrapper drift:
    either one silently disconnects PreToolUse/PostToolUse/Stop behavior from
    the active implementation."""
    name = "claude-settings-json"
    category = "code"
    subtag = "interface-contract"
    weight = 3.0   # load-bearing: invalid settings.json silently breaks everything

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-claude-settings.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        count = payload.get("violation_count", 0)
        if count == 0:
            return _result(PASS, 1.0, f"{payload.get('settings_path')}: valid + event-kernel routed")
        return _result(FAIL, 0.0,
                       f"{count} issue(s) in {payload.get('settings_path')}",
                       payload.get("violations", [])[:10])




class HumanDeferredAuditVerifier(Verifier):
    """Delegates to scripts/audit-human-deferred.py -- the human-side
    parallel of the agent-policing detector chain. Pattern surfaced by
    peer-review iter 145: HME has nine detectors for agent failure
    modes (psycho_stop / exhaust_check / abandon_check / etc.) and
    zero detectors for human-side parallel patterns (unwired
    remediation arms, MVP-scope admissions left for months, "Phase N"
    deferrals where phase N never arrived).

    Same cognitive pattern, scored only on one side until this verifier
    existed. Advisory weight (0.5): goal is monotonic decrease over
    time, not zero. New entries should ideally come with a deadline
    or tracking issue. PASS regardless of count -- the signal is the
    DELTA across runs, surfaced via verifier history.
    """
    name = "human-deferred"
    category = "code"
    subtag = "structural-integrity"
    weight = 0.5

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-human-deferred.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script])
        # Parse the count from the header line
        import re as _re_hd
        m = _re_hd.search(r"(\d+) deferral marker\(s\) across (\d+) categor", out)
        if not m:
            return _result(WARN, 0.5, "could not parse audit output",
                           [out[:200], err[:200]])
        total = int(m.group(1))
        cats = int(m.group(2))
        # Always PASS -- this is observability, not a gate. Score reflects
        # the count for trending purposes but doesn't fail.
        score = max(0.0, 1.0 - total / 1000.0)
        sample_lines = [l for l in out.splitlines()
                        if l.strip().startswith("[") and "]" in l[:8]][:8]
        return _result(PASS, score,
                       f"{total} human-side deferral marker(s) across {cats} categories -- "
                       "advisory; trend across runs is the signal",
                       sample_lines)




class ProxyMiddlewareRegistryVerifier(Verifier):
    """Every file in tools/HME/proxy/middleware/*.js must (a) carry the
    NN_ numeric prefix encoding load order, AND (b) not throw at require()
    time. Born from dir_context.js silent failure (undefined-ROOT ReferenceError
    caused silent non-registration). Surface this class immediately."""
    name = "proxy-middleware-registry"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        import re as _re_mw
        mw_dir = os.path.join(_PROJECT, "tools", "HME", "proxy", "middleware")
        if not os.path.isdir(mw_dir):
            return _result(SKIP, 1.0, "middleware dir not present", [mw_dir])
        # Mirror loadAll() exclusions: skip index.js, _-prefixed utilities, tests.
        def _is_middleware(f: str) -> bool:
            if not f.endswith(".js") or f == "index.js":
                return False
            if f.startswith("test_") or f.endswith(".test.js") or f.endswith("_test.js"):
                return False
            if f.startswith("_"):
                return False
            return True
        prefix_re = _re_mw.compile(r"^\d+_")
        files = sorted(f for f in os.listdir(mw_dir) if _is_middleware(f))
        unprefixed = [f for f in files if not prefix_re.match(f)]
        phase_issues = []
        phase_path = os.path.join(mw_dir, "phases.json")
        try:
            with open(phase_path) as f:
                phase_data = json.load(f)
            phases = phase_data.get("phases", [])
            if not isinstance(phases, list):
                phase_issues.append("phases.json: phases must be a list")
                phases = []
            canonical = ["normalize", "strip", "enrich", "route", "observe", "commit"]
            ids = [str(p.get("id")) for p in phases if isinstance(p, dict)]
            if ids != canonical:
                phase_issues.append(f"phases.json: ids must be {canonical}, got {ids}")
            for fname in files:
                m = prefix_re.match(fname)
                if not m:
                    continue
                n = int(fname.split("_", 1)[0])
                hits = []
                for phase in phases:
                    r = phase.get("range") if isinstance(phase, dict) else None
                    if isinstance(r, list) and len(r) == 2 and int(r[0]) <= n <= int(r[1]):
                        hits.append(str(phase.get("id", "?")))
                if len(hits) != 1:
                    phase_issues.append(f"{fname}: expected exactly one phase, got {hits}")
        except FileNotFoundError:
            phase_issues.append("phases.json missing")
        except Exception as e:
            phase_issues.append(f"phases.json invalid: {type(e).__name__}: {e}")
        # Require() each middleware in a fresh Node subprocess to confirm load.
        import subprocess as _sp_mr
        load_failures = []
        for fname in files:
            abs_path = os.path.join(mw_dir, fname)
            try:
                rc = _sp_mr.run(
                    ["node", "-e", f"require('{abs_path}')"],
                    capture_output=True, text=True, timeout=5,
                    env={**os.environ, "PROJECT_ROOT": _PROJECT},
                )
                if rc.returncode != 0:
                    msg = (rc.stderr or rc.stdout or "").strip().splitlines()
                    load_failures.append(f"{fname}: {msg[-1] if msg else 'rc=' + str(rc.returncode)}")
            except Exception as _e:
                load_failures.append(f"{fname}: {type(_e).__name__}: {_e}")
        issues = []
        if load_failures:
            issues.extend(f"LOAD FAIL: {x}" for x in load_failures)
        if unprefixed:
            issues.append(f"files lacking NN_ numeric prefix (load alphabetically AFTER prefixed): {', '.join(unprefixed)}")
        if phase_issues:
            issues.extend(f"PHASE: {x}" for x in phase_issues)
        if not issues:
            return _result(PASS, 1.0,
                           f"{len(files)} middleware loadable, all NN_-prefixed and phased",
                           [])
        score = 0.0 if load_failures else 0.6
        verdict = FAIL if load_failures else WARN
        return _result(verdict, score,
                       f"{len(load_failures)} load failure(s), "
                       f"{len(unprefixed)} unprefixed file(s)",
                       issues[:10])


class CompatibilityLayerExpiryVerifier(Verifier):
    """Files named bridge/shim/wrapper must have executable expiry policy."""
    name = "compatibility-layer-expiry"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        registry_path = os.path.join(_PROJECT, "tools", "HME", "config", "compatibility-layers.json")
        try:
            with open(registry_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"compatibility registry unreadable: {e}")
        entries = data.get("layers", [])
        registered = {str(e.get("path", "")) for e in entries if isinstance(e, dict)}
        issues = []
        registry_rel = os.path.relpath(registry_path, _PROJECT)

        def _scan_refs(pattern: str, excluded: set[str]) -> list[str]:
            refs = []
            rx = re.compile(pattern)
            for root in (os.path.join(_PROJECT, "tools", "HME"),
                         os.path.join(_PROJECT, "scripts"),
                         os.path.join(_PROJECT, "doc")):
                for dirpath, dirnames, filenames in os.walk(root):
                    dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules", ".git")]
                    for fname in filenames:
                        rel = os.path.relpath(os.path.join(dirpath, fname), _PROJECT)
                        if rel in excluded or fname.endswith((".pyc", ".pyo")):
                            continue
                        try:
                            with open(os.path.join(_PROJECT, rel), encoding="utf-8", errors="ignore") as f:
                                for lineno, line in enumerate(f, 1):
                                    if rx.search(line):
                                        refs.append(f"{rel}:{lineno}")
                                        break
                        except OSError:
                            # silent-ok: unreadable files cannot be expiry refs.
                            continue
            return refs

        for entry in entries:
            if not isinstance(entry, dict):
                issues.append("registry entry is not an object")
                continue
            for field in ("path", "kind", "owner", "reason", "expires"):
                if not str(entry.get(field, "")).strip():
                    issues.append(f"{entry.get('path', '?')}: missing {field}")
            expires = entry.get("expires")
            path = str(entry.get("path", ""))
            if not isinstance(expires, dict):
                issues.append(f"{path}: expires must be an object with kind")
                continue
            kind = expires.get("kind")
            if kind not in ("never", "zero_refs", "date", "replacement_ready"):
                issues.append(f"{path}: unknown expires.kind={kind!r}")
            if kind == "never" and not str(expires.get("reason", "")).strip():
                issues.append(f"{path}: expires.kind=never needs reason")
            if kind == "replacement_ready":
                repl = str(expires.get("replacement", ""))
                if not repl:
                    issues.append(f"{path}: replacement_ready missing replacement")
                elif not os.path.exists(os.path.join(_PROJECT, repl)):
                    issues.append(f"{path}: replacement missing: {repl}")
                if not str(expires.get("delete_when", "")).strip():
                    issues.append(f"{path}: replacement_ready missing delete_when")
            if kind == "zero_refs":
                scan = str(expires.get("scan", ""))
                if not scan:
                    issues.append(f"{path}: zero_refs missing scan")
                else:
                    refs = _scan_refs(scan, {path, registry_rel})
                    if not refs:
                        issues.append(f"{path}: expiry condition met; delete this layer")
        for root in (os.path.join(_PROJECT, "tools", "HME"), os.path.join(_PROJECT, "scripts")):
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules", ".git")]
                for fname in filenames:
                    rel = os.path.relpath(os.path.join(dirpath, fname), _PROJECT)
                    if "/tests/" in rel or rel.startswith("scripts/test/"):
                        continue
                    low = fname.lower()
                    if not any(x in low for x in ("bridge", "shim", "wrapper")):
                        continue
                    if fname.endswith((".pyc", ".pyo")):
                        continue
                    if rel not in registered:
                        issues.append(f"{rel}: missing compatibility expiry registry entry")
        if issues:
            return _result(FAIL, 0.0, f"{len(issues)} compatibility layer issue(s)", issues[:12])
        return _result(PASS, 1.0, f"{len(entries)} compatibility layers have executable expiry policy")


class ToolMetadataFactoryVerifier(Verifier):
    """HME server tools must register through the canonical metadata factory."""
    name = "tool-metadata-factory"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        factory = os.path.join(_PROJECT, "tools", "HME", "service", "server", "tool_metadata.py")
        registry = os.path.join(_PROJECT, "tools", "HME", "service", "server", "tool_registry.py")
        issues = []
        for p in (factory, registry):
            if not os.path.isfile(p):
                issues.append(f"missing {os.path.relpath(p, _PROJECT)}")
        if issues:
            return _result(FAIL, 0.0, "tool metadata factory missing", issues)
        try:
            with open(registry) as f:
                src = f.read()
            with open(factory) as f:
                fac = f.read()
        except OSError as e:
            return _result(ERROR, 0.0, f"tool metadata files unreadable: {e}")
        for needle in ("tool_metadata(fn", "x_hme_metadata", "list_metadata"):
            if needle not in src:
                issues.append(f"tool_registry.py missing {needle}")
        for field in ("i_surface", "permissions", "lifecycle", "tests", "docstring"):
            if field not in fac:
                issues.append(f"tool_metadata.py missing {field}")
        if issues:
            return _result(FAIL, 0.0, f"{len(issues)} tool metadata issue(s)", issues)
        return _result(PASS, 1.0, "tool metadata factory feeds tool schemas and registry metadata")


class GeneratedISurfaceVerifier(Verifier):
    """The public i/ command files must be generated from i_registry.json."""
    name = "generated-i-surface"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        reg_path = os.path.join(_PROJECT, "tools", "HME", "i_registry.json")
        dispatcher = os.path.join(_PROJECT, "scripts", "hme-i-dispatch.js")
        generator = os.path.join(_PROJECT, "scripts", "generate-i-shims.js")
        try:
            with open(reg_path) as f:
                reg = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"i registry unreadable: {e}")
        issues = []
        if reg.get("generated_by") != "scripts/generate-i-shims.js":
            issues.append("i_registry.json missing generated_by=scripts/generate-i-shims.js")
        for p in (dispatcher, generator):
            if not os.path.isfile(p):
                issues.append(f"missing {os.path.relpath(p, _PROJECT)}")
        commands = sorted((reg.get("commands") or {}).keys())
        i_dir = os.path.join(_PROJECT, "i")
        files = sorted(f for f in os.listdir(i_dir) if os.path.isfile(os.path.join(i_dir, f)) and not f.startswith("."))
        if files != commands:
            issues.append(f"i/ files differ from registry: files={files}, registry={commands}")
        for name in commands:
            p = os.path.join(i_dir, name)
            try:
                with open(p) as f:
                    body = f.read()
            except OSError as e:
                issues.append(f"i/{name} unreadable: {e}")
                continue
            if "generated by scripts/generate-i-shims.js" not in body or f'"{name}" "$@"' not in body:
                issues.append(f"i/{name} is not a generated shim")
        if os.path.isfile(generator):
            proc = subprocess.run(
                ["node", generator, "--check"],
                capture_output=True,
                text=True,
                timeout=10,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if proc.returncode != 0:
                issues.append("generate-i-shims.js --check failed")
                issues.extend((proc.stderr or proc.stdout).splitlines()[:6])
        if issues:
            return _result(FAIL, 0.0, f"{len(issues)} generated i-surface issue(s)", issues[:12])
        return _result(PASS, 1.0, f"{len(commands)} i/ shims generated from i_registry.json")




class InterControllerCoherenceVerifier(Verifier):
    """Linfinfinf -- observes the observation apparatus. Delegates to
    scripts/audit-intercontroller-coherence.py which scans per-controller
    per-axis effects and surfaces pairs working at cross-purposes
    (cancellation). Silent no-data is PASS -- no false alarms while the
    snapshot pipeline hasn't populated effect fields yet."""
    name = "intercontroller-coherence"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-intercontroller-coherence.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        if payload.get("status") == "no_data":
            return _result(PASS, 1.0, "no controller-effect data yet (fresh setup)")
        cancelling = payload.get("cancelling_pairs", [])
        if not cancelling:
            return _result(PASS, 1.0, f"{payload.get('controllers_observed')} controllers, no cancellation detected")
        top = cancelling[0]
        detail = [f"{'/'.join(p['controllers'])} score={p['cancellation_score']}" for p in cancelling[:5]]
        # Cancellation isn't a FAIL -- it's signal. Controllers may legitimately
        # oppose on some axes. Score accumulates as more pairs oppose.
        score = max(0.5, 1.0 - 0.1 * len(cancelling))
        return _result(PASS, score,
                       f"{len(cancelling)} controller pair(s) with mutual cancellation; top={top['cancellation_score']}",
                       detail)




class ShellHookAuditVerifier(Verifier):
    """Delegates to scripts/audit-shell-hooks.py, which statically scans
    tools/HME/hooks/**/*.sh for cache-trap patterns -- most notably
    BASH_SOURCE-relative path ascents that resolve INTO the plugin cache
    tree when Claude Code invokes a hook from there. Closes the blind
    spot that let _safety.sh, _autocommit.sh, stop.sh, and every file in
    hooks/direct/ silently run with PROJECT_ROOT unset / .env missing
    for months. ESLint covers .js; _scan_python_bug_patterns covers .py;
    this verifier covers .sh."""
    name = "shell-hook-audit"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-shell-hooks.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        count = payload.get("violation_count", 0)
        detail = []
        for fileinfo in payload.get("files", []):
            for finding in fileinfo.get("findings", []):
                detail.append(
                    f"{fileinfo['file']}:{finding['line']} [{finding['rule']}] {finding['reason']}"
                )
        if count == 0:
            return _result(PASS, 1.0, "no shell-hook cache-trap violations", [])
        # Each violation drops score by 0.2; floor at 0. Any violation at
        # all is FAIL -- the bugs these rules catch are silent-disable
        # class, not ergonomic nits.
        score = max(0.0, 1.0 - 0.2 * count)
        return _result(FAIL, score,
                       f"{count} shell-hook violation(s) -- BASH_SOURCE cache-trap risk",
                       detail[:20])




class ActivityEventsDocSyncVerifier(Verifier):
    """The event names in tools/HME/activity/EVENTS.md must match the
    set actually emitted across hooks/middleware/python. Drift here means
    the agent reading the activity log will hit names with no reference.

    Live set: union of `--event=<name>` (shell/python) and
    `event: '<name>'` (JS proxy middleware) across the repo.
    Doc set: bullet entries `- **\\`<name>\\`**` in EVENTS.md.

    FAIL if doc-only entries exist (stale references), WARN on
    code-only entries (undocumented new event)."""
    name = "activity-events-doc-sync"
    category = "doc"
    subtag = "drift-detection"
    weight = 1.0

    def run(self) -> VerdictResult:
        doc_path = os.path.join(_PROJECT, "tools", "HME", "activity", "EVENTS.md")
        if not os.path.isfile(doc_path):
            return _result(SKIP, 1.0, "EVENTS.md not present", [doc_path])
        with open(doc_path, encoding="utf-8") as f:
            doc_content = f.read()
        doc_events = set(re.findall(r"^-\s+\*\*`([a-z_]+)`\*\*", doc_content, re.MULTILINE))

        # Scan live emitters across hooks/, scripts/, tools/HME/.
        emit_re_a = re.compile(r"--event=([a-z_]+)")
        emit_re_b = re.compile(r"event:\s*['\"]([a-z_]+)['\"]")
        emit_re_c = re.compile(r"event=['\"]([a-z_]+)['\"]")
        # Positional first-arg form (_emit_activity / emit_activity_event etc.).
        # <EVENT> placeholder used so the regex doesn't self-match this comment.
        emit_re_d = re.compile(r"_?emit(?:_activity(?:_event)?)?\(\s*['\"]([a-z_]+)['\"]")
        live = set()
        scan_roots = [
            os.path.join(_PROJECT, "tools", "HME"),
            os.path.join(_PROJECT, "scripts"),
        ]
        for root_dir in scan_roots:
            for root, dirs, files in os.walk(root_dir):
                dirs[:] = [d for d in dirs if d not in {
                    ".git", "node_modules", "__pycache__", ".venv",
                    "venv", "dist", "build", "models",
                    # Test fixtures often inject synthetic event names to
                    # exercise emit / dispatch paths; excluding them
                    # prevents the verifier from treating test scaffolding
                    # as a documentation gap.
                    "tests", "test", "specs",
                }]
                for fn in files:
                    if not fn.endswith((".py", ".sh", ".js", ".mjs", ".cjs")):
                        continue
                    p = os.path.join(root, fn)
                    try:
                        with open(p, encoding="utf-8") as fp:
                            txt = fp.read()
                    except (OSError, UnicodeDecodeError):
                        continue
                    live |= set(emit_re_a.findall(txt))
                    live |= set(emit_re_b.findall(txt))
                    live |= set(emit_re_c.findall(txt))
                    live |= set(emit_re_d.findall(txt))

        doc_only = sorted(doc_events - live)
        code_only = sorted(live - doc_events)

        # Some doc events are agent/stop-hook emissions that may not
        # appear in static scans (e.g. round_complete fired by external
        # commands). Allowlist these so the verifier stays useful.
        _DOC_ONLY_ALLOWLIST = {
            "round_complete", "state_advance", "onboarding_init",
        }
        doc_only = [e for e in doc_only if e not in _DOC_ONLY_ALLOWLIST]

        if not doc_only and not code_only:
            return _result(PASS, 1.0,
                           f"EVENTS.md matches {len(doc_events)} live event(s)")

        details = []
        if doc_only:
            details.append(f"doc-only ({len(doc_only)}): {', '.join(doc_only)}")
        if code_only:
            details.append(f"code-only ({len(code_only)}): {', '.join(code_only[:20])}"
                           + ("..." if len(code_only) > 20 else ""))
        if doc_only:
            score = max(0.0, 1.0 - len(doc_only) / 10.0)
            return _result(FAIL, score, f"{len(doc_only)} stale doc reference(s)", details)
        # code_only only: WARN, partial credit.
        score = max(0.5, 1.0 - len(code_only) / 20.0)
        return _result(WARN, score, f"{len(code_only)} undocumented event(s)", details)
