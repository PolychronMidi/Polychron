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
    telemetry_event_names,
)


# State + lifecycle + integration verifiers.

class StateFileOwnershipVerifier(Verifier):
    """Delegates to tools/HME/scripts/audit-state-file-ownership.py, which checks
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
        sys.path.insert(0, _SCRIPTS_DIR)
        issues: list[str] = []
        try:
            from state_registry import repair_command_issues
            repair_issues = repair_command_issues()
            issues.extend(repair_issues)
        except Exception as e:
            issues.append(f"state registry helper failed: {e}")
        render_script = os.path.join(_SCRIPTS_DIR, "render-state-registry-docs.py")
        if os.path.isfile(render_script):
            rc_doc, out_doc, err_doc = _run_subprocess([render_script, "--check"])
            if rc_doc != 0:
                issues.append(out_doc.strip() or err_doc.strip() or "state registry docs stale")
        else:
            issues.append("missing render-state-registry-docs.py")
        script = os.path.join(_PROJECT, "scripts", "audit-state-file-ownership.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script, *issues])
        rc, out, err = _run_subprocess([script])
        if rc == 0 and not issues:
            return _result(PASS, 1.0,
                           out.splitlines()[-1] if out else "all writers declared")
        drift_lines = [l for l in out.splitlines()
                       if ("drift" in l and not l.startswith("no drift"))
                       or " -- writer not declared" in l
                       or "writes detected but not in registry" in l]
        details = drift_lines[:15] + issues[:15]
        return _result(FAIL,
                       max(0.0, 1.0 - 0.1 * len(details)),
                       f"{len(drift_lines)} undeclared writer(s), {len(issues)} registry issue(s)",
                       details)




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
    """Delegates to tools/HME/scripts/audit-human-deferred.py -- the human-side
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
            # silent-ok: optional fallback path.
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
                # silent-ok: optional fallback path.
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


class AdapterBoundaryRegistryVerifier(Verifier):
    """Bridge/shim/wrapper filenames must be real adapter/domain boundaries."""
    name = "adapter-boundary-registry"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        old_registry = os.path.join(_PROJECT, "tools", "HME", "config", "compatibility-layers.json")
        registry_path = os.path.join(_PROJECT, "tools", "HME", "config", "adapter-boundaries.json")
        try:
            with open(registry_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"adapter boundary registry unreadable: {e}")
        entries = data.get("boundaries", [])
        registered = {str(e.get("path", "")) for e in entries if isinstance(e, dict)}
        issues = []
        if os.path.exists(old_registry):
            issues.append("compatibility-layers.json still exists; delete compatibility layers or declare adapter boundaries")

        for entry in entries:
            if not isinstance(entry, dict):
                issues.append("registry entry is not an object")
                continue
            for field in ("path", "kind", "owner", "reason"):
                if not str(entry.get(field, "")).strip():
                    issues.append(f"{entry.get('path', '?')}: missing {field}")
            path = str(entry.get("path", ""))
            if not os.path.exists(os.path.join(_PROJECT, path)):
                issues.append(f"{path}: registered boundary path missing")
                continue
            if entry.get("kind") not in ("adapter-boundary", "domain-module", "generator"):
                issues.append(f"{path}: unknown boundary kind={entry.get('kind')!r}")
        for root in (os.path.join(_PROJECT, "tools", "HME"), os.path.join(_PROJECT, "src", "scripts")):
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules", ".git")]
                for fname in filenames:
                    rel = os.path.relpath(os.path.join(dirpath, fname), _PROJECT)
                    if "/tests/" in rel:
                        continue
                    low = fname.lower()
                    if not any(x in low for x in ("bridge", "shim", "wrapper")):
                        continue
                    if fname.endswith((".pyc", ".pyo")):
                        continue
                    if rel not in registered:
                        issues.append(f"{rel}: bridge/shim/wrapper filename must be a declared adapter/domain boundary or be renamed")
        if issues:
            return _result(FAIL, 0.0, f"{len(issues)} adapter boundary issue(s)", issues[:12])
        return _result(PASS, 1.0, f"{len(entries)} adapter/domain boundary names declared; no compatibility registry remains")


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
        if reg.get("generated_by") != "tools/HME/scripts/generate-i-shims.js":
            issues.append("i_registry.json missing generated_by=tools/HME/scripts/generate-i-shims.js")
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
            if "generated by tools/HME/scripts/generate-i-shims.js" not in body or f'"{name}" "$@"' not in body:
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
    tools/HME/scripts/audit-intercontroller-coherence.py which scans per-controller
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
    """Delegates to tools/HME/scripts/audit-shell-hooks.py, which statically scans
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
        # Cache-trap hits silently disable hooks, so any hit is a failure.
        score = max(0.0, 1.0 - 0.2 * count)
        return _result(FAIL, score,
                       f"{count} shell-hook violation(s) -- BASH_SOURCE cache-trap risk",
                       detail[:20])




class ActivityEventsDocSyncVerifier(Verifier):
    """Telemetry events must stay registry-first.

    `event_registry.json` is the source. EVENTS.md is generated from it,
    and live emitters may only use registered event names on the declared
    activity/signal stream."""
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
        registry_events = telemetry_event_names()
        registry_activity = telemetry_event_names(stream="activity")
        registry_signal = telemetry_event_names(stream="signal")

        emit_re_a = re.compile(r"--event=([a-z_]+)")
        emit_re_b = re.compile(r"event:\s*['\"]([a-z_]+)['\"]")
        emit_re_c = re.compile(r"event=['\"]([a-z_]+)['\"]")
        emit_re_d = re.compile(r"_?emit(?:_activity(?:_event)?)?\(\s*['\"]([a-z_]+)['\"]")
        emit_re_e = re.compile(r"emitActivity\(\s*['\"]([a-z_]+)['\"]")
        emit_re_f = re.compile(r"_emit_activity\s+([a-z_]+)")
        emit_re_g = re.compile(r"_signal_emit\s+([a-z_]+)")
        emit_re_h = re.compile(
            r"event:\s*[^,\n]*\?\s*['\"]([a-z_]+)['\"]\s*:\s*['\"]([a-z_]+)['\"]"
        )
        live_activity: set[str] = set()
        live_signal: set[str] = set()
        scan_roots = [
            os.path.join(_PROJECT, "tools", "HME"),
            os.path.join(_PROJECT, "scripts"),
        ]
        for root_dir in scan_roots:
            for root, dirs, files in os.walk(root_dir):
                dirs[:] = [d for d in dirs if d not in {
                    ".git", "node_modules", "__pycache__", ".venv",
                    "venv", "dist", "build", "models",
                    # Test fixtures use synthetic events; do not registry-gate them.
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
                    live_activity |= set(emit_re_a.findall(txt))
                    live_activity |= set(emit_re_b.findall(txt))
                    live_activity |= set(emit_re_c.findall(txt))
                    live_activity |= set(emit_re_d.findall(txt))
                    live_activity |= set(emit_re_e.findall(txt))
                    live_activity |= set(emit_re_f.findall(txt))
                    for first, second in emit_re_h.findall(txt):
                        live_activity.add(first)
                        live_activity.add(second)
                    live_signal |= set(emit_re_g.findall(txt))

        live = live_activity | live_signal
        doc_missing = sorted(registry_events - doc_events)
        doc_extra = sorted(doc_events - registry_events)
        unregistered = sorted(live - registry_events)
        stream_mismatches = []
        for event in sorted(live_activity & registry_events):
            if event not in registry_activity:
                stream_mismatches.append(f"{event}: emitted as activity, registry lacks activity")
        for event in sorted(live_signal & registry_events):
            if event not in registry_signal:
                stream_mismatches.append(f"{event}: emitted as signal, registry lacks signal")

        if not doc_missing and not doc_extra and not unregistered and not stream_mismatches:
            return _result(PASS, 1.0,
                           f"event registry covers {len(registry_events)} event(s); "
                           f"live scan found {len(live)}")

        details = []
        if doc_missing:
            details.append(f"doc missing ({len(doc_missing)}): {', '.join(doc_missing)}")
        if doc_extra:
            details.append(f"doc extra ({len(doc_extra)}): {', '.join(doc_extra)}")
        if stream_mismatches:
            details.extend(stream_mismatches[:20])
        if unregistered:
            details.append(f"unregistered ({len(unregistered)}): {', '.join(unregistered[:20])}"
                           + ("..." if len(unregistered) > 20 else ""))
        if doc_missing or doc_extra or stream_mismatches:
            score = max(0.0, 1.0 - (len(doc_missing) + len(doc_extra)
                                    + len(stream_mismatches)) / 20.0)
            return _result(FAIL, score, "event registry/doc stream drift", details)
        score = max(0.5, 1.0 - len(unregistered) / 20.0)
        return _result(WARN, score, f"{len(unregistered)} unregistered event(s)", details)
