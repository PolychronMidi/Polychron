"""Code-audit verifiers: core principles, shell hooks, proxy middleware, syntax."""
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


class CorePrinciplesAuditVerifier(Verifier):
    """Delegates to scripts/audit-core-principles.py, which surveys src/
    against the five core principles declared in CLAUDE.md. FAILs only on
    CRITICAL-level violations — files exceeding 400 LOC or subsystems with
    ≥1 .js file but no index.js. WARN-level findings (files over the 200-
    line soft target but under 400) are informational; the 200-line target
    is aspirational and most of the codebase brushes it occasionally."""
    name = "core-principles-audit"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-core-principles.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        crit = payload.get("critical_count", 0)
        warn = payload.get("warn_count", 0)
        p1 = payload.get("p1_count", 0)
        failfast = payload.get("failfast_hits", 0)
        detail = [f"{warn} WARN-level oversize file(s)",
                  f"{failfast} P2 indicator hit(s)"]
        for s in payload.get("subsystems", []):
            for rel, n in s.get("oversize_critical", []):
                detail.append(f"CRITICAL oversize: {rel} ({n} LOC)")
            for item in s["violations"]["P1"]:
                detail.append(f"P1 ({s['name']}): {item}")
        if crit == 0 and p1 == 0:
            return _result(PASS, 1.0,
                           f"no critical violations ({warn} warn-level, {failfast} P2 indicators)",
                           detail[:20])
        # Each critical violation drops the score by 0.25; floor at 0.
        score = max(0.0, 1.0 - 0.25 * (crit + p1))
        return _result(FAIL, score,
                       f"{crit} CRITICAL oversize file(s), {p1} P1 violation(s)",
                       detail[:20])


class ProxyMiddlewareRegistryVerifier(Verifier):
    """Every file in tools/HME/proxy/middleware/*.js must (a) be listed in
    order.json OR load cleanly unlisted, AND (b) not throw at require()
    time. Born from the dir_context.js silent failure: an undefined-ROOT
    ReferenceError caused the middleware to silently not register for
    who-knows-how-long, removing dir-intent enrichment from every turn.
    Surface this class of failure immediately."""
    name = "proxy-middleware-registry"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        import subprocess
        mw_dir = os.path.join(_PROJECT, "tools", "HME", "proxy", "middleware")
        order_path = os.path.join(mw_dir, "order.json")
        if not os.path.isdir(mw_dir):
            return _result(SKIP, 1.0, "middleware dir not present", [mw_dir])
        # Mirror the exclusion rules in middleware/index.js loadAll(): skip
        # index.js itself, the manifest, and test files (test_*.js,
        # *.test.js, *_test.js). Tests live beside the code they exercise
        # but aren't middleware and don't need registration.
        def _is_middleware(f: str) -> bool:
            if not f.endswith(".js") or f == "index.js":
                return False
            if f.startswith("test_") or f.endswith(".test.js") or f.endswith("_test.js"):
                return False
            return True
        files = sorted(f for f in os.listdir(mw_dir) if _is_middleware(f))
        try:
            with open(order_path) as f:
                order = json.load(f).get("order", [])
        except Exception as _e:
            return _result(ERROR, 0.0, f"could not read order.json: {_e}", [order_path])
        unlisted = [f for f in files if f not in order]
        missing_in_fs = [f for f in order if f not in files]
        # Attempt to require() each middleware in a fresh Node subprocess.
        # The proxy logs only show the LAST load attempt; this verifier
        # independently confirms every file can be loaded. Using subprocess
        # directly because _run_subprocess prepends python3 — we need node.
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
        if missing_in_fs:
            issues.append(f"order.json references missing files: {', '.join(missing_in_fs)}")
        if unlisted:
            issues.append(f"files not in order.json (will load alphabetically AFTER manifest): {', '.join(unlisted)}")
        if not issues:
            return _result(PASS, 1.0,
                           f"{len(files)} middleware loadable, {len(order)} in manifest",
                           [])
        score = 0.0 if load_failures else 0.6
        verdict = FAIL if load_failures else WARN
        return _result(verdict, score,
                       f"{len(load_failures)} load failure(s), "
                       f"{len(missing_in_fs)} manifest gap(s), "
                       f"{len(unlisted)} unlisted file(s)",
                       issues[:10])


class ShellHookAuditVerifier(Verifier):
    """Delegates to scripts/audit-shell-hooks.py, which statically scans
    tools/HME/hooks/**/*.sh for cache-trap patterns — most notably
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
        # all is FAIL — the bugs these rules catch are silent-disable
        # class, not ergonomic nits.
        score = max(0.0, 1.0 - 0.2 * count)
        return _result(FAIL, score,
                       f"{count} shell-hook violation(s) — BASH_SOURCE cache-trap risk",
                       detail[:20])


class InterControllerCoherenceVerifier(Verifier):
    """L∞∞∞ — observes the observation apparatus. Delegates to
    scripts/audit-intercontroller-coherence.py which scans per-controller
    per-axis effects and surfaces pairs working at cross-purposes
    (cancellation). Silent no-data is PASS — no false alarms while the
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
        # Cancellation isn't a FAIL — it's signal. Controllers may legitimately
        # oppose on some axes. Score accumulates as more pairs oppose.
        score = max(0.5, 1.0 - 0.1 * len(cancelling))
        return _result(PASS, score,
                       f"{len(cancelling)} controller pair(s) with mutual cancellation; top={top['cancellation_score']}",
                       detail)


class ClaudeSettingsJsonVerifier(Verifier):
    """Validates ~/.claude/settings.json parses as JSON + every hook command
    path resolves. Catches the exact bug class that silently disabled every
    PreToolUse/PostToolUse/Stop hook for 40+ minutes this session: a single
    trailing comma made Claude Code discard the whole hook config. Symptoms
    (NEXUS stopped tracking, auto-completeness stopped firing, thinking mode
    stopped engaging) are far removed from the cause; a static verifier
    catches it in seconds."""
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
            return _result(PASS, 1.0, f"{payload.get('settings_path')}: valid + resolvable")
        return _result(FAIL, 0.0,
                       f"{count} issue(s) in {payload.get('settings_path')}",
                       payload.get("violations", [])[:10])


class HumanDeferredAuditVerifier(Verifier):
    """Delegates to scripts/audit-human-deferred.py — the human-side
    parallel of the agent-policing detector chain. Pattern surfaced by
    peer-review iter 145: HME has nine detectors for agent failure
    modes (psycho_stop / exhaust_check / abandon_check / etc.) and
    zero detectors for human-side parallel patterns (unwired
    remediation arms, MVP-scope admissions left for months, "Phase N"
    deferrals where phase N never arrived).

    Same cognitive pattern, scored only on one side until this verifier
    existed. Advisory weight (0.5): goal is monotonic decrease over
    time, not zero. New entries should ideally come with a deadline
    or tracking issue. PASS regardless of count — the signal is the
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
        # Always PASS — this is observability, not a gate. Score reflects
        # the count for trending purposes but doesn't fail.
        score = max(0.0, 1.0 - total / 1000.0)
        sample_lines = [l for l in out.splitlines()
                        if l.strip().startswith("[") and "]" in l[:8]][:8]
        return _result(PASS, score,
                       f"{total} human-side deferral marker(s) across {cats} categories — "
                       "advisory; trend across runs is the signal",
                       sample_lines)


class StateFileOwnershipVerifier(Verifier):
    """Delegates to scripts/audit-state-file-ownership.py, which checks
    that every grep-detectable writer of a shared state file is declared
    in `doc/HME_STATE_OWNERSHIP.md`. Pattern surfaced by peer-review
    iter 136 as the most-impactful unwatched architectural contract:
    HME spans 4+ runtimes that all touch shared filesystem state, and
    until this verifier existed nothing automated guarded against an
    unregistered writer.

    Weight 1.5 — gating: a new writer of `hme-errors.log` or
    `hme-nexus.state` without coordination is a real risk class
    (concurrent append/truncate, source-tag confusion). FAIL on any
    detected drift; the doc is the authoritative registry.
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
        # Drift detected — failed verifier. Surface the drift lines.
        drift_lines = [l for l in out.splitlines()
                       if "drift" in l or " — writer not declared" in l
                       or "writes detected but not in registry" in l]
        return _result(FAIL,
                       max(0.0, 1.0 - 0.1 * len(drift_lines)),
                       f"{len(drift_lines)} undeclared writer(s) of shared state",
                       drift_lines[:15])


class SilentFailureClassVerifier(Verifier):
    """Delegates to scripts/audit-silent-failure-class.py, which surfaces
    broad-except / catch-and-swallow sites that lack a `silent-ok:`
    annotation. Pattern B from the architectural review: telemetry-class
    catches are correct but safety-belt catches must surface. The audit
    can't tell which is which automatically — it asks for a written
    justification (silent-ok: <reason>) on each intentional silence.

    Weight is ADVISORY (0.5) not gating: the codebase has many unannotated
    sites today; a PASS here is aspirational. The purpose is keeping
    the count visible over time so NEW silent-catches land annotated.
    """
    name = "silent-failure-class"
    category = "code"
    subtag = "regression-prevention"
    weight = 0.5  # advisory — annotate over time, don't block merges yet

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-silent-failure-class.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script])
        # Parse the "N unmarked silent-catch sites across K files" header
        import re as _re_sf
        m = _re_sf.search(r"(\d+) unmarked silent-catch sites across (\d+) files", out)
        if m:
            count = int(m.group(1))
            files = int(m.group(2))
            # Logarithmic scaling — expected count is in the hundreds today;
            # goal is monotonic improvement, not zero. A 10% reduction = +1
            # to the score. Below 50 sites = fully passing.
            if count <= 50:
                return _result(PASS, 1.0,
                               f"only {count} unmarked silent-catch sites (≤50 threshold)")
            score = max(0.0, 1.0 - (count - 50) / 1000.0)
            detail_lines = [l for l in out.splitlines() if ":" in l and "audit-silent-failure-class" not in l][:15]
            return _result(WARN, score,
                           f"{count} unmarked silent-catch sites across {files} files — annotate with `silent-ok:` over time",
                           detail_lines)
        return _result(SKIP, 1.0, "could not parse audit output", [out[:200], err[:200]])


class ShellUndefinedVarsVerifier(Verifier):
    """Delegates to scripts/audit-shell-undefined-vars.py, which statically
    scans tools/HME/hooks/**/*.sh for `$VAR` references that have no
    matching definition anywhere in scope (the file, any file it sources,
    or the dispatcher chain that sources it). Catches the exact bug class
    that silenced auto-completeness-inject for months: `$_AC_PROJECT`
    referenced in holograph.sh had never been defined anywhere, and under
    `set -u` in _safety.sh, stop.sh crashed before the completeness gate
    ever ran. ShellSyntaxVerifier only checks grammar; this verifier
    catches grammar-valid code that explodes at runtime."""
    name = "shell-undefined-vars"
    category = "code"
    subtag = "structural-integrity"
    weight = 2.0  # any violation is silent-disable class, rank high

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-shell-undefined-vars.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        count = payload.get("violation_count", 0)
        files_scanned = payload.get("files_scanned", 0)
        detail = []
        for fileinfo in payload.get("files", []):
            for finding in fileinfo.get("findings", []):
                detail.append(
                    f"{fileinfo['file']}:{finding['line']} ${finding['var']} — {finding['snippet'][:100]}"
                )
        if count == 0:
            return _result(PASS, 1.0, f"no undefined-variable references across {files_scanned} hook(s)")
        # Each undefined ref drops score by 0.25; floor at 0. Any violation
        # is FAIL — even a single one can silently kill an entire hook chain.
        score = max(0.0, 1.0 - 0.25 * count)
        return _result(FAIL, score,
                       f"{count} undefined-variable reference(s) — silent set-u crash risk",
                       detail[:20])


class PythonSyntaxVerifier(Verifier):
    name = "python-syntax"
    category = "code"
    subtag = "structural-integrity"
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
    subtag = "structural-integrity"
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


# Banned: 4+ identical non-word, non-whitespace, non-paren/bracket characters
# in a row. Targets visual-decoration spam — runs of equals, dashes, hashes,
# pipes, tildes, slashes, or unicode box-drawing — without false-positiving
# on legitimate code structure (stacked closing parens, identifiers with
# repeated underscores, hex constants like 0xFFFFFFFF).
_SPAM_RE = re.compile(r"([^\w\s()\[\]{}])\1{3,}")
# Per-line opt-out: line containing this token is exempt. Keep narrow so
# allowlisting requires conscious intent.
_SPAM_ALLOW = "spam-ok"
# Files/dirs exempt entirely (vendored libs, fixtures that DEFINE the
# patterns the sanitizer detects, model assets).
_SPAM_SKIP_DIRS = {
    ".git", "node_modules", "output", "tmp", "log", "dist", "build",
    "__pycache__", ".venv", "venv", "lab", "plugin-cache", "models",
}
_SPAM_SKIP_FILES = {
    # Test fixtures whose purpose is to exercise sanitizer regex catalogs.
    "tools/HME/proxy/middleware/secret_sanitizer.js",
    "tools/HME/tests/specs/secret_sanitizer.test.js",
    "tools/HME/tests/specs/migrated_policies.test.js",
    "tools/HME/tests/specs/migrated_policies_round2.test.js",
    "tools/HME/tests/specs/metaprofile_next_level.test.js",
    # Vendored: external library, not under our editorial control.
    "tools/csv_maestro/py_midicsv/midi_converters.py",
}
_SPAM_EXTS = (
    ".md", ".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".json",
    ".yaml", ".yml", ".ts", ".tsx", ".css", ".html", ".txt",
)


class AtomicStateWritesVerifier(Verifier):
    """Any state file whose partial-write would corrupt downstream readers
    (manifests, watermarks, registry-entry JSON, feedback_graph.json) MUST
    be written atomically: temp-file + os.replace (Python) or mv (shell).

    Naked `open(target, 'w')` for an ephemeral log is fine; for a state
    file a sibling process reads concurrently it is a data-corruption
    bug. This verifier AST-scans Python under tools/HME/ and scripts/
    for `open(<state-path>, 'w')` calls without a paired `os.replace`
    follow-up. Path patterns that demand atomicity live in
    project-rules.json under `atomic_write_path_patterns`.

    Per-line opt-out: append literal `# atomic-ok` to the open() line.
    Use only for ephemeral debug/log writes that are *intentionally*
    non-atomic and have no downstream concurrent reader."""
    name = "atomic-state-writes"
    category = "code"
    subtag = "data-integrity"
    weight = 3.0

    def run(self) -> VerdictResult:
        import ast
        rules_path = os.path.join(_PROJECT, "tools", "HME", "config",
                                  "project-rules.json")
        try:
            with open(rules_path) as f:
                patterns = json.load(f).get("atomic_write_path_patterns", [])
        except Exception:
            patterns = []
        if not patterns:
            return _result(SKIP, 1.0,
                           "no atomic_write_path_patterns configured",
                           [rules_path])
        compiled = [re.compile(p) for p in patterns]
        violations = []
        scanned = 0
        roots = [
            os.path.join(_PROJECT, "tools", "HME"),
            os.path.join(_PROJECT, "scripts"),
        ]
        for root in roots:
            for r, _d, files in os.walk(root):
                if any(skip in r for skip in ("__pycache__", "/tests/")):
                    continue
                for f in files:
                    if not f.endswith(".py"):
                        continue
                    scanned += 1
                    p = os.path.join(r, f)
                    try:
                        with open(p, encoding="utf-8") as fp:
                            src = fp.read()
                    except OSError:
                        continue
                    try:
                        tree = ast.parse(src)
                    except SyntaxError:
                        continue
                    src_lines = src.splitlines()
                    for node in ast.walk(tree):
                        # Match: open(<str-literal>, 'w'|'wb')
                        if not (isinstance(node, ast.Call)
                                and isinstance(node.func, ast.Name)
                                and node.func.id == "open"):
                            continue
                        if len(node.args) < 2:
                            continue
                        path_arg, mode_arg = node.args[0], node.args[1]
                        if not (isinstance(mode_arg, ast.Constant)
                                and isinstance(mode_arg.value, str)
                                and mode_arg.value.startswith("w")):
                            continue
                        if not (isinstance(path_arg, ast.Constant)
                                and isinstance(path_arg.value, str)):
                            continue
                        target = path_arg.value
                        if not any(rx.search(target) for rx in compiled):
                            continue
                        # Per-line opt-out
                        line_idx = node.lineno - 1
                        line_text = src_lines[line_idx] if line_idx < len(src_lines) else ""
                        if "atomic-ok" in line_text:
                            continue
                        violations.append(
                            f"{os.path.relpath(p, _PROJECT)}:{node.lineno}: "
                            f"open({target!r}, 'w') without atomic rename "
                            f"(use _atomic_write or temp+os.replace; "
                            f"per-line opt-out: append '# atomic-ok')"
                        )
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} Python file(s) scanned; no naked state-file writes")
        score = max(0.0, 1.0 - len(violations) * 0.2)
        return _result(FAIL, score,
                       f"{len(violations)} non-atomic state-file write(s)",
                       violations[:10])


class AntiForkHeuristicListVerifier(Verifier):
    """Heuristic lists tuned for false-positive bias (LIFESAVER severity
    words, fast-path-clean signals, fabrication-check phrases, exhaust_check
    deferral phrases) lose their failure-mode coverage if silently
    loosened. Authors mark such lists in-place with a paired comment:

        # anti-fork-begin: <name> min=N
        ...list entries (one per non-empty/non-comment line)...
        # anti-fork-end: <name>

    On every run this verifier walks tools/HME/, scripts/, src/ for those
    markers, counts non-empty/non-comment lines between each pair, and
    FAILs if any block has fewer entries than its declared minimum.

    To intentionally shrink a list, lower min=N in the same edit and add
    one line to doc/_anti_fork_log.md citing the rationale (incident link
    or spec). Forces the change to be deliberate rather than incidental."""
    name = "anti-fork-heuristic-lists"
    category = "code"
    subtag = "regression-prevention"
    weight = 2.0

    _BEGIN_RE = re.compile(
        r"^\s*(?:#|//)\s*anti-fork-begin:\s*([A-Za-z0-9_-]+)\s+min=(\d+)\b")
    _END_RE = re.compile(
        r"^\s*(?:#|//)\s*anti-fork-end:\s*([A-Za-z0-9_-]+)\b")

    def run(self) -> VerdictResult:
        roots = [
            os.path.join(_PROJECT, "tools", "HME"),
            os.path.join(_PROJECT, "scripts"),
            os.path.join(_PROJECT, "src"),
        ]
        skip_dirs = {"node_modules", "__pycache__", ".git", "output", "tmp", "log"}
        exts = (".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".ts")
        blocks_seen = 0
        violations = []
        for root in roots:
            if not os.path.isdir(root):
                continue
            for r, dirs, files in os.walk(root):
                dirs[:] = [d for d in dirs if d not in skip_dirs]
                for f in files:
                    if not f.endswith(exts):
                        continue
                    path = os.path.join(r, f)
                    try:
                        with open(path, encoding="utf-8", errors="ignore") as fp:
                            lines = fp.readlines()
                    except OSError:
                        continue
                    open_blocks = {}  # name → (min, start_line, count)
                    for idx, line in enumerate(lines, start=1):
                        m_begin = self._BEGIN_RE.match(line)
                        m_end = self._END_RE.match(line)
                        if m_begin:
                            name, min_str = m_begin.group(1), m_begin.group(2)
                            open_blocks[name] = [int(min_str), idx, 0]
                            continue
                        if m_end:
                            name = m_end.group(1)
                            spec = open_blocks.pop(name, None)
                            if spec is None:
                                violations.append(
                                    f"{os.path.relpath(path, _PROJECT)}:{idx}: "
                                    f"anti-fork-end '{name}' without matching begin"
                                )
                                continue
                            min_n, start, count = spec
                            blocks_seen += 1
                            if count < min_n:
                                violations.append(
                                    f"{os.path.relpath(path, _PROJECT)}:{start}-{idx}: "
                                    f"anti-fork '{name}' has {count} entries (declared min={min_n}); "
                                    f"if intentional, edit min= in same diff + log rationale"
                                )
                            continue
                        # Inside any open block: count if non-empty + not comment-only
                        for spec in open_blocks.values():
                            stripped = line.strip()
                            if not stripped:
                                continue
                            if stripped.startswith("#") or stripped.startswith("//"):
                                continue
                            spec[2] += 1
                    # Unclosed blocks at EOF
                    for name, (_min, start, _ct) in open_blocks.items():
                        violations.append(
                            f"{os.path.relpath(path, _PROJECT)}:{start}: "
                            f"anti-fork-begin '{name}' missing matching end"
                        )
        if not violations:
            if blocks_seen == 0:
                return _result(SKIP, 1.0,
                               "no anti-fork-marked lists found "
                               "(annotate conservative lists with # anti-fork-begin/-end)")
            return _result(PASS, 1.0,
                           f"{blocks_seen} anti-fork-marked list(s) at or above declared min")
        score = max(0.0, 1.0 - len(violations) * 0.25)
        return _result(FAIL, score,
                       f"{len(violations)} anti-fork violation(s)",
                       violations[:10])


class TestEnvUndefinedVerifier(Verifier):
    """In Node test files, `process.env.X = undefined` does NOT delete the
    var — it sets the literal string 'undefined' (truthy). Later tests
    inherit it and break || fallback patterns. The correct pattern when
    restoring an originally-unset env var is `delete process.env.X`.

    This verifier scans tools/HME/tests/ for the antipattern."""
    name = "test-env-undefined-antipattern"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RE = re.compile(r"process\.env\.[A-Z][A-Z0-9_]*\s*=\s*undefined\b")

    def run(self) -> VerdictResult:
        tests_dir = os.path.join(_PROJECT, "tools", "HME", "tests")
        if not os.path.isdir(tests_dir):
            return _result(SKIP, 1.0, "tests dir not present")
        violations = []
        scanned = 0
        for r, _d, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith((".js", ".mjs", ".cjs", ".ts")):
                    continue
                scanned += 1
                p = os.path.join(r, f)
                try:
                    with open(p, encoding="utf-8") as fp:
                        for i, line in enumerate(fp, start=1):
                            stripped = line.lstrip()
                            # Skip JS line comments and block-comment continuations
                            if stripped.startswith("//") or stripped.startswith("*"):
                                continue
                            if self._RE.search(line):
                                violations.append(
                                    f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                    f"process.env.X = undefined (use `delete process.env.X`)"
                                )
                except OSError:
                    continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} test file(s) scanned; no env-undefined antipattern")
        score = max(0.0, 1.0 - len(violations) * 0.1)
        return _result(FAIL, score,
                       f"{len(violations)} env-undefined antipattern(s)",
                       violations[:10])


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
                           + ("…" if len(code_only) > 20 else ""))
        if doc_only:
            score = max(0.0, 1.0 - len(doc_only) / 10.0)
            return _result(FAIL, score, f"{len(doc_only)} stale doc reference(s)", details)
        # code_only only: WARN, partial credit.
        score = max(0.5, 1.0 - len(code_only) / 20.0)
        return _result(WARN, score, f"{len(code_only)} undocumented event(s)", details)


class RepeatedCharSpamVerifier(Verifier):
    """No character may repeat 4+ times in a row in tracked text files —
    targets divider/box-decoration spam (runs of dashes, equals, hashes,
    pipes, tildes, unicode box-drawing). Word characters, whitespace, and
    paren/bracket/brace pairs are exempt so identifiers, indentation, and
    stacked code structure don't trip the rule. Per-line opt-out via the
    literal token `spam-ok`.

    Failing the verifier is intentional: the rule is meant to BLOCK these
    patterns. New violations should be removed — a markdown heading is
    `## Section`, not the same with a divider tail; a code separator is a
    single blank line, not a comment of repeated symbols."""
    name = "repeated-char-spam"
    category = "code"
    subtag = "regression-prevention"
    weight = 2.0

    def run(self) -> VerdictResult:
        violations = []
        for root, dirs, files in os.walk(_PROJECT):
            dirs[:] = [
                d for d in dirs
                if d not in _SPAM_SKIP_DIRS and not d.startswith(".")
            ]
            for f in files:
                if not f.endswith(_SPAM_EXTS):
                    continue
                abs_path = os.path.join(root, f)
                rel = os.path.relpath(abs_path, _PROJECT)
                if rel in _SPAM_SKIP_FILES:
                    continue
                try:
                    with open(abs_path, encoding="utf-8") as fp:
                        for i, line in enumerate(fp, 1):
                            if _SPAM_ALLOW in line:
                                continue
                            m = _SPAM_RE.search(line)
                            if m:
                                ch = m.group(1)
                                run_len = len(m.group(0))
                                violations.append(
                                    f"{rel}:{i}  {ch!r}×{run_len}"
                                )
                                if len(violations) >= 200:
                                    break
                except (UnicodeDecodeError, OSError):
                    pass
                if len(violations) >= 200:
                    break
            if len(violations) >= 200:
                break
        if not violations:
            return _result(PASS, 1.0, "no character-spam runs detected")
        # Linear penalty: 50 violations halves the score; 100 zeros it.
        score = max(0.0, 1.0 - len(violations) / 100.0)
        suffix = " (showing first 200)" if len(violations) >= 200 else ""
        return _result(
            FAIL, score,
            f"{len(violations)} character-spam run(s){suffix}",
            violations[:30],
        )


