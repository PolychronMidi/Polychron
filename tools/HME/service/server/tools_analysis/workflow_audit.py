"""HME post-edit audit tools — what_did_i_forget and diagnose_error."""
import os
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
    KNOWN_L0_CHANNELS, DOC_UPDATE_TRIGGERS,
)
from symbols import find_callers as _find_callers
from .synthesis import _reasoning_think, _THINK_SYSTEM, _REVIEW_SYSTEM
from .synthesis_session import append_session_narrative
from .tool_cache import cached_kb_search, cached_find_callers
from . import _track

logger = logging.getLogger("HME")


def _drop_hallucinated_bullets(synthesis: str, changed_files: str,
                               diff_context: str, hunk_context: str,
                               symbol_whitelist: set | None = None) -> str:
    """Backward-compat thin wrapper around the shared
    filter_ungrounded_bullets helper in synthesis_inference. Joins the
    three per-section source strings into one blob and delegates.
    Prefer calling ground_synthesis() directly at new sites."""
    from .synthesis.synthesis_inference import filter_ungrounded_bullets
    source_text = "\n".join([
        changed_files or "", diff_context or "", hunk_context or ""
    ])
    return filter_ungrounded_bullets(
        synthesis, source_text,
        symbol_whitelist=symbol_whitelist,
        log_label="what_did_i_forget",
    )


def _scan_python_bug_patterns(rel_path: str, content: str) -> list[str]:
    """Heuristic scan for common Python bug patterns in HME server code.

    Checks for null-sentinel .get() traps, unguarded ValueError in OSError handlers,
    unbounded append-only file growth, `or` idioms that mask 0.0, and variable-before-
    assignment across guard boundaries.

    Self-exclusion: this scanner lives in workflow_audit.py and contains the
    patterns it looks for AS REGEX STRINGS. Scanning the scanner produces
    hits on those literals — not real bugs. Skip.
    """
    if rel_path.endswith("workflow_audit.py"):
        return []
    import re
    warnings = []

    # 1. dict.get(key, non-None-default) used in a context where a returned
    # None would cause a TypeError — i.e. arithmetic or comparison against a
    # number. Display-only .get (f-string interpolation, print, return-value
    # aggregation) is safe: None formats fine and doesn't raise.
    # Heuristic: look for `.get(...,N) + X` / `X - .get(...,N)` / comparisons.
    null_sentinel = re.findall(
        r'\.get\(["\'][^"\']+["\'],\s*(?:0|time\.\w+\(\)|[0-9]+\.?[0-9]*)\)'
        r'\s*(?:[-+*/<>=]|[-+]=|!=)',
        content
    )
    if null_sentinel:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(null_sentinel)} .get(key, default) call(s) in "
            "arithmetic/comparison context — silent fallback. "
            "If the key is always present, use `d[key]` (fail-fast). "
            "For legitimately-optional boundary inputs, use an explicit named "
            "check: `x = d.get(key); if x is None: x = default`. "
            "Do NOT swap to `.get(key) or X` — that's the same silent fallback."
        )

    # 2. int()/float() conversion inside a try block that only catches OSError-family.
    # ValueError from bad string conversion won't be caught.
    #
    # Implementation: walk every `try:` in the file, find its matching
    # `except` (the FIRST one at the same indent — NOT a later `except
    # (...)` that belongs to a different try block), check whether that
    # except is narrow and whether the try body does int()/float().
    # Previously a regex that required parenthesized excepts would skip
    # over bare `except Exception:` and match a `except (...)` from a
    # completely unrelated try block further down the file, conflating
    # their bodies and producing false positives.
    for try_match in re.finditer(r'^(\s*)try:\s*$', content, flags=re.MULTILINE):
        indent = try_match.group(1)
        start = try_match.end()
        # Find the FIRST except at exactly the same indent as the try:.
        # Matching any except-clause form — bare, `except Name`, `except
        # Name as e`, `except (A, B)`, `except (A, B) as e`. The regex
        # must reach the trailing colon so it cannot accidentally stop
        # partway through a clause like `except Exception as e:`.
        except_re = re.compile(
            rf'^{re.escape(indent)}except([^\n:]*):\s*$',
            flags=re.MULTILINE,
        )
        em = except_re.search(content, start)
        if em is None:
            continue
        try_body = content[start:em.start()]
        if not re.search(r'\bint\(|\bfloat\(', try_body):
            continue
        # exc_types = whatever is between `except` and `:`. Bare except
        # leaves it empty; `except Exception as e` yields "Exception as e"
        # (OSError/JSONDecodeError/ValueError/TypeError checks below still
        # work on substring matches).
        exc_types = em.group(1).strip()
        has_os = "OSError" in exc_types or "JSONDecodeError" in exc_types
        has_value_or_type = "ValueError" in exc_types or "TypeError" in exc_types
        if has_os and not has_value_or_type:
            warnings.append(
                f"[{rel_path}] PYTHON: `except {exc_types}` around int()/float() "
                "conversion — ValueError/TypeError not caught; "
                "malformed values will escape to the outer exception handler."
            )
            break  # one warning per file is enough

    # 3. Append-only file write without a corresponding trim/truncate.
    append_opens = re.findall(r'open\([^,)]+,\s*["\']a["\']\)', content)
    has_trim = bool(re.search(r'_trim_\w+|\.writelines\(.*\[truncate\(', content))
    if append_opens and not has_trim:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(append_opens)} append-only write(s) with no trim — "
            "file will grow without bound over time."
        )

    # 4. `.get(...) or X` idiom that masks legitimate zero/False values.
    zero_or = re.findall(r'\.get\([^)]+\)\s+or\s+(?:[0-9]+\.?[0-9]*|time\.\w+\(\))', content)
    if zero_or:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(zero_or)} `.get() or X` — silent fallback. "
            "Returns fallback for 0, 0.0, and '' too, not just None. "
            "If the key is always present, use `d[key]` (fail-fast). "
            "For legitimately-optional boundary inputs, use an explicit named "
            "check: `x = d.get(key); if x is None: x = default`. "
            "Do NOT swap to `.get(key, X)` — that's the same silent fallback."
        )

    # 5. Bare variable reference that might be used outside the `if` guard defining it.
    # Heuristic: variable assigned only inside `if len(...) >= N:` and referenced outside.
    guarded = re.findall(r'if\s+len\([^)]+\)\s*>=\s*(\d+):[^\n]*\n(?:[ \t]+[^\n]+\n)*[ \t]+(\w+)\s*=', content)
    for _threshold, var in guarded:
        # Check if var appears after the block (simplified: appears more than once in file)
        if content.count(f"\n    {var}") + content.count(f"\n        {var}") > 1:
            warnings.append(
                f"[{rel_path}] PYTHON: `{var}` assigned inside `if len() >= N` guard "
                "— verify it's not referenced where the guard is False (NameError risk)."
            )

    # 6. time.time() - d.get(...) or reverse: arithmetic on potentially-None value.
    # If the key is absent or stored as None, the subtraction raises TypeError.
    none_arith = re.findall(
        r'time\.(?:time|monotonic)\(\)\s*[-+]\s*\w+\.get\('
        r'|\w+\.get\([^)]+\)\s*[-+]\s*time\.(?:time|monotonic)\(\)',
        content
    )
    if none_arith:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(none_arith)} `time.time() ± d.get(...)` — "
            "if key is absent or None, arithmetic raises TypeError. "
            "Guard with `if d.get(key) is not None` or `(d.get(key) or 0.0)`."
        )

    # 7. except Exception: pass or bare except: pass — silent catch-all.
    # These swallow all errors without logging, making bugs invisible in production.
    silent_except = re.findall(r'except\s+(?:Exception\s*)?:\s*pass\b', content)
    if silent_except:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(silent_except)} silent `except ... pass` — "
            "swallows all errors. At minimum log the exception; "
            "narrow the type or re-raise if possible."
        )

    # 8. Attribute access directly on .get() result without a None guard.
    # Pattern: d.get('key').something — raises AttributeError when key absent or value is None.
    none_attr = re.findall(r'\.get\(["\'][^"\']+["\']\)\.[a-zA-Z_]', content)
    if none_attr:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(none_attr)} `.get(...).attribute` without None guard — "
            "absent/None key raises AttributeError. Use `x = d.get(key); "
            "if x is None: ...` or ensure the key is guaranteed and use `d[key].attr`."
        )

    # 8b. Dispatcher-bypass: direct use of the `_shared_*` RAG model globals
    # from call positions (`_shared_model.encode(...)`, etc.) is a load-bearing
    # anti-pattern — it bypasses the VramManager + _RagDispatcher, holds a
    # strong GPU reference that blocks offload, and ignores the daemon's
    # per-GPU busy flag. Callers must go through the dispatcher (either
    # `engine.text_model` / `engine.code_model` / `engine.reranker`, or the
    # `_text_model_router` / `_code_model_router` / `_reranker_router` locals
    # in hme_http.py). The module-level definitions of the dispatchers
    # themselves reference `_shared_*` — that's the one legitimate site and
    # it gets excluded by the regex below.
    _bypass_pattern = re.compile(
        r'(?<!_)_shared_(?:model|code_model|reranker)(?:_cpu)?'
        r'\s*\.\s*(?:encode|predict|get_sentence_embedding_dimension|__call__)\b'
    )
    _bypass = _bypass_pattern.findall(content)
    if _bypass:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(_bypass)} direct `_shared_*.encode/"
            "predict/…` call(s) — bypasses _RagDispatcher + VramManager. "
            "Route through `engine.text_model` / `engine.code_model` / "
            "`engine.reranker` (or the `_*_router` locals in hme_http.py "
            "construction). Direct use blocks active-offload and ignores "
            "the daemon per-GPU busy flag."
        )

    # 9. Operator-swap evasion of the silent-fallback rule.
    # Detect: the same `.get("k", N)` → `.get("k") or N` (or the reverse)
    # flipped in an uncommitted change. Swapping the operator does NOT
    # address "no silent fallback" — it's the same pattern in a different
    # shape. Runs via `git diff HEAD -- <file>`, so it only fires when the
    # evasion is in the current uncommitted delta.
    try:
        import subprocess as _sp
        _diff = _sp.run(
            ["git", "diff", "HEAD", "--", rel_path],
            cwd=ctx.PROJECT_ROOT, capture_output=True, text=True, timeout=3,
        ).stdout
    except Exception as _e:
        logger.debug(f"git diff probe for {rel_path}: {type(_e).__name__}: {_e}")
        _diff = ""
    if _diff:
        _rm_comma = re.findall(
            r'^-[^\n]*\.get\((["\'][^"\']+["\']),\s*([^)]+)\)',
            _diff, re.M,
        )
        _add_or = re.findall(
            r'^\+[^\n]*\.get\((["\'][^"\']+["\'])\)\s+or\s+(\S+)',
            _diff, re.M,
        )
        _rm_or = re.findall(
            r'^-[^\n]*\.get\((["\'][^"\']+["\'])\)\s+or\s+(\S+)',
            _diff, re.M,
        )
        _add_comma = re.findall(
            r'^\+[^\n]*\.get\((["\'][^"\']+["\']),\s*([^)]+)\)',
            _diff, re.M,
        )
        _swap_hits = []
        for (rk, _) in _rm_comma:
            for (ak, _) in _add_or:
                if rk == ak:
                    _swap_hits.append(rk)
                    break
        for (rk, _) in _rm_or:
            for (ak, _) in _add_comma:
                if rk == ak:
                    _swap_hits.append(rk)
                    break
        if _swap_hits:
            warnings.append(
                f"[{rel_path}] PYTHON: {len(_swap_hits)} operator-swap evasion(s) "
                f"on key(s) {sorted(set(_swap_hits))} — "
                "`.get(key, X)` and `.get(key) or X` are the SAME silent fallback "
                "in different shapes. Swapping the operator to dodge one rule while "
                "tripping the other is rule-gaming, not fixing. "
                "Use `d[key]` to fail-fast, or `x = d.get(key); if x is None: ...` "
                "for legitimately-optional boundary inputs."
            )

    return warnings


def what_did_i_forget(changed_files: str) -> str:
    """Call AFTER implementing changes, BEFORE running pipeline. Takes comma-separated file paths. Checks changed files against KB for missed constraints, boundary violations, and doc update needs. Output scales with remaining context window."""
    ctx.ensure_ready_sync()
    _track("what_did_i_forget")
    append_session_narrative("audit", f"review {len(files)} files: {changed_files[:60]}" if (files := [f.strip() for f in changed_files.split(",") if f.strip()]) else "review (no files)")
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    if not files:
        # Auto-fallback: when working tree is clean (typically because
        # autocommit just landed everything), scan the LAST commit's
        # diff instead of bailing with "pass paths explicitly". Most
        # users running `i/review` after a session of work want to
        # review what just got committed, not have to dig out the file
        # list manually.
        try:
            import subprocess
            from server.context import PROJECT_ROOT as _PR
            r = subprocess.run(
                ["git", "-C", _PR, "diff", "--name-only", "HEAD~1", "HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0 and r.stdout.strip():
                files = [f.strip() for f in r.stdout.strip().split("\n") if f.strip()]
        except Exception as _e:
            files = []
        if not files:
            return "No changed files detected (working tree clean AND last commit empty). Pass changed_files='path1,path2' explicitly to review specific files."
        # Fall through with the auto-derived files list.
    parts = [f"# Post-Change Audit (context: {budget})\n"]
    all_warnings = []
    doc_updates_needed = set()
    # Per-review dedup set for scaffolding reminders (HOOK CHANGE, DOC
    # CHECK). Seeing the same reminder repeated N times for N edits of
    # the same file in one session adds noise without new signal — once
    # the operator has acknowledged "hook changed, check siblings",
    # the second and third repeats are friction.
    _emitted_scaffold = set()
    for file_path in files:
        abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
        if abs_path is None:
            all_warnings.append(f"[{file_path}] SKIPPED: outside project root")
            continue
        rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
        module_name = (os.path.basename(abs_path)
                       .replace(".js", "").replace(".ts", "").replace(".sh", "").replace(".py", ""))
        # Hook files: KB search won't find relevant entries by filename — emit structural reminders instead.
        # Dedup HOOK CHANGE and DOC CHECK — repeat edits to the same hook in
        # one session produce identical reminders, which pile up in the
        # review output for no signal. `_emitted_scaffold` tracks which
        # (prefix, rel_path) pairs have already fired this run.
        if rel_path.endswith(".sh") and "/hooks/" in rel_path:
            _scaffold_key = ("HOOK CHANGE", rel_path)
            if _scaffold_key not in _emitted_scaffold:
                _emitted_scaffold.add(_scaffold_key)
                all_warnings.append(
                    f"[{rel_path}] HOOK CHANGE: check other hooks in tools/HME/hooks/ for the same issue, "
                    "and verify tools/HME/hooks/hooks.json still references this hook correctly."
                )
            if "sessionstart" in rel_path or "pretooluse" in rel_path or "posttooluse" in rel_path:
                _doc_key = ("DOC CHECK", rel_path)
                if _doc_key not in _emitted_scaffold:
                    _emitted_scaffold.add(_doc_key)
                    all_warnings.append(
                        f"[{rel_path}] DOC CHECK: update doc/HME.md hook descriptions if behavior changed."
                    )
        elif rel_path.startswith(("tools/", "scripts/", "lab/")):
            # KB constraints are for the composition system (src/). Tooling files (chat
            # plugin, MCP server, scripts) have different semantics and produce spurious
            # matches against src/ architecture entries (e.g. "router" → "gateway").
            pass
        else:
            # Check KB for constraints on this module — split actionable vs historical
            kb_results = cached_kb_search(module_name, min(limits["kb_entries"], 5), ctx.project_engine)
            _CONSTRAINT_MARKERS = ("never", "must", "always", "do not", "don't", "forbidden", "violation", "constraint:", "ban", "prevent")
            for k in kb_results[:3]:
                body = k.get("content", "").lower()
                if any(m in body for m in _CONSTRAINT_MARKERS):
                    all_warnings.append(f"[{rel_path}] KB: [{k['category']}] {k['title']}")
        # Check if crossLayer file touches conductor
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
            if "/crossLayer/" in rel_path:
                for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                    if dr in content and "conductorSignalBridge" not in content:
                        all_warnings.append(f"[{rel_path}] BOUNDARY: uses {dr} directly")
            # Check if new L0 channel was added (JS files only)
            if rel_path.endswith(".js") and "L0.post('" in content:
                import re
                channels = set(re.findall(r"L0\.post\('([^']+)'", content))
                for ch in channels:
                    if ch not in KNOWN_L0_CHANNELS:
                        all_warnings.append(f"[{rel_path}] NEW L0 CHANNEL: '{ch}' -- add to project-rules.json and narrative-digest/trace-summary consumers")
            # Check rhythm coupling: L0.getLast('emergentRhythm') added but ARCHITECTURE.md consumer comment missing
            if rel_path.endswith(".js") and "L0.getLast('emergentRhythm'" in content:
                import re as _re
                has_arch_comment = bool(_re.search(r'//\s*R\d+.*rhyth', content, _re.IGNORECASE))
                if not has_arch_comment:
                    all_warnings.append(f"[{rel_path}] RHYTHM COUPLING: L0.getLast('emergentRhythm') present — add R-comment and update ARCHITECTURE.md emergentRhythm consumers list")
                # Check known rhythm field usage
                used_fields = set(_re.findall(r'(?:rhythmEntry|emergentEntry)\w*\.(\w+)', content))
                _KNOWN_FIELDS = {"density", "complexity", "biasStrength", "densitySurprise", "hotspots", "complexityEma"}
                unknown = used_fields - _KNOWN_FIELDS
                if unknown:
                    all_warnings.append(f"[{rel_path}] UNKNOWN RHYTHM FIELDS: {unknown} — add to _KNOWN_RHYTHM_FIELDS in coupling.py")
            # Check HME Python tool registration (tools/HME/ .py files with @ctx.mcp.tool())
            if "/tools/HME/" in rel_path and rel_path.endswith(".py"):
                import re as _re2
                tool_funcs = _re2.findall(r'@ctx\.mcp\.tool\(\)\s+def\s+(\w+)', content)
                if tool_funcs:
                    init_path = os.path.join(os.path.dirname(abs_path), "__init__.py")
                    if os.path.isfile(init_path):
                        try:
                            with open(init_path, encoding="utf-8") as _init_f:
                                init_content = _init_f.read()
                            module_stem = os.path.basename(abs_path).replace(".py", "")
                            if module_stem not in init_content:
                                all_warnings.append(
                                    f"[{rel_path}] HME TOOL REGISTRATION: '{module_stem}' not imported in "
                                    f"__init__.py — tools {tool_funcs} will be invisible to MCP"
                                )
                        except Exception as _err1:
                            logger.debug(f'silent-except workflow_audit.py:212: {type(_err1).__name__}: {_err1}')
        except Exception as _err2:
            logger.debug(f'silent-except workflow_audit.py:214: {type(_err2).__name__}: {_err2}')
        # Track doc update needs (path triggers from project-rules.json)
        for path_prefix, docs in DOC_UPDATE_TRIGGERS.items():
            if path_prefix in rel_path:
                for d in docs:
                    doc_updates_needed.add(d)

    # Python-specific static bug pattern scan (HME server + all .py files).
    # MUST run BEFORE the Warnings display section below, otherwise warnings
    # added here get counted in total_issues but never rendered to the user,
    # causing the nexus REVIEW_ISSUES count to get stuck with invisible
    # failures. (Historical bug — the scan used to run after the display.)
    py_files = [f.strip() for f in changed_files.split(",") if f.strip().endswith(".py")]
    for py_path in py_files:
        abs_py = validate_project_path(py_path, ctx.PROJECT_ROOT)
        if abs_py is None:
            continue
        rel_py = abs_py.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
        try:
            with open(abs_py, encoding="utf-8", errors="ignore") as _pyf:
                py_content = _pyf.read()
            all_warnings.extend(_scan_python_bug_patterns(rel_py, py_content))
        except OSError as _audit_err:
            # Can't read a Python file we intended to audit = silent
            # coverage gap. Surface so the audit report calls it out
            # instead of quietly dropping the file.
            logger.warning(f"audit skip {rel_py} (read failed): {type(_audit_err).__name__}: {_audit_err}")
            all_warnings.append(f"{rel_py}: audit skipped — file unreadable ({type(_audit_err).__name__})")

    if all_warnings:
        parts.append(f"## Warnings ({len(all_warnings)})")
        for w in all_warnings:
            parts.append(f"  - {w}")
    else:
        parts.append("## Warnings: none found")
    if doc_updates_needed:
        parts.append(f"\n## Docs to Update")
        for d in sorted(doc_updates_needed):
            parts.append(f"  - {d}")
    parts.append(f"\n## Reminders")
    parts.append("  - hme_admin(action='index') after batch changes (file watcher handles individual saves)")
    parts.append("  - add_knowledge for any new calibration anchors or decisions")

    # Collect git diff for synthesis context (bounded to 4000 chars).
    # This project runs a direct-autocommit hook that commits edits before the
    # review fires, so `git diff HEAD` is often empty. When that happens, fall
    # back to `HEAD~1..HEAD` so the reviewer has the just-committed diff to
    # ground its adaptive synthesis against — otherwise the LLM has no source
    # material and confabulates phantom files.
    diff_context = ""
    try:
        import subprocess as _sp_diff
        _diff_result = _sp_diff.run(
            ["git", "-C", ctx.PROJECT_ROOT, "diff", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
        diff_context = _diff_result.stdout[:4000]
        if not diff_context.strip():
            _diff_prev = _sp_diff.run(
                ["git", "-C", ctx.PROJECT_ROOT, "diff", "HEAD~1..HEAD"],
                capture_output=True, text=True, timeout=3,
            )
            diff_context = _diff_prev.stdout[:4000]
    except Exception as _err3:
        logger.debug(f'silent-except workflow_audit.py:259: {type(_err3).__name__}: {_err3}')

    # Parse diff for ±20-line hunk context in changed .py files (up to 1000 chars total).
    # Skipped when diff is already large (>2000 chars) to keep synthesis prompt within
    # the local model's comfortable context range and avoid 10+ minute hangs.
    hunk_context = ""
    if diff_context and len(diff_context) < 2000:
        try:
            import re as _re_hunk
            file_hunk_map: dict = {}  # rel_path -> [(hunk_start, hunk_end)]
            current_hunk_file = None
            for _dl in diff_context.splitlines():
                _fm = _re_hunk.match(r'^\+\+\+ b/(.+\.py)', _dl)
                if _fm:
                    current_hunk_file = _fm.group(1)
                    if current_hunk_file not in file_hunk_map:
                        file_hunk_map[current_hunk_file] = []
                elif current_hunk_file:
                    _hm = _re_hunk.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', _dl)
                    if _hm:
                        _hstart = int(_hm.group(1))
                        _hcount = int(_hm.group(2)) if _hm.group(2) else 1
                        file_hunk_map[current_hunk_file].append((_hstart, _hstart + _hcount - 1))
            hunk_parts = []
            total_hunk_chars = 0
            for _rel_file, _hunks in list(file_hunk_map.items())[:2]:
                _abs_file = os.path.join(ctx.PROJECT_ROOT, _rel_file)
                if not os.path.isfile(_abs_file):
                    continue
                try:
                    with open(_abs_file, encoding="utf-8", errors="ignore") as _hf:
                        _flines = _hf.read().splitlines()
                    for _hs, _he in _hunks[:1]:
                        _cs = max(0, _hs - 11)
                        _ce = min(len(_flines), _he + 10)
                        _snip = "\n".join(
                            f"{i + 1}: {line}" for i, line in enumerate(_flines[_cs:_ce], _cs)
                        )
                        hunk_parts.append(f"## {_rel_file} lines {_cs+1}-{_ce}:\n```python\n{_snip}\n```")
                        total_hunk_chars += len(_snip)
                        if total_hunk_chars >= 1000:
                            break
                    if total_hunk_chars >= 1000:
                        break
                except (OSError, ValueError):  # silent-ok: hunk-size counter; early break on unreadable hunk continues with next file
                    pass
            if hunk_parts:
                hunk_context = "\nChanged file context (±10 lines around diff hunks):\n" + "\n\n".join(hunk_parts)
        except Exception as _err4:
            logger.debug(f'silent-except workflow_audit.py:308: {type(_err4).__name__}: {_err4}')

    # Bug-probe classes. Each class is one line; language-specific idiom
    # hints are appended only if the diff actually touches that language.
    # Prior iteration shipped py/js/sh examples for every class regardless
    # of the diff's language, bloating the prompt with ~30 irrelevant lines
    # on single-language reviews.
    _PROBE_CLASSES = [
        ("Empty-value masquerading as default",
         {"py": "dict.get(k, D) returns None when k present-but-None — prefer (d.get(k) or D)",
          "js": "obj[k] ?? D vs obj[k] || D — || treats 0/'' as falsy",
          "sh": "${VAR:-D} fires on unset AND empty; ${VAR-D} fires only on unset"}),
        ("Exception / error handling gaps — narrow except/catch/trap that silently drops unnamed types, or missing error paths for parse/subprocess/IO/HTTP", {}),
        ("Append-only growth — writes to a log/jsonl/history without a size or age cap", {}),
        ("Truthy/falsy coercion after a lookup — `x or fallback` where 0/''/False/[] could legitimately match", {}),
        ("Path/filesystem assumptions — assumes a path is a file when it could be dir/symlink/missing, or assumes a particular cwd", {}),
        ("Variable used before assignment — set inside a conditional branch and read where that branch may not fire", {}),
        ("Key mismatch across reads/writes — dedup/lookup key constructed one way on insert and another on retrieval", {}),
        ("Null-guarded arithmetic / comparison — arithmetic on possibly-None/undefined, or implicit-coercion comparison", {}),
        ("Race on shared state — read-modify-write without serialization, or async captures mutated across awaits", {}),
        ("Control-flow swallowing —",
         {"py": "try/except-pass that hides failures",
          "js": "uncaught promise rejections",
          "sh": "`set -e` + `||`/`&&` chains that mask failing commands"}),
    ]

    def _detect_languages(diff: str, files: str) -> set:
        # Parse language from file headers in the diff (+++ b/path.ext)
        # and the changed_files list, not substring scans over the whole
        # diff body — a prose mention of `.py` inside a docstring was
        # falsely marking Python as present.
        import re as _re_lang
        langs = set()
        ext_lang = {'.py': 'py', '.js': 'js', '.ts': 'js', '.jsx': 'js',
                    '.tsx': 'js', '.mjs': 'js', '.cjs': 'js',
                    '.sh': 'sh', '.bash': 'sh'}
        for src in (diff or '', files or ''):
            # `+++ b/file.ext` or bare `file.ext` in the comma-separated list
            for path in _re_lang.findall(r'(?:^\+\+\+ b/)?([\w./-]+\.\w+)',
                                         src, _re_lang.MULTILINE):
                for ext, lang in ext_lang.items():
                    if path.endswith(ext):
                        langs.add(lang)
        return langs  # empty set → probes render without lang-hint blocks

    _diff_langs = _detect_languages(diff_context, changed_files)

    def _render_probes() -> str:
        # Peer-review (iter 109) caught that lettering the lenses + adding
        # "in priority order" + "Strongest tier-1 signal" superlatives
        # reconstituted the exact checklist shape the comment was trying
        # to dissolve. Reviewers felt obligated to open/close each lens
        # even when only one applied. Collapsed to one inline sentence
        # naming the lens kinds WITHOUT ordering or gates; categories
        # below continue as vocabulary. Principle: vocabulary describes,
        # gates enumerate — keep them distinct.
        lines = [
            "A tier-1 finding is a quote+divergence pair. The divergence is "
            "typically one of: a promise the docstring/name makes that the "
            "code doesn't deliver; a caller-contract the change breaks; or "
            "a silent fallback that swallows a load-bearing signal. If you "
            "find no quote+divergence pair, say 'no tier-1 issues' — that "
            "is the calibrated answer. Do NOT invent one to match the "
            "categories below; they are descriptive grammar.",
            "",
            "Categories (vocabulary for describing a real divergence):",
        ]
        for i, (desc, lang_hints) in enumerate(_PROBE_CLASSES, 1):
            lines.append(f"  {i}. {desc}")
            for lang in ('py', 'js', 'sh'):
                if lang in lang_hints and lang in _diff_langs:
                    lines.append(f"     [{lang}] {lang_hints[lang]}")
        return "\n".join(lines) + "\n"

    probes = _render_probes()
    warnings_text = "\n".join(all_warnings[:20]) if all_warnings else "none"
    docs_text = ", ".join(sorted(doc_updates_needed)) if doc_updates_needed else "none flagged"

    # Diff is never embedded in the reasoning prompt — it's redundant
    # with hunk_section (±10 surrounding lines with line numbers,
    # strictly more useful for bug reasoning). The diff remains
    # available server-side for symbol extraction / identifier
    # whitelist construction, and the reasoning model can always run
    # `git diff` or `git show` itself if it wants the full diff.
    # Previously sent the first 4000 (or 800) chars of raw diff; across
    # many review rounds that accumulated as noise in the persistent
    # subagent thread and added no signal over hunks.
    diff_section = ""
    hunk_section = hunk_context if hunk_context else ""
    synthesis = None
    _synthesis_timed_out = False
    if not diff_context:
        # Nothing concrete to probe against — refuse to synthesize. Prior
        # behavior asked the model to speculate without evidence, which is
        # where hallucinations came from.
        logger.info("what_did_i_forget: empty diff context; skipping adaptive synthesis")
    else:
        # Pre-synthesis: have the arbiter extract the set of identifiers
        # that ACTUALLY appear in the diff. Pass this whitelist into the
        # reasoning prompt as a grounding constraint, and into the
        # post-synthesis filter as an authoritative check. Solves the
        # "reasoning model correctly cites a file but invents the symbols
        # inside it" hallucination class that a path-citation filter alone
        # can't catch (e.g. claimed `pathlib.Path.glob()` in a file that
        # uses os.walk, called `output_tokens` an environment variable).
        symbol_whitelist: set = set()
        try:
            from .synthesis.synthesis_inference import extract_diff_symbols
            symbol_whitelist = extract_diff_symbols(
                diff_context, hunk_context, changed_files
            )
        except Exception as _xs:
            logger.debug(f"what_did_i_forget: symbol extraction skipped: "
                         f"{type(_xs).__name__}: {_xs}")

        # Render whitelist for the prompt. Cap at ~120 tokens so the
        # reasoning model's context stays bounded; the full set still
        # drives the post-filter.
        if symbol_whitelist:
            _ws = sorted(symbol_whitelist)[:120]
            allowed_block = (
                "\nAllowed symbols (backticked identifiers in your output "
                "must come from this list; others are dropped by post-filter):\n"
                + ", ".join(_ws) + "\n"
            )
            _symbols_rule = " Backticked identifiers must come from the Allowed-symbols list."
        else:
            allowed_block = ""
            _symbols_rule = ""

        user_text = (
            f"Changed files: {changed_files}\n"
            f"Static audit warnings already found: {warnings_text}\n"
            f"Docs flagged: {docs_text}\n"
            f"{diff_section}"
            f"{hunk_section}\n"
            f"{allowed_block}"
            f"{probes}"
            "OUTPUT FORMAT — for each tier-1 issue:\n"
            "  • Quote the offending line(s) verbatim from the hunks above (or `git diff`).\n"
            "  • State the divergence: what the surroundings imply vs what the line does.\n"
            "  • Cite file:line.\n"
            f"{_symbols_rule.strip() or ''}\n"
            "Say 'no tier-1 issues' ONLY if no line in scope admits a quote "
            "+ specific-divergence pair. Not because you're uncertain — "
            "uncertainty about whether a quoted divergence is a 'real bug' "
            "is what the human reviewer resolves. Your job is to surface "
            "quote+divergence pairs you can actually construct. Do NOT "
            "invent a tier-1 to fill space.\n"
        )
        try:
            result = _reasoning_think("/no_think\n" + user_text, max_tokens=400,
                                      system=_REVIEW_SYSTEM)
            if result:
                from .synthesis.synthesis_inference import compress_for_claude
                synthesis = compress_for_claude(result, max_chars=1200, hint="post-change audit missed bugs")
                synthesis = _drop_hallucinated_bullets(
                    synthesis, changed_files, diff_context, hunk_context,
                    symbol_whitelist=symbol_whitelist,
                )
            elif result is None:
                _synthesis_timed_out = True
        except Exception as _e:
            logger.warning(f"what_did_i_forget: synthesis error: {_e}")
            _synthesis_timed_out = True

    if synthesis:
        parts.append(f"\n## What You May Have Missed *(adaptive)*")
        parts.append(synthesis)
        # Informational scaffolding prompts (HOOK CHANGE, DOC CHECK, SKIPPED, KB)
        # are prompts-to-consider, not code defects. They shouldn't inflate the
        # issue count that NEXUS uses as a stop-gate. Only count actionable
        # warnings (PYTHON bug patterns, BOUNDARY violations, NEW L0 CHANNEL,
        # RHYTHM COUPLING, UNKNOWN RHYTHM FIELDS, etc.) plus adaptive synthesis
        # bullets.
        # "audit skipped" is added because file-move/rename in a session
        # leaves the static-audit referencing paths that no longer exist
        # at audit time (resolved on next commit). Those warnings are
        # transient and not actionable — same scaffolding-class as the
        # existing prefixes.
        _scaffold_prefixes = ("] HOOK CHANGE:", "] DOC CHECK:", "] SKIPPED:", "] KB:",
                              "audit skipped —", "audit skipped:")
        _actionable = [w for w in all_warnings if not any(p in w for p in _scaffold_prefixes)]
        total_issues = len(_actionable) + synthesis.count("\n- ") + synthesis.count("\n* ")
        if total_issues >= 4:
            parts.append(
                f"\n_Found {total_issues} issues total — run `review(mode='forget')` again after fixing "
                "to surface any remaining bugs (iterate until 0 remaining)._"
            )
    else:
        if _synthesis_timed_out:
            from server.failure_genealogy import record_failure
            _fid, _is_new = record_failure(
                source="review(mode='forget')",
                error="synthesis timed out — coder model unavailable or GPU busy; adaptive 'What You May Have Missed' section skipped",
                severity="WARN",
            )
            if _is_new:
                logger.warning("what_did_i_forget: synthesis timed out — LIFESAVER recorded")
            parts.append("\n## What You May Have Missed *(adaptive)*\nSkipped — coder model timed out (GPU busy or service down).")
        else:
            logger.warning("what_did_i_forget: adaptive synthesis unavailable (timeout or llama.cpp down)")

    # Auto-draft: suggest a learn() call if warnings found KB-worthy patterns
    if all_warnings:
        _file_list = ", ".join(os.path.basename(f.strip()) for f in changed_files.split(",")[:3])
        parts.append(f"\n## Quick KB Draft")
        parts.append(f"  If these changes are confirmed, save with:")
        parts.append(f"  learn(title='...describe the change...', content='...why and what changed in {_file_list}...', category='decision')")

    return "\n".join(parts)


def diagnose_error(error_text: str) -> str:
    """Paste a pipeline error. Returns: likely source file, relevant KB entries, similar past bugs, and fix patterns."""
    ctx.ensure_ready_sync()
    if not error_text or not error_text.strip():
        return "Error: error_text cannot be empty. Paste the error message or stack trace."
    parts = ["# Error Diagnosis\n"]
    # Extract symbol/file references from error text
    import re
    file_refs = re.findall(r'((?:[\w./-]+/)+[\w.\-]+\.(?:js|ts|py)):?(\d+)?', error_text)
    # Filter symbols: require camelCase (uppercase after lowercase) to avoid common English words
    symbol_refs = re.findall(r'\b([a-z]+[A-Z][a-zA-Z]{3,})\b', error_text)
    error_type = re.search(r'(TypeError|ReferenceError|Error|RangeError):\s*(.+?)(?:\n|$)', error_text)
    if error_type:
        parts.append(f"## Error: {error_type.group(1)}: {error_type.group(2)[:100]}")
    if file_refs:
        parts.append(f"\n## Source Files")
        for fpath, line in file_refs[:5]:
            rel = fpath.replace(ctx.PROJECT_ROOT + '/', '')
            parts.append(f"  {rel}" + (f":{line}" if line else ""))
            # Show lines around the error site for immediate context
            if line:
                abs_path = fpath if os.path.isabs(fpath) else os.path.join(ctx.PROJECT_ROOT, fpath)
                if os.path.isfile(abs_path):
                    try:
                        with open(abs_path, encoding="utf-8", errors="ignore") as _ef:
                            file_lines = _ef.readlines()
                        lineno = int(line)
                        lo = max(0, lineno - 3)
                        hi = min(len(file_lines), lineno + 2)
                        parts.append("  ```")
                        for ln_idx in range(lo, hi):
                            marker = ">>>" if ln_idx == lineno - 1 else "   "
                            parts.append(f"  {marker} {ln_idx+1}: {file_lines[ln_idx].rstrip()}")
                        parts.append("  ```")
                    except Exception as _err5:
                        logger.debug(f'silent-except workflow_audit.py:408: {type(_err5).__name__}: {_err5}')
    # Search KB for similar bugs — by error message AND by module names from stack
    kb_query = error_type.group(2)[:60] if error_type else error_text[:80]
    kb_results = cached_kb_search(kb_query, 5, ctx.project_engine)
    # Also search global KB for cross-project patterns
    if ctx.global_engine:
        glob_hits = cached_kb_search(kb_query, 2, ctx.global_engine)
        kb_results = list(kb_results)  # ensure mutable copy
        kb_results.extend([dict(k, title=f"[global] {k['title']}") for k in glob_hits
                           if k["id"] not in {r["id"] for r in kb_results}])
    # Also search by module names from file refs for broader matches
    seen_ids = {r["id"] for r in kb_results}
    for fpath, _ in file_refs[:3]:
        module = os.path.basename(fpath).replace('.js', '').replace('.ts', '')
        module_kb = cached_kb_search(module, 2, ctx.project_engine)
        kb_results.extend([k for k in module_kb if k["id"] not in seen_ids])
        seen_ids.update(k["id"] for k in module_kb)
    if kb_results:
        parts.append(f"\n## Related KB Entries ({len(kb_results)})")
        for k in kb_results:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:150]}")
            parts.append("")
    # Symbol context
    unique_symbols = list(set(symbol_refs))[:5]
    for sym in unique_symbols:
        callers = _find_callers(sym, ctx.PROJECT_ROOT)
        if 1 <= len(callers) <= 20:
            parts.append(f"\n## '{sym}' appears in {len(callers)} locations")
            for r in callers[:3]:
                parts.append(f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']}")
    if not file_refs and not kb_results and not unique_symbols:
        parts.append("\nNo specific diagnosis available. Try search_knowledge with key terms from the error.")

    # Adaptive thinking synthesis: root cause + fix steps, KB grounded via corpus.
    # Two-stage pipeline: GPU0 extracts error facts from stack + KB, GPU1 reasons fix steps.
    kb_lines = [f"  [{k['category']}] {k['title']}: {k['content'][:200]}" for k in kb_results[:5]]
    raw_context = (
        f"Error:\n{error_text[:800]}\n\n"
        + ("Relevant KB entries:\n" + "\n".join(kb_lines) + "\n" if kb_lines else "")
    )
    question = (
        "What is the root cause and exact fix steps for this error? "
        "(1) most likely root cause in one sentence, "
        "(2) exact fix steps as a numbered list, "
        "(3) any boundary/architectural rule to check."
    )
    answer_format = (
        "ROOT CAUSE: one sentence naming the specific function, file, or signal.\n"
        "FIX:\n1. first step\n2. second step\n3. third step (max 3 steps)\n"
        "RULE: any architectural boundary or constraint to verify (omit if none)."
    )
    synthesis = None
    try:
        from .synthesis_pipeline import _two_stage_think
        synthesis = _two_stage_think(raw_context, question, max_tokens=800,
                                     answer_format=answer_format)
        if synthesis is None:
            kb_suffix = ("\n\nRelevant project KB entries:\n" + "\n".join(kb_lines)) if kb_lines else ""
            synthesis = _reasoning_think(
                f"Error:\n{error_text[:600]}\n\n{question}" + kb_suffix,
                max_tokens=800, system=_THINK_SYSTEM
            )
        if synthesis:
            from .synthesis.synthesis_inference import compress_for_claude, ground_synthesis
            synthesis = compress_for_claude(synthesis, max_chars=800, hint="error fix steps")
            # Ground: drop any bullet citing paths/symbols not in the source
            # (error_text + KB entries). Catches the same "correctly-cites-
            # file, invents-symbol" hallucination class as what_did_i_forget.
            synthesis = ground_synthesis(synthesis, raw_context,
                                         log_label="diagnose_error")
    except Exception as _e:
        logger.warning(f"diagnose_error: synthesis error: {_e}")

    if synthesis:
        parts.append(f"\n## Fix Synthesis *(adaptive)*")
        parts.append(synthesis)
    else:
        logger.warning("diagnose_error: adaptive synthesis unavailable")

    return "\n".join(parts)
