"""Anti-fork heuristic verifier -- extracted from code_audits_style.py."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    ERROR,
    FAIL,
    METRICS_DIR,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _DOC_DIRS,
    _HOOKS_DIR,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _result,
    _run_subprocess,
    failed,
    passed,
    register,
    skipped,
)


@register
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
                    open_blocks = {}  # name -> (min, start_line, count)
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
                return skipped(summary="no anti-fork-marked lists found "
                               "(annotate conservative lists with # anti-fork-begin/-end)")
            return passed(summary=f"{blocks_seen} anti-fork-marked list(s) at or above declared min")
        score = max(0.0, 1.0 - len(violations) * 0.25)
        return failed(score=score, summary=f"{len(violations)} anti-fork violation(s)", details=violations[:10])




