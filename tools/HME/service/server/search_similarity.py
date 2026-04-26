"""HME search tools — similarity: find_similar_code."""
import logging
import os

from server import context as ctx
from server.helpers import fmt_sim_score, format_knowledge_results
from rag_engine import summarize_chunk
from analysis import find_similar_code as _find_similar

logger = logging.getLogger("HME")


def find_similar_code(code_snippet: str, top_k: int = 10) -> str:
    """Find code chunks semantically similar to a given snippet. Paste a code fragment and get back the most similar chunks in the codebase, ranked by vector similarity. Useful for finding duplicated logic, parallel implementations, or code that follows the same pattern. Returns file locations, language, similarity scores, and chunk summaries."""
    ctx.ensure_ready_sync()
    top_k = max(1, min(30, top_k))
    results = _find_similar(code_snippet, ctx.project_engine, top_k=top_k)

    if not results:
        return "No similar code found. Make sure the codebase is indexed."

    lines = []
    for i, r in enumerate(results):
        summary = summarize_chunk(r['content'], r['language'])
        lines.append(
            f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
            f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}"
        )

    # KB enrichment: surface constraints relevant to the top matching files
    top_modules = list(dict.fromkeys(
        os.path.basename(r['source']).replace('.js', '').replace('.ts', '').replace('.py', '')
        for r in results[:3]
    ))
    kb_hits = []
    seen_kb = set()
    for mod in top_modules:
        for k in ctx.project_engine.search_knowledge(mod, top_k=2):
            if k['id'] not in seen_kb:
                kb_hits.append(k)
                seen_kb.add(k['id'])
    if kb_hits:
        lines.extend(format_knowledge_results(kb_hits, "\n## KB Constraints"))
    return "\n".join(lines)
