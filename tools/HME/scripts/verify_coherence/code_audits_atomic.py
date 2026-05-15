"""Atomic state-writes verifier -- extracted from code_audits_state.py.
code_audits.py re-exports.
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
        # Shell pass: scan .sh for `cmd > "<state-path>"` redirects without
        # same-line atomic `mv`. Excludes pure truncate (`^>`), stderr (`2>`),
        # and append (`>>`). Quoted/unquoted paths matched via substring.
        truncate_only_re = re.compile(r'^\s*>')
        path_substr_re = re.compile(
            r'[A-Za-z_"}\)]\s*>\s*"?[^"\s]*?(?:output/metrics/[^"\s]*\.json|'
            r'tmp/hme-[^"\s]*\.(?:json|state)|'
            r'feedback_graph\.json|adaptive-state\.json)"?'
        )
        same_line_mv_re = re.compile(r'\bmv\s+\S+\s+\S+')
        # Files we explicitly skip (reserved for verifier-owned helpers).
        sh_skip = set()
        sh_roots = [
            os.path.join(_PROJECT, "tools", "HME", "hooks"),
            os.path.join(_PROJECT, "scripts"),
        ]
        for root in sh_roots:
            if not os.path.isdir(root):
                continue
            for r, _d, files in os.walk(root):
                for f in files:
                    if not f.endswith((".sh", ".bash")):
                        continue
                    p = os.path.join(r, f)
                    if p in sh_skip:
                        continue
                    try:
                        with open(p, encoding="utf-8") as fp:
                            for i, line in enumerate(fp, start=1):
                                if "atomic-ok" in line:
                                    continue
                                if truncate_only_re.match(line):
                                    continue  # pure `> path` truncation
                                if not path_substr_re.search(line):
                                    continue
                                # Allow if the same line also does an mv
                                # (atomic temp+rename pattern).
                                if same_line_mv_re.search(line):
                                    continue
                                violations.append(
                                    f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                    f"shell `> <state-path>` redirect without same-line "
                                    f"mv (write to .tmp + mv for atomicity; "
                                    f"per-line opt-out: append `# atomic-ok`)"
                                )
                    except OSError:
                        continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} Python file(s) + shell scripts scanned; "
                           f"no naked state-file writes")
        score = max(0.0, 1.0 - len(violations) * 0.2)
        return _result(FAIL, score,
                       f"{len(violations)} non-atomic state-file write(s)",
                       violations[:10])



