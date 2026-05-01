"""Code-audit verifiers — extracted cluster. Imports re-export back to
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


# Runtime + test + syntax verifiers.

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




class TestIsolationVerifier(Verifier):
    """Tests that exercise `runStopChain`, `dispatchEvent`, or `shellPolicy`
    spawn bash hooks that write to log/hme-errors.log via fail-loud
    helpers. Without sandboxing PROJECT_ROOT to a tmp dir AND busting
    require.cache for proxy/+policies/, those writes pollute the real log
    and trip the next Stop hook's LIFESAVER as 'UNADDRESSED ERRORS FROM
    PREVIOUS TURN'.

    Detects: any test file under tools/HME/tests/ that imports/calls one
    of those three symbols MUST also reference a sandbox helper or
    pattern that overrides PROJECT_ROOT to a tmp path."""
    name = "test-isolation-stop-chain"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RISKY_RE = re.compile(r"\b(runStopChain|dispatchEvent|shellPolicy)\b")
    _SANDBOX_RE = re.compile(
        r"_withChainSandbox|_withSandbox|"
        r"PROJECT_ROOT\s*=\s*(?:os\.path\.join\([^)]*tmp|fs\.mkdtempSync|tmp_)"
    )

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
                        src = fp.read()
                except OSError:
                    continue
                if not self._RISKY_RE.search(src):
                    continue
                if self._SANDBOX_RE.search(src):
                    continue
                # Find first risky line for the report
                line_no = "?"
                for i, line in enumerate(src.splitlines(), start=1):
                    if self._RISKY_RE.search(line):
                        line_no = str(i)
                        break
                violations.append(
                    f"{os.path.relpath(p, _PROJECT)}:{line_no}: "
                    f"references runStopChain/dispatchEvent/shellPolicy without "
                    f"_withChainSandbox / _withSandbox / tmp PROJECT_ROOT"
                )
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} test file(s) scanned; all stop-chain tests sandbox PROJECT_ROOT")
        score = max(0.0, 1.0 - len(violations) * 0.25)
        return _result(FAIL, score,
                       f"{len(violations)} unsandboxed stop-chain test(s)",
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




class StalePathRenameVerifier(Verifier):
    """Catches stale references to renamed-but-still-cited paths across
    the entire repo. Surfaced after a `mcp/server → service/server`
    rename left 3 sites broken in scripts/ and hooks/ that no other
    verifier caught (silent ImportError → battery skipped → invariant
    history stale → only surfaced 5 days later via downstream FAIL).

    Path patterns that have been renamed live in
    project-rules.json under `stale_path_patterns`: each entry maps
    a pattern (regex) → reason. The verifier greps the whole repo
    for the pattern; any match in a non-comment, non-keyword-list
    context is a violation.

    Per-line opt-out: `# stale-path-ok: <reason>` on the line.
    Use only for keyword lists or historical refs."""
    name = "stale-path-rename"
    category = "code"
    subtag = "drift-detection"
    weight = 1.5

    def run(self) -> VerdictResult:
        rules_path = os.path.join(_PROJECT, "tools", "HME", "config",
                                  "project-rules.json")
        try:
            with open(rules_path) as f:
                patterns = json.load(f).get("stale_path_patterns", [])
        except Exception:
            patterns = []
        if not patterns:
            return _result(SKIP, 1.0, "no stale_path_patterns configured")

        compiled = []
        for entry in patterns:
            try:
                compiled.append((re.compile(entry["pattern"]), entry.get("reason", "")))
            except (re.error, KeyError):
                continue

        roots = [
            os.path.join(_PROJECT, "scripts"),
            os.path.join(_PROJECT, "tools", "HME"),
        ]
        skip_dirs = {"node_modules", "__pycache__", ".git", "output", "tmp", "log"}
        exts = (".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".ts")
        violations = []
        scanned = 0
        for root in roots:
            if not os.path.isdir(root):
                continue
            for r, dirs, files in os.walk(root):
                dirs[:] = [d for d in dirs if d not in skip_dirs
                           and d not in ("tests", "test", "specs")]
                for f in files:
                    if not f.endswith(exts):
                        continue
                    scanned += 1
                    p = os.path.join(r, f)
                    try:
                        with open(p, encoding="utf-8", errors="ignore") as fp:
                            for i, line in enumerate(fp, start=1):
                                if "stale-path-ok" in line:
                                    continue
                                stripped = line.lstrip()
                                if stripped.startswith(("#", "//", "*")):
                                    continue
                                for pat, reason in compiled:
                                    if pat.search(line):
                                        violations.append(
                                            f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                            f"{reason or 'stale path'}"
                                        )
                                        break
                    except OSError:
                        continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} file(s) scanned; no stale path references")
        score = max(0.0, 1.0 - len(violations) * 0.1)
        return _result(FAIL, score,
                       f"{len(violations)} stale path reference(s)",
                       violations[:10])


