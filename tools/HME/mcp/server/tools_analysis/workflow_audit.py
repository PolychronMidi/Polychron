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
from .synthesis import _local_think, _REASONING_MODEL, _THINK_SYSTEM
from .synthesis_session import append_session_narrative
from .tool_cache import cached_kb_search, cached_find_callers
from . import _track

logger = logging.getLogger("HME")


def _scan_python_bug_patterns(rel_path: str, content: str) -> list[str]:
    """Heuristic scan for common Python bug patterns in HME server code.

    Checks for null-sentinel .get() traps, unguarded ValueError in OSError handlers,
    unbounded append-only file growth, `or` idioms that mask 0.0, and variable-before-
    assignment across guard boundaries.
    """
    import re
    warnings = []

    # 1. dict.get(key, non-None-default) where key could exist with None value.
    # Pattern: .get("...", <number_or_call>) used in arithmetic/comparison/subtraction.
    # The default is only used when the KEY IS ABSENT — not when it's present with None.
    null_sentinel = re.findall(
        r'\.get\(["\'][^"\']+["\'],\s*(?:0|time\.\w+\(\)|[0-9]+\.?[0-9]*)\)',
        content
    )
    if null_sentinel:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(null_sentinel)} .get(key, default) call(s) — "
            "if the key can exist with None, .get(key, X) returns None not X. "
            "Use `(d.get(key) or X)` or `if d.get(key) is None`."
        )

    # 2. int()/float() conversion inside a try block that only catches OSError-family.
    # ValueError from bad string conversion won't be caught.
    if re.search(r'\bint\(|\bfloat\(', content):
        for block_match in re.finditer(
            r'except\s+\(([^)]+)\)', content
        ):
            exc_types = block_match.group(1)
            if ("OSError" in exc_types or "JSONDecodeError" in exc_types) \
                    and "ValueError" not in exc_types and "TypeError" not in exc_types:
                warnings.append(
                    f"[{rel_path}] PYTHON: `except ({exc_types.strip()})` — "
                    "int()/float() conversions present but ValueError/TypeError not caught; "
                    "malformed values will escape to the outer exception handler."
                )
                break  # one warning per file is enough

    # 3. Append-only file write without a corresponding trim/truncate.
    append_opens = re.findall(r'open\([^,)]+,\s*["\']a["\']\)', content)
    has_trim = bool(re.search(r'_trim_\w+|\.writelines\(.*\[-|truncate\(', content))
    if append_opens and not has_trim:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(append_opens)} append-only write(s) with no trim — "
            "file will grow without bound over time."
        )

    # 4. `.get(...) or X` idiom that masks legitimate zero/False values.
    zero_or = re.findall(r'\.get\([^)]+\)\s+or\s+(?:[0-9]+\.?[0-9]*|time\.\w+\(\))', content)
    if zero_or:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(zero_or)} `.get() or X` — "
            "returns fallback for 0, 0.0, and '' too, not just None. "
            "Use `if .get() is None else X` when zero is a valid value."
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
            "absent/None key raises AttributeError. "
            "Use `(d.get(key) or obj).attr` or check `is not None` first."
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
        return "No changed files detected. If you just edited files, they may already be committed. Pass changed_files='path1,path2' explicitly."
    parts = [f"# Post-Change Audit (context: {budget})\n"]
    all_warnings = []
    doc_updates_needed = set()
    for file_path in files:
        abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
        if abs_path is None:
            all_warnings.append(f"[{file_path}] SKIPPED: outside project root")
            continue
        rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
        module_name = (os.path.basename(abs_path)
                       .replace(".js", "").replace(".ts", "").replace(".sh", "").replace(".py", ""))
        # Hook files: KB search won't find relevant entries by filename — emit structural reminders instead
        if rel_path.endswith(".sh") and "/hooks/" in rel_path:
            all_warnings.append(
                f"[{rel_path}] HOOK CHANGE: check other hooks in tools/HME/hooks/ for the same issue, "
                "and verify tools/HME/hooks/hooks.json still references this hook correctly."
            )
            if "sessionstart" in rel_path or "pretooluse" in rel_path or "posttooluse" in rel_path:
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
                        except Exception:
                            pass
        except Exception:
            pass
        # Track doc update needs (path triggers from project-rules.json)
        for path_prefix, docs in DOC_UPDATE_TRIGGERS.items():
            if path_prefix in rel_path:
                for d in docs:
                    doc_updates_needed.add(d)

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

    # Python-specific static bug pattern scan (HME server + all .py files)
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
        except OSError:
            pass

    # Collect git diff for synthesis context (bounded to 4000 chars)
    diff_context = ""
    try:
        import subprocess as _sp_diff
        _diff_result = _sp_diff.run(
            ["git", "-C", ctx.PROJECT_ROOT, "diff", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
        diff_context = _diff_result.stdout[:4000]
    except Exception:
        pass

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
                except (OSError, ValueError):
                    pass
            if hunk_parts:
                hunk_context = "\nChanged file context (±10 lines around diff hunks):\n" + "\n\n".join(hunk_parts)
        except Exception:
            pass

    # Adaptive synthesis — thorough bug probe, no artificial bullet limit, no default "Nothing missed"
    warnings_text = "\n".join(all_warnings[:20]) if all_warnings else "none"
    docs_text = ", ".join(sorted(doc_updates_needed)) if doc_updates_needed else "none flagged"
    diff_section = f"\nCode diff (first 4000 chars):\n```\n{diff_context}\n```\n" if diff_context else ""
    hunk_section = hunk_context if hunk_context else ""
    user_text = (
        f"Changed files: {changed_files}\n"
        f"Static audit warnings already found: {warnings_text}\n"
        f"Docs flagged: {docs_text}\n"
        f"{diff_section}"
        f"{hunk_section}\n"
        "PROBE for missed bugs systematically. For each changed Python file, check:\n"
        "1. dict.get(key, non-None-default) — can the key exist with value None? If so, .get(key, X) "
        "returns None, not X. Should use (d.get(key) or X) or an explicit `is None` check.\n"
        "2. Exception handler gaps — does `except (OSError, json.JSONDecodeError)` miss "
        "ValueError/TypeError from int()/float() conversions or comparison of incompatible types?\n"
        "3. Append-only file writes — is there a corresponding trim to bound file growth?\n"
        "4. `x or fallback` idioms after .get() — could `x` legitimately be 0.0 or False?\n"
        "5. Path assumptions — does code assume a path is a file when it might be a directory?\n"
        "6. Variable used before assignment — any variable defined inside an `if` guard but "
        "referenced in an outer scope where the guard might be False?\n"
        "7. State/type key mismatches — are dict keys used for dedup/lookup consistent with the "
        "keys used when storing?\n"
        "8. None-guarded arithmetic — is `time.time() - value` ever called where value could be None?\n"
        "Rules:\n"
        "- Name the exact file, function, and the specific line-level issue.\n"
        "- Do NOT repeat anything already listed in static audit warnings.\n"
        "- Do NOT list generic best practices (run tests, update docs, check types).\n"
        "- List every concrete missed bug you find. No bullet limit.\n"
        "- If truly nothing concrete remains, say 'Nothing missed.'\n"
    )
    synthesis = None
    try:
        result = _local_think("/no_think\n" + user_text, max_tokens=400,
                              model=_REASONING_MODEL, system=_THINK_SYSTEM)
        if result:
            from .synthesis_ollama import compress_for_claude
            synthesis = compress_for_claude(result, max_chars=1200, hint="post-change audit missed bugs")
    except Exception as _e:
        logger.warning(f"what_did_i_forget: synthesis error: {_e}")

    if synthesis:
        parts.append(f"\n## What You May Have Missed *(adaptive)*")
        parts.append(synthesis)
        total_issues = len(all_warnings) + synthesis.count("\n- ") + synthesis.count("\n* ")
        if total_issues >= 4:
            parts.append(
                f"\n_Found {total_issues} issues total — run `review(mode='forget')` again after fixing "
                "to surface any remaining bugs (iterate until 0 remaining)._"
            )
    else:
        logger.warning("what_did_i_forget: adaptive synthesis unavailable (timeout or Ollama down)")

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
                    except Exception:
                        pass
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
            synthesis = _local_think(
                f"Error:\n{error_text[:600]}\n\n{question}" + kb_suffix,
                max_tokens=800, model=_REASONING_MODEL, system=_THINK_SYSTEM
            )
        if synthesis:
            from .synthesis_ollama import compress_for_claude
            synthesis = compress_for_claude(synthesis, max_chars=800, hint="error fix steps")
    except Exception as _e:
        logger.warning(f"diagnose_error: synthesis error: {_e}")

    if synthesis:
        parts.append(f"\n## Fix Synthesis *(adaptive)*")
        parts.append(synthesis)
    else:
        logger.warning("diagnose_error: adaptive synthesis unavailable")

    return "\n".join(parts)
