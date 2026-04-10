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
from . import _track

logger = logging.getLogger("HME")


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
                "and verify tools/HME/settings.json still references this hook correctly."
            )
            if "sessionstart" in rel_path or "pretooluse" in rel_path or "posttooluse" in rel_path:
                all_warnings.append(
                    f"[{rel_path}] DOC CHECK: update doc/HME.md hook descriptions if behavior changed."
                )
        else:
            # Check KB for constraints on this module — split actionable vs historical
            kb_results = ctx.project_engine.search_knowledge(module_name, top_k=min(limits["kb_entries"], 5))
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

    # Adaptive synthesis: always run when API key available — missed things aren't only in warnings
    warnings_text = "\n".join(all_warnings[:15]) if all_warnings else "none"
    docs_text = ", ".join(sorted(doc_updates_needed)) if doc_updates_needed else "none flagged"
    user_text = (
        f"Changed files: {changed_files}\n"
        f"Audit warnings: {warnings_text}\n"
        f"Docs that may need updating: {docs_text}\n\n"
        "Rules:\n"
        "- ONLY list items you can tie to a specific file, function, or constraint name.\n"
        "- Do NOT list generic best practices (run tests, update docs, check types).\n"
        "- Do NOT repeat anything already in the audit warnings above.\n"
        "- If nothing concrete was missed, respond with exactly: 'Nothing missed.'\n"
        "- Maximum 3 bullet points. Each must name the exact file or function affected.\n"
    )
    synthesis = _local_think(user_text, max_tokens=800, model=_REASONING_MODEL,
                             system=_THINK_SYSTEM)
    if synthesis:
        from .synthesis_ollama import compress_for_claude
        synthesis = compress_for_claude(synthesis, max_chars=800, hint="post-change audit missed items")
        parts.append(f"\n## What You May Have Missed *(adaptive)*")
        parts.append(synthesis)
    else:
        logger.warning("what_did_i_forget: adaptive synthesis unavailable")

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
    kb_results = ctx.project_engine.search_knowledge(kb_query, top_k=5)
    # Also search global KB for cross-project patterns
    if ctx.global_engine:
        glob_hits = ctx.global_engine.search_knowledge(kb_query, top_k=2)
        kb_results.extend([dict(k, title=f"[global] {k['title']}") for k in glob_hits
                           if k["id"] not in {r["id"] for r in kb_results}])
    # Also search by module names from file refs for broader matches
    for fpath, _ in file_refs[:3]:
        module = os.path.basename(fpath).replace('.js', '').replace('.ts', '')
        module_kb = ctx.project_engine.search_knowledge(module, top_k=2)
        kb_results.extend([k for k in module_kb if k["id"] not in {r["id"] for r in kb_results}])
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

    # Adaptive thinking synthesis: root cause + fix steps, KB grounded via corpus
    user_text = (
        f"Error:\n{error_text[:600]}\n\n"
        "Based on the error and the project KB, provide: "
        "(1) most likely root cause in one sentence, "
        "(2) exact fix steps as a numbered list, "
        "(3) any boundary/architectural rule to check."
    )
    # Ground local model in the KB entries already found — prevents hallucination
    kb_lines = [f"  [{k['category']}] {k['title']}: {k['content'][:200]}" for k in kb_results[:5]]
    kb_suffix = ("\n\nRelevant project KB entries:\n" + "\n".join(kb_lines)) if kb_lines else ""
    synthesis = _local_think(user_text + kb_suffix, max_tokens=512, model=_REASONING_MODEL,
                             system=_THINK_SYSTEM)
    if synthesis:
        from .synthesis_ollama import compress_for_claude
        synthesis = compress_for_claude(synthesis, max_chars=600, hint="error fix steps")
        parts.append(f"\n## Fix Synthesis *(adaptive)*")
        parts.append(synthesis)
    else:
        logger.warning("diagnose_error: adaptive synthesis unavailable")

    return "\n".join(parts)
