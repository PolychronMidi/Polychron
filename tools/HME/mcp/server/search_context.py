"""HME search tools — context assembly: get_context."""
import logging

from server import context as ctx
from server.helpers import fmt_sim_score

logger = logging.getLogger("HME")


def get_context(query: str, max_tokens: int = 0, language: str = "", path: str = "") -> str:
    """Token-budgeted context assembly with auto context-window awareness.
    query is a natural-language description of what you need (NOT a file path — use file_lines for reading files, or pass file paths via the path parameter to scope results).
    max_tokens=0 means AUTO: reads /tmp/claude-context.json (from status line) to determine budget.
    >75% remaining = greedy (16000), 50-75% = moderate (8000), 25-50% = conservative (3000), <25% = minimal (800).
    max_tokens>0 means MANUAL override."""
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Empty query. Provide a natural-language description of what you're looking for."
    if max_tokens > 0:
        budget = max_tokens
    else:
        # Auto-detect from status line context file
        try:
            import json as _json
            with open("/tmp/claude-context.json") as _ctxf:
                _ctx_data = _json.load(_ctxf)
            remaining = _ctx_data.get("remaining_pct") or 50
            if remaining > 75:
                budget = 16000
            elif remaining > 50:
                budget = 8000
            elif remaining > 25:
                budget = 3000
            else:
                budget = 800
        except Exception as _err:
            logger.debug(f"unnamed-except search_context.py:36: {type(_err).__name__}: {_err}")
            budget = 8000  # safe default when context file unavailable
    lang = language if language else None
    # When path filtering, search much wider to compensate for post-filter loss
    search_budget = budget * 8 if path else budget
    results = ctx.project_engine.search_budgeted(query, max_tokens=search_budget, language=lang)
    if path:
        results = [r for r in results if path in r.get('source', '')]
        # Re-trim to actual budget
        trimmed = []
        used = 0
        for r in results:
            ct = len(r.get('content', '')) // 4
            if used + ct > budget:
                break
            trimmed.append(r)
            used += ct
        results = trimmed
    if not results:
        if path:
            return f"No results for '{query}' in path '{path}' within {budget} token budget. Try without the path filter, or use search_code for broader results."
        return f"No results for '{query}' within {budget} token budget. Try broader terms or check index with get_index_status."
    # KB enrichment
    kb_hits = ctx.project_engine.search_knowledge(query, top_k=3)
    relevant_kb = kb_hits
    parts = []
    if relevant_kb:
        parts.append("## KB Context")
        for k in relevant_kb:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
        parts.append("")
    total_tokens = 0
    parts.append(f"## Code ({len(results)} chunks, ~{budget} token budget)")
    for i, r in enumerate(results):
        chunk_tokens = len(r['content']) // 4
        total_tokens += chunk_tokens
        truncated = " (truncated)" if r.get('truncated') else ""
        kb_tag = ""
        if r.get("kb_constraints"):
            kb_tag = f" [KB: {', '.join(r['kb_constraints'][:2])}]"
        parts.append(f"\n### [{i+1}] {r['source'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['start_line']}-{r['end_line']} ({fmt_sim_score(r['score'])}){kb_tag}{truncated}")
        parts.append(f"```{r['language']}")
        parts.append(r['content'])
        parts.append("```")
    ctx_info = ""
    try:
        import json as _json
        with open("/tmp/claude-context.json") as _ctxf:
            _ctx_data = _json.load(_ctxf)
        ctx_info = f" | context: {_ctx_data.get('remaining_pct', '?')}% remaining"
    except Exception as _err1:
        logger.debug(f'silent-except search_context.py:86: {type(_err1).__name__}: {_err1}')
    parts.append(f"\n---\nUsed ~{total_tokens} tokens of {budget} budget ({len(results)} chunks){ctx_info}")
    return "\n".join(parts)
