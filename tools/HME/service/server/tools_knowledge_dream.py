"""HME knowledge tools."""
import os
import time
import logging
from server.tools_analysis import track as _track

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)

logger = logging.getLogger("HME")



def memory_dream() -> str:
    """Consolidation pass: replay all KB entries, discover hidden connections via pairwise similarity. Inspired by Vestige's memory dreaming."""
    ctx.ensure_ready_sync()
    rows = ctx.project_engine.list_knowledge_full()
    if len(rows) < 2:
        return "Not enough KB entries to dream (need 2+)."
    # Compute embeddings for all entries
    texts = [f"{r['title']} {r['content']}" for r in rows]
    vecs = ctx.shared_model.encode(texts)
    # Find high-similarity pairs that aren't already linked
    import numpy as np
    discoveries = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            sim = float(np.dot(vecs[i], vecs[j]) / (np.linalg.norm(vecs[i]) * np.linalg.norm(vecs[j]) + 1e-10))
            if sim > 0.35:
                tags_i = rows[i].get("tags", [])
                tags_j = rows[j].get("tags", [])
                if isinstance(tags_i, str): tags_i = [tags_i]
                if isinstance(tags_j, str): tags_j = [tags_j]
                already_linked = (
                    any(rows[j]["id"] in tag for tag in tags_i)
                    or any(rows[i]["id"] in tag for tag in tags_j)
                )
                if not already_linked:
                    discoveries.append((sim, rows[i]["title"], rows[j]["title"], rows[i]["id"], rows[j]["id"]))
    discoveries.sort(key=lambda x: -x[0])
    if not discoveries:
        return f"Memory dream complete: {len(rows)} entries, no hidden connections found (all similarities < 0.35)."
    parts = [f"# Memory Dream ({len(rows)} entries, {len(discoveries)} hidden connections)\n"]
    top_pairs = discoveries[:10]
    for sim, title_a, title_b, id_a, id_b in top_pairs:
        parts.append(f"  {sim:.0%} similarity:")
        parts.append(f"    [{id_a[:8]}] {title_a}")
        parts.append(f"    [{id_b[:8]}] {title_b}")
        parts.append(f"    -> Consider: add_knowledge related_to=\"{id_b}\" relation_type=\"similar_to\"")
        parts.append("")

    # Adaptive synthesis: run on a background thread with a hard timeout so
    if top_pairs:
        try:
            from server.tools_analysis import think_local_or_claude as _think_local_or_claude
            import concurrent.futures as _cf
            pairs_text = "\n".join(
                f"  {sim:.0%}: '{a}' <-> '{b}'" for sim, a, b, _, _ in top_pairs[:6]
            )
            user_text = (
                f"Discovered KB connections:\n{pairs_text}\n\n"
                "In 3 bullet points: what do these connections suggest architecturally? "
                "Are these entries describing the same causal chain from different angles? "
                "Which ones should be explicitly linked via add_knowledge? "
                "Are any of these connections surprising given the codebase design?"
            )
            # ThreadPoolExecutor.__exit__ blocks on shutdown(wait=True) even
            _ex = _cf.ThreadPoolExecutor(max_workers=1)
            _fut = _ex.submit(_think_local_or_claude, user_text)
            try:
                synthesis = _fut.result(timeout=15)
            except _cf.TimeoutError:
                synthesis = None
                parts.append("\n## Architectural Interpretation")
                parts.append("  (skipped -- local coder model did not respond within 15s)")
            finally:
                _ex.shutdown(wait=False, cancel_futures=True)
            if synthesis:
                from server.tools_analysis.synthesis import ground_synthesis
                synthesis = ground_synthesis(synthesis, user_text,
                                             log_label="architectural_interpretation")
                parts.append("\n## Architectural Interpretation *(adaptive)*")
                parts.append(synthesis)
        except Exception as e:
            logger.warning("Architectural synthesis failed: %s", e)

    return "\n".join(parts)



def knowledge_graph(query: str) -> str:
    """Search knowledge with spreading activation: matches entry A, then traverses A's relationships to find connected entries. Multi-hop discovery."""
    ctx.ensure_ready_sync()
    results = ctx.project_engine.search_knowledge(query, top_k=8)
    # Drop cross-encoder-clamped zero-score seeds: they're not meaningfully
    results = [r for r in results
               if (_s := r.get("score")) is not None and _s > 0]
    if not results:
        return "No knowledge entries match this query."
    # Spreading activation: fetch all KB entries once, then do ID-based graph traversal
    all_entries = {e["id"]: e for e in ctx.project_engine.list_knowledge_full()}
    activated = []
    seen_ids = {r["id"] for r in results}
    for r in results:
        tags = r.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tags:
            linked_id = tag.split(":")[-1] if ":" in tag else tag
            if len(linked_id) >= 8 and linked_id in all_entries and linked_id not in seen_ids:
                activated.append(all_entries[linked_id])
                seen_ids.add(linked_id)
    results = results + activated
    parts = [f"# Knowledge Graph: '{query}' ({len(results)} entries, {len(activated)} via activation)\n"]
    # Build adjacency from tags
    entries = {r["id"]: r for r in results}
    connections = []
    for r in results:
        tags = r.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tags:
            # Check for typed relationship: "relation_type:entry_id"
            if ":" in tag and tag.split(":")[1] in entries:
                rel_type, rel_id = tag.split(":", 1)
                connections.append((r["id"], rel_id, rel_type))
            elif tag in entries:
                connections.append((r["id"], tag, "related_to"))
            else:
                for other in results:
                    if other["id"] != r["id"]:
                        if tag.lower() in other["title"].lower() or tag.lower() in other["content"].lower()[:100]:
                            connections.append((r["id"], other["id"], f"shared: {tag}"))
    # Render entries
    parts.append(f"## Entries ({len(results)})")
    for r in results:
        score_pct = f"{fmt_score(r['score'])}" if isinstance(r.get('score'), (int, float)) else '?'
        parts.append(f"  [{r['id'][:8]}] **[{r['category']}] {r['title']}** ({score_pct})")
        parts.append(f"    {r['content'][:120]}...")
        parts.append("")
    # Render connections
    seen = set()
    unique_connections = []
    for a, b, reason in connections:
        key = tuple(sorted([a, b])) + (reason,)
        if key not in seen:
            seen.add(key)
            unique_connections.append((a, b, reason))
    if unique_connections:
        parts.append(f"## Connections ({len(unique_connections)})")
        for a, b, reason in unique_connections:
            a_title = entries.get(a, {}).get("title", a[:8])
            b_title = entries.get(b, {}).get("title", b[:8])
            parts.append(f"  {a_title[:40]} <-> {b_title[:40]} ({reason})")
    else:
        parts.append("## Connections: none detected (use related_to when adding knowledge to create links)")
    # Combined implications
    categories = set(r["category"] for r in results)
    if "bugfix" in categories and "pattern" in categories:
        parts.append(f"\n## Implication: bugfix + pattern entries both match -- check if the fix addresses the pattern root cause")
    if "decision" in categories and "architecture" in categories:
        parts.append(f"\n## Implication: decision + architecture entries both match -- verify the decision respects the architectural boundary")

    # Adaptive synthesis: what does this KB cluster mean right now?
    try:
        from server.tools_analysis import think_local_or_claude as _think_local_or_claude
        if results:
            cluster_text = "\n".join(
                f"  [{r['category']}] {r['title']}: {r['content'][:120]}"
                for r in results[:8]
            )
            conn_text = f"{len(unique_connections)} connections" if unique_connections else "no explicit connections"
            user_text = (
                f"Knowledge graph query: '{query}'\n"
                f"Activated entries ({len(results)}, {conn_text}):\n{cluster_text}\n\n"
                "In 3 points: (1) what is the common theme or causal chain in this KB cluster, "
                "(2) what current architectural risk does it highlight, "
                "(3) which entry is most important to act on first?"
            )
            synthesis = _think_local_or_claude(user_text)
            if synthesis:
                from server.tools_analysis.synthesis import ground_synthesis
                synthesis = ground_synthesis(synthesis, user_text,
                                             log_label="cluster_analysis")
                parts.append(f"\n## Cluster Analysis *(adaptive)*")
                parts.append(synthesis)
    except Exception as e:
        logger.warning("Cluster analysis synthesis failed: %s", e)

    return "\n".join(parts)



def kb_health() -> str:
    """Check all KB entries for staleness: do the files/modules they mention still exist? Are line counts accurate?"""
    ctx.ensure_ready_sync()
    import re
    from collections import Counter
    rows = ctx.project_engine.list_knowledge_full()
    if not rows:
        return "KB is empty."
    parts = ["# KB Health Report"]
    # Category / age distribution summary -- always useful even when no staleness.
    cat_counts = Counter(e.get("category", "general") for e in rows)
    now_ts = time.time()
    ages = [((now_ts - _ts) / 86400) for e in rows
            if (_ts := e.get("timestamp")) is not None and _ts > 0]
    if ages:
        parts.append(
            f"\n**Total:** {len(rows)} project entries | "
            f"age min={min(ages):.1f}d  median={sorted(ages)[len(ages)//2]:.1f}d  "
            f"max={max(ages):.1f}d"
        )
    else:
        parts.append(f"\n**Total:** {len(rows)} project entries")
    parts.append("\n## Category distribution")
    for cat, n in cat_counts.most_common():
        parts.append(f"  {cat:<16s} {n}")
    stale = []
    healthy = []
    for entry in rows:
        title = entry.get("title", "")
        content = entry.get("content", "")
        entry_id = entry.get("id", "?")[:8]
        issues = []
        # Check for file references
        file_refs = re.findall(r'(src/[\w/]+\.js)', content)
        for fref in file_refs:
            abs_path = os.path.join(ctx.PROJECT_ROOT, fref)
            if not os.path.isfile(abs_path):
                issues.append(f"references {fref} which no longer exists")
            else:
                with open(abs_path, encoding="utf-8", errors="ignore") as _fh:
                    lines = sum(1 for _ in _fh)
                # Check if entry mentions a line count
                line_match = re.search(r'(\d{3,})\s*lines', content)
                if line_match:
                    claimed = int(line_match.group(1))
                    if abs(claimed - lines) > 20:
                        issues.append(f"claims {claimed} lines for {fref}, actual {lines}")
        # Check age
        ts = entry.get("timestamp", 0)
        if ts > 0:
            age_days = (time.time() - ts) / 86400
            if age_days > 30:
                issues.append(f"entry is {age_days:.0f} days old")
        if issues:
            stale.append(f"  [{entry_id}] {title}: {'; '.join(issues)}")
        else:
            healthy.append(entry_id)
    if stale:
        parts.append(f"\n## Stale ({len(stale)} entries)")
        for s in stale:
            parts.append(s)
    parts.append(f"\n## Healthy: {len(healthy)} entries")
    # Highlight the five oldest fresh entries (candidates for refresh
    # even though they pass the staleness checks).
    _healthy_set = set(healthy)
    def _id_prefix(entry):
        _i = entry.get("id")
        return "" if _i is None else str(_i)[:8]
    dated = sorted(
        ((now_ts - _ts) / 86400, e)
        for e in rows
        if (_ts := e.get("timestamp")) is not None and _ts > 0
        and _id_prefix(e) in _healthy_set
    )
    if dated:
        parts.append("\n## Oldest healthy entries (refresh candidates)")
        for age_d, e in dated[-5:][::-1]:
            parts.append(f"  {age_d:5.1f}d  [{str(e.get('id',''))[:8]}] {str(e.get('title','')).strip()[:70]}")
    # Check global KB too
    if ctx.global_engine:
        glob_rows = ctx.global_engine.list_knowledge_full()
        if glob_rows:
            glob_stale = []
            for entry in glob_rows:
                ts = entry.get("timestamp", 0)
                if ts > 0 and (time.time() - ts) / 86400 > 90:
                    glob_stale.append(f"  [{entry.get('id','?')[:8]}] {entry.get('title','')}: {(time.time()-ts)/86400:.0f} days old")
            parts.append(f"\n## Global KB: {len(glob_rows)} entries" + (f", {len(glob_stale)} aged >90 days" if glob_stale else ", all fresh"))
            for s in glob_stale[:5]:
                parts.append(s)
    return "\n".join(parts)
