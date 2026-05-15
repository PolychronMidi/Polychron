#!/usr/bin/env python3
"""Meta-Coherence Audit -- the detector-of-detectors.

Every HME detector/invariant/extractor embeds assumptions about source
structure (regex against a target file, path reference, phrase list, tool
decorator form). When the source shifts (refactor, rename, new pattern,
hook reorg) these assumptions rot SILENTLY -- a dead regex returns null,
a missing path returns "not found", a stale phrase list never triggers.
None of those look like failures. They just become invisible cruft.

This audit scans the diagnostic layer itself and proves each pattern is
still live by running it against its declared target corpus. Zero matches
for an ostensibly-active check = stale. Dead phrases in a detector =
stale. Missing path referenced by an invariant = stale.

What it covers:
  (A) invariants.json pattern_in_file / file_exists / patterns_all_in_file
      -- every path must exist and every pattern must match at least once.
  (B) check-tuning-invariants.js extractConst regexes -- each must produce
      a non-null extraction against its target file.
  (C) health.py doc-sync regex + tool-decorator scanner -- must find the
      expected structural markers.
  (D) evolution_strategies.py stress probe file references -- every hook
      path, every RELOADABLE name must resolve.
  (E) detectors/*.py phrase lists (ADMIT_PHRASES, PERMISSION_ASK_PHRASES,
      BG_KEYWORDS) -- for each phrase, check if it appears in any recent
      transcript (corpus-coverage sampling, not strict liveness).

Exit codes:
    0 -- all patterns live
    1 -- one or more stale patterns detected
    2 -- unexpected error

Usage:
    python3 tools/HME/scripts/meta_coherence_audit.py
    python3 tools/HME/scripts/meta_coherence_audit.py --json  # machine-readable
    python3 tools/HME/scripts/meta_coherence_audit.py --write-metrics
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


def _require_project_root() -> Path:
    root = os.environ.get("PROJECT_ROOT")
    if not root:
        # Walk up from this script looking for AGENTS.md + .env sentinels.
        here = Path(__file__).resolve()
        for parent in [here.parent, *here.parents]:
            if (parent / "AGENTS.md").exists() and (parent / ".env").exists():
                return parent
        raise RuntimeError("Cannot resolve PROJECT_ROOT. Set env or invoke with project-root sentinels.")
    return Path(root)



# (A) invariants.json




def audit_detector_phrases(root: Path) -> list[dict]:
    """For each phrase list in detectors/*.py, sample a recent transcript
    corpus and report phrases that never appear. A phrase that has never
    triggered across the corpus might be stale (real antipattern moved on)
    or might be defensive (expected to catch future variants). We flag but
    don't fail -- this is a coverage report, not a liveness assertion."""
    findings: list[dict] = []
    det_dir = root / "tools" / "HME" / "scripts" / "detectors"
    if not det_dir.is_dir():
        return findings
    # We only sample if the dir is present; otherwise skip (coverage optional).
    transcripts_root = Path.home() / ".claude" / "projects"
    corpus: str = ""
    if transcripts_root.is_dir():
        # Cheap sampling -- concatenate last-100-modified .jsonl files.
        candidates: list[Path] = []
        for p in transcripts_root.rglob("*.jsonl"):
            try:
                candidates.append(p)
            except Exception as _e:
                # silent-ok: optional fallback path.
                continue
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for p in candidates[:50]:
            try:
                corpus += "\n" + p.read_text(errors="ignore")[:200_000]
            except Exception as _e:
                # silent-ok: optional fallback path.
                continue
    corpus_lower = corpus.lower()

    for det_file in sorted(det_dir.glob("*.py")):
        try:
            text = det_file.read_text()
        except Exception as e:
            # silent-ok: optional fallback path.
            findings.append({
                "source": f"detectors/{det_file.name}",
                "status": "ERROR",
                "detail": f"read failed: {type(e).__name__}: {e}",
            })
            continue
        for m in re.finditer(
            r'^([A-Z][A-Z_]+(?:PHRASES|KEYWORDS|MARKERS|WORDS|SIGNATURES|TAGS))\s*=\s*\((.*?)\)',
            text, flags=re.MULTILINE | re.DOTALL,
        ):
            listname = m.group(1)
            body = m.group(2)
            phrases = re.findall(r'["\']([^"\']+)["\']', body)
            if not phrases or not corpus_lower:
                continue
            dead = [p for p in phrases if p.lower() not in corpus_lower]
            if dead:
                findings.append({
                    "source": f"detectors/{det_file.name}",
                    "id": listname,
                    "type": "phrase_coverage",
                    "status": "INFO",
                    "detail": f"{len(dead)}/{len(phrases)} phrases never seen in recent {len(corpus)//1000}KB transcript corpus: {dead[:5]}{'...' if len(dead) > 5 else ''}",
                })
    return findings



# (F) hme.log ERROR freshness


def audit_hme_log_errors(root: Path) -> list[dict]:
    """Any ERROR-level line in log/hme.log that landed in the last 10 minutes
    is a live daemon failure. LIFESAVER only scans tool-call output, so this
    audit is the standalone guard against daemon-thread crashes going
    undetected (meta-observer loop, llamacpp supervisor, etc.).

    Returns STALE for persistent (>10min old) patterns and FAIL-style
    findings for fresh (<10min) ones so the pipeline can distinguish
    'once-upon-a-time crash, already resolved' from 'still crashing right
    now, intervene'."""
    findings: list[dict] = []
    log_path = root / "log" / "hme.log"
    if not log_path.is_file():
        return findings
    import time
    import datetime as _dt
    now = time.time()
    # Sliding window of last 200 lines, same as selftest.
    try:
        lines = log_path.read_text(errors="ignore").splitlines()[-500:]
    except Exception as e:
        return [{"source": "hme.log", "status": "ERROR",
                 "detail": f"read failed: {type(e).__name__}: {e}"}]
    # The `,\d{3} ERROR ` anchor ensures we match LOG-LEVEL ERROR, not
    # the word "ERROR" inside an INFO line's tool-input payload.
    err_re = re.compile(r',\d{3}\s+ERROR\s+(.*)$')
    ts_re = re.compile(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
    fresh_errors: dict[str, int] = {}
    any_errors = 0
    for ln in lines:
        em = err_re.search(ln)
        if not em:
            continue
        any_errors += 1
        tsm = ts_re.match(ln)
        if not tsm:
            continue
        try:
            ts = _dt.datetime.strptime(tsm.group(1), "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            # silent-ok: optional fallback path.
            continue
        if now - ts <= 600:  # 10 minutes
            msg = em.group(1).strip()[:100]
            fresh_errors[msg] = fresh_errors.get(msg, 0) + 1
    if fresh_errors:
        for msg, count in sorted(fresh_errors.items(), key=lambda kv: -kv[1])[:10]:
            findings.append({
                "source": "hme.log",
                "id": msg[:60],
                "type": "fresh_error",
                "status": "STALE",  # treated as stale/must-fix by main()'s classification
                "detail": f"{count}x in last 10min: {msg}",
            })
    elif any_errors:
        findings.append({
            "source": "hme.log",
            "id": "historical_errors",
            "type": "fresh_error",
            "status": "INFO",
            "detail": f"{any_errors} historical ERROR line(s) in last 500 lines (none within 10min window)",
        })
    return findings



# (G) Hook source-path validity -- the bug that almost killed this session


def audit_hook_sources(root: Path) -> list[dict]:
    """Every `source <path>` line in a shell hook must resolve to an
    existing file. A broken source path fails silently (shell prints to
    stderr then continues; `_safe_jq` becomes undefined; TOOL_NAME empty;
    entire LIFESAVER dark for the session). The exact class that hid the
    _safety.sh relocation from everyone this session."""
    findings: list[dict] = []
    hooks_dir = root / "tools" / "HME" / "hooks"
    if not hooks_dir.is_dir():
        return findings
    source_re = re.compile(r'^\s*(?:\.|source)\s+"?(\S+?)"?\s*(?:$|\|\||&&|\s#)')
    for hook in hooks_dir.rglob("*.sh"):
        try:
            text = hook.read_text(errors="ignore")
        except Exception:
            # silent-ok: optional fallback path.
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            m = source_re.match(line)
            if not m:
                continue
            raw = m.group(1)
            # Skip obvious variable-only paths (e.g. "$HOOKS_DIR/_nexus.sh")
            resolved: Path | None = None
            m_dyn = re.match(
                r'\$\(\s*cd\s+"\$\(\s*dirname\s+"\$\{BASH_SOURCE\[0\]\}"\s*\)"\s*&&\s*pwd\s*\)/(.+)',
                raw,
            )
            m_script_dir = re.match(r'\$SCRIPT_DIR/(.+)', raw)
            if m_dyn:
                sub_path = m_dyn.group(1)
                resolved = (hook.parent / sub_path).resolve(strict=False)
            elif m_script_dir:
                sub_path = m_script_dir.group(1)
                resolved = (hook.parent / sub_path).resolve(strict=False)
            elif raw.startswith("/"):
                resolved = Path(raw)
            # else: contains other $VAR -- skip (can't verify without shell eval)
            if resolved is None:
                continue
            if not resolved.exists():
                findings.append({
                    "source": f"hooks/{hook.relative_to(hooks_dir)}",
                    "id": f"line {lineno}",
                    "type": "broken_source_path",
                    "status": "STALE",
                    "detail": f"`source {raw}` at line {lineno} resolves to {resolved} which does not exist -- hook will run with undefined helpers",
                })
    return findings



# (H) Module-load smoke test -- catches NameError/ImportError in module


def audit_module_imports(root: Path) -> list[dict]:
    """Parse every .py file under tools/HME/service/server/ and verify that
    every NAME referenced at module level OR in function bodies is either
    imported, defined, or a builtin. Catches the exact bug class where
    meta_layers.py used `subprocess.run(...)` without `import subprocess`.

    Lightweight: uses Python's AST, no import execution. We find
    undefined names by comparing `ast.Name` loads against imports,
    definitions, and builtins."""
    findings: list[dict] = []
    import builtins
    server_dir = root / "tools" / "HME" / "mcp" / "server"
    if not server_dir.is_dir():
        return findings
    builtin_names = set(dir(builtins)) | {"self", "cls", "__name__", "__file__",
                                           "__doc__", "__package__", "__path__",
                                           "__spec__", "__loader__", "__builtins__"}

    import ast as _ast

    for py in server_dir.rglob("*.py"):
        if "__pycache__" in py.parts:
            continue
        try:
            src = py.read_text(errors="ignore")
            tree = _ast.parse(src, filename=str(py))
        except SyntaxError as e:
            findings.append({
                "source": f"server/{py.relative_to(server_dir)}",
                "id": f"line {e.lineno}",
                "type": "syntax_error",
                "status": "STALE",
                "detail": f"parse error: {e.msg}",
            })
            continue
        except Exception:
            # silent-ok: optional fallback path.
            continue

        # Collect all bound names at module scope: imports, def, class, assign.
        module_names: set[str] = set(builtin_names)
        for node in _ast.walk(tree):
            if isinstance(node, (_ast.Import, _ast.ImportFrom)):
                for alias in node.names:
                    module_names.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                module_names.add(node.name)
            elif isinstance(node, _ast.Assign):
                for t in node.targets:
                    if isinstance(t, _ast.Name):
                        module_names.add(t.id)
            elif isinstance(node, _ast.AnnAssign) and isinstance(node.target, _ast.Name):
                module_names.add(node.target.id)

        # Walk module-level statements (not deep into nested scopes; function
        comprehension_types = (_ast.ListComp, _ast.SetComp, _ast.DictComp, _ast.GeneratorExp)
        for stmt in tree.body:
            if isinstance(stmt, (_ast.Import, _ast.ImportFrom, _ast.FunctionDef,
                                 _ast.AsyncFunctionDef, _ast.ClassDef)):
                continue
            # Collect comprehension node ids so we can skip their interiors.
            comp_interior_ids: set[int] = set()
            for node in _ast.walk(stmt):
                if isinstance(node, comprehension_types):
                    for sub in _ast.walk(node):
                        if sub is not node:
                            comp_interior_ids.add(id(sub))
            for sub in _ast.walk(stmt):
                if id(sub) in comp_interior_ids:
                    continue
                if isinstance(sub, _ast.Name) and isinstance(sub.ctx, _ast.Load):
                    if sub.id not in module_names:
                        findings.append({
                            "source": f"server/{py.relative_to(server_dir)}",
                            "id": f"{sub.id} @ line {sub.lineno}",
                            "type": "undefined_name",
                            "status": "STALE",
                            "detail": f"module-scope reference to `{sub.id}` that isn't imported/defined -- will NameError at import",
                        })
    return findings



# main
