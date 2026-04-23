"""HME session introspection — tool usage patterns, workflow discipline, KB health."""
import os
import re
import logging

from server import context as ctx
from .. import _get_compositional_context, _track, _usage_stats, _journal_freshness_banner

logger = logging.getLogger("HME")


def hme_introspect() -> str:
    """Self-benchmarking: report tool usage patterns, workflow discipline, KB health."""
    _track("hme_introspect")
    parts = ["## HME Session Introspection\n"]

    if _usage_stats:
        sorted_usage = sorted(_usage_stats.items(), key=lambda x: -x[1])
        parts.append("### Tool Usage This Session")
        for tool, count in sorted_usage:
            parts.append(f"  {tool}: {count}")
        parts.append(f"\n**Total tracked calls:** {sum(c for _, c in sorted_usage)}")
        expected = {"learn", "find", "read", "review", "evolve", "status", "trace"}
        unused = expected - set(_usage_stats.keys())
        if unused:
            parts.append(f"**Mandatory but unused:** {', '.join(sorted(unused))}")

        be_count = _usage_stats.get("before_editing", 0)
        wf_count = _usage_stats.get("what_did_i_forget", 0)
        if be_count > 0 or wf_count > 0:
            parts.append(f"\n### Workflow Discipline")
            parts.append(f"  before_editing: {be_count}  |  what_did_i_forget: {wf_count}")
            if be_count > 0 and wf_count == 0:
                parts.append(f"  WARNING: editing without post-change audits")
            elif be_count > wf_count + 2:
                parts.append(f"  NOTE: {be_count - wf_count} edits lack matching post-audits")
            elif wf_count > 0 and be_count == 0:
                parts.append(f"  WARNING: post-audits without pre-edit research")
            else:
                parts.append(f"  Good: pre-edit/post-audit ratio balanced")
    else:
        parts.append("### Tool Usage: no tracked calls yet")

    parts.append("")

    comp = _get_compositional_context("system")
    if comp:
        parts.append("### Last Run Musical Context")
        parts.append(comp)

    journal_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "journal.md")
    if os.path.isfile(journal_path):
        try:
            with open(journal_path, encoding="utf-8") as _jf:
                journal_content = _jf.read()
            section_starts = [m.start() for m in re.finditer(r'^## R\d+', journal_content, re.MULTILINE)]
            if section_starts:
                start = section_starts[-1]
                rest = journal_content[start + 4:]
                next_match = re.search(r'^## ', rest, re.MULTILINE)
                end = (start + 4 + next_match.start()) if next_match else len(journal_content)
                latest_section = journal_content[start:end].rstrip()
                if len(latest_section) > 1500:
                    cut = latest_section.rfind('\n', 0, 1500)
                    latest_section = latest_section[:cut if cut > 0 else 1500] + "\n  ... (truncated)"
                parts.append("\n### Latest Journal Entry")
                parts.append(latest_section)
        except Exception as _err1:
            logger.debug(f"parts.append: {type(_err1).__name__}: {_err1}")

    kb_count = 0
    kb_categories: dict = {}
    try:
        ctx.ensure_ready_sync()
        all_kb_full = ctx.project_engine.list_knowledge_full() if hasattr(ctx.project_engine, 'list_knowledge_full') else []
        kb_count = len(all_kb_full)
        for entry in all_kb_full:
            cat = entry.get("category", "unknown")
            kb_categories[cat] = kb_categories.get(cat, 0) + 1
    except Exception as _err:
        logger.debug(f"unnamed-except evolution_introspect.py:80: {type(_err).__name__}: {_err}")
        try:
            all_kb = ctx.project_engine.list_knowledge()
            kb_count = len(all_kb)
        except Exception as _err2:
            logger.debug(f"len: {type(_err2).__name__}: {_err2}")
    idx = {"files": 0, "chunks": 0, "symbols": 0}
    try:
        status = ctx.project_engine.get_status()
        idx["files"] = status.get("total_files", 0)
        idx["chunks"] = status.get("total_chunks", 0)
        sym_status = ctx.project_engine.get_symbol_status()
        idx["symbols"] = sym_status.get("total_symbols", 0) if sym_status.get("indexed") else 0
    except Exception as _err3:
        logger.debug(f"sym_status.get: {type(_err3).__name__}: {_err3}")
    parts.append(f"\n### System Health")
    parts.append(f"  KB entries: {kb_count}")
    if kb_categories:
        cat_str = ", ".join(f"{cat}:{n}" for cat, n in sorted(kb_categories.items(), key=lambda x: -x[1]))
        parts.append(f"  KB breakdown: {cat_str}")
    parts.append(f"  Index: {idx['files']} files, {idx['chunks']} chunks, {idx['symbols']} symbols")

    return "\n".join(parts)
