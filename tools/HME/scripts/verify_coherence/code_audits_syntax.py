"""Syntax + undefined-var verifiers -- ShellUndefinedVars, PythonSyntax,
ShellSyntax, StalePathRename. Extracted from code_audits_runtime.py.
"""
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


class ShellUndefinedVarsVerifier(Verifier):
    """Delegates to scripts/audit_shell_undefined_vars.py, which statically
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
        script = os.path.join(_PROJECT, "scripts", "audit_shell_undefined_vars.py")
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
                    f"{fileinfo['file']}:{finding['line']} ${finding['var']} -- {finding['snippet'][:100]}"
                )
        if count == 0:
            return _result(PASS, 1.0, f"no undefined-variable references across {files_scanned} hook(s)")
        # Each undefined ref drops score by 0.25; floor at 0. Any violation
        # is FAIL -- even a single one can silently kill an entire hook chain.
        score = max(0.0, 1.0 - 0.25 * count)
        return _result(FAIL, score,
                       f"{count} undefined-variable reference(s) -- silent set-u crash risk",
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


# rationale: ban 4+ repeated decoration chars without false-positiving on code
_SPAM_RE = re.compile(r"([^\w\s()\[\]{}])\1{3,}")
# Per-line opt-out: line containing this token is exempt. Keep narrow so
# allowlisting requires conscious intent.
_SPAM_ALLOW = "spam-ok"
# Files/dirs exempt entirely (vendored libs, fixtures that DEFINE the
# patterns the sanitizer detects, model assets).
_SPAM_SKIP_DIRS = set()
try:
    import json as _json2
    _sf_cfg2 = os.path.join(_PROJECT, "tools", "HME", "config", "verifier-skip.json")
    with open(_sf_cfg2) as _sf2:
        _SPAM_SKIP_DIRS = set(_json2.load(_sf2).get("skip_dirs", []))
except Exception:  # silent-ok: config optional, hardcoded fallback
    _SPAM_SKIP_DIRS = {
        ".git", "node_modules", "output", "tmp", "log", "dist", "build",
        "__pycache__", ".venv", "venv", "lab", "plugin-cache", "models",
        "KB", ".pytest_cache", ".claude", "runtime",
    }
# merge HME_IGNORE_DIRS from .env (same mechanism as file_walker.py)
_env_raw = os.environ.get("HME_IGNORE_DIRS", "")
_env_dirs = {d.strip() for d in _env_raw.split(",") if d.strip()}
_SPAM_SKIP_DIRS |= _env_dirs
_SPAM_SKIP_FILES = set()
try:
    import json as _json
    _sf_cfg = os.path.join(_PROJECT, "tools", "HME", "config", "verifier-skip.json")
    with open(_sf_cfg) as _sf:
        _SPAM_SKIP_FILES = set(_json.load(_sf).get("skip_files", []))
except Exception:  # silent-ok: config optional, hardcoded fallback below
    _SPAM_SKIP_FILES = {
        "tools/HME/proxy/middleware/06_secret_sanitizer.js",
        "tools/HME/tests/specs/secret_sanitizer.test.js",
        "tools/HME/tests/specs/migrated_policies.test.js",
        "tools/HME/tests/specs/migrated_policies_round2.test.js",
        "tools/HME/tests/specs/metaprofile_next_level.test.js",
        "tools/HME/tests/specs/buddy_dispatcher.test.js",
        "tools/HME/tests/specs/rhythm_flair.test.js",
        "tools/csv_maestro/py_midicsv/midi_converters.py",
        "tools/HME/skills/ISA/TEMPLATE.md",
        "tools/HME/hooks/README.md",
        "tools/HME/service/server/tools_analysis/perceptual_inference.py",
        "tools/HME/service/server/tools_analysis/trust_analysis.py",
        "tools/HME/service/server/tools_analysis/status_unified/resource_reports.py",
    }
_SPAM_EXTS = (
    ".md", ".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".json",
    ".yaml", ".yml", ".ts", ".tsx", ".css", ".html", ".txt",
)




class StalePathRenameVerifier(Verifier):
    """Catches stale references to renamed-but-still-cited paths across
    the entire repo. Surfaced after a `mcp/server -> service/server`
    rename left 3 sites broken in scripts/ and hooks/ that no other
    verifier caught (silent ImportError -> battery skipped -> invariant
    history stale -> only surfaced 5 days later via downstream FAIL).

    Path patterns that have been renamed live in
    project-rules.json under `stale_path_patterns`: each entry maps
    a pattern (regex) -> reason. The verifier greps the whole repo
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


