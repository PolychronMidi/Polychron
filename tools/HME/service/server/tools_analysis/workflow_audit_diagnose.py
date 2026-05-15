"""HME post-edit audit tools -- what_did_i_forget and diagnose_error."""
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




def diagnose_error(error_text: str) -> str:
    """Paste a pipeline error. Returns: likely source file, relevant KB entries, similar past bugs, and fix patterns."""
    ctx.ensure_ready_sync()
    if not error_text or not error_text.strip():
        return "Error: error_text cannot be empty. Paste the error message or stack trace."
    parts = ["# Error Diagnosis\n"]
    # Extract symbol/file references from error text
    import re
    file_refs = re.findall(r'((?:[\w./-]+/)+[\w.\-]+\.(?:js|ts|py)):?(\d+)?', error_text)
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
    # Search KB for similar bugs -- by error message AND by module names from stack
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
