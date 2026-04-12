"""HME knowledge tools."""
import os
import time
import logging
from server.tools_analysis import _track

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)

logger = logging.getLogger("HME")

def add_knowledge(title: str, content: str, category: str = "general", tags: list[str] = [], scope: str = "project", related_to: str = "", relation_type: str = "", listening_notes: str = "") -> str:
    """Persist a knowledge entry to the KB. Tell the STORY, not just the fact: include WHY this matters musically, what the listener experiences when this constraint is violated, and what happened in the round that discovered it. Categories: 'architecture', 'decision', 'pattern', 'bugfix', 'general'. Use listening_notes to describe the musical effect ('coherent sections lost their sense of arrival'). Use related_to=<entry_id> with relation_type (caused_by, fixed_by, depends_on, contradicts, similar_to, supersedes) for knowledge_graph edges. Scope 'project'/'global'/'both'."""
    _track("add_knowledge")
    ctx.ensure_ready_sync()
    if not title.strip():
        return "Error: title cannot be empty."
    if not content.strip():
        return "Error: content cannot be empty."
    if listening_notes.strip():
        content = content.rstrip() + f"\n\nListening notes: {listening_notes.strip()}"
    valid_categories = {"architecture", "decision", "pattern", "bugfix", "general"}
    if category not in valid_categories:
        return f"Error: invalid category '{category}'. Valid: {', '.join(sorted(valid_categories))}"
    tag_list = [str(t).strip() for t in tags if str(t).strip()] if tags else []
    results = []

    if scope in ("project", "both"):
        r = ctx.project_engine.add_knowledge(title=title, content=content, category=category, tags=tag_list, related_to=related_to, relation_type=relation_type)
        action = r.get("action", "store")
        action_msg = {
            "store": "NEW entry",
            "merge": f"MERGED with existing entry (redundant content combined)",
            "supersede": f"SUPERSEDED existing entry {r.get('superseded', '?')}"
        }.get(action, "stored")
        results.append(f"  [project] ID: {r['id']} ({action_msg})")

    if scope in ("global", "both"):
        r = ctx.global_engine.add_knowledge(title=title, content=content, category=category, tags=tag_list, related_to=related_to, relation_type=relation_type)
        action = r.get("action", "store")
        results.append(f"  [global]  ID: {r['id']}")

    # Invalidate KB hits cache so before_editing re-fetches fresh constraints
    ctx._kb_version = getattr(ctx, "_kb_version", 0) + 1
    _new_kb_ver = ctx._kb_version

    # Feed the session narrative so models know what was just learned this session
    try:
        from server.tools_analysis.synthesis import append_session_narrative
        append_session_narrative("knowledge_added", f"[{category}] {title[:70]}")
    except Exception as e:
        logger.warning("append_session_narrative failed: %s", e)

    # Incremental warm context update — batched and parallelized across all 3 models.
    # Debounced 3s so rapid-fire learn() calls coalesce into one Ollama round-trip.
    try:
        from server.tools_analysis.synthesis_warm import queue_incremental_update
        queue_incremental_update(title=title, content=content, category=category, new_kb_ver=_new_kb_ver)
    except Exception as _e:
        logger.warning(f"incremental KB update queue failed: {_e}")

    # Contradiction detection: check if new entry conflicts with existing KB
    contradiction_warning = ""
    if scope in ("project", "both"):
        contradiction_warning = _check_kb_contradictions(title, content, ctx.project_engine)

    base = f"Knowledge added ({scope}):\n  Title: {title}\n  Category: {category}\n" + "\n".join(results)
    return base + contradiction_warning if not contradiction_warning else base + "\n\n" + contradiction_warning


def _check_kb_contradictions(title: str, content: str, engine) -> str:
    """Check if a new KB entry contradicts existing entries. Returns warning string or empty."""
    try:
        related = engine.search_knowledge(f"{title} {content}", top_k=5)
    except Exception:
        return ""
    candidates = [e for e in related if 0.3 < e.get("score", 0) < 0.9]
    if not candidates:
        return ""

    batch = []
    for i, e in enumerate(candidates[:3]):
        batch.append(
            f"EXISTING {i + 1} [{e['id']}] \"{e['title']}\": {e['content'][:300]}"
        )

    try:
        from server.tools_analysis.synthesis_ollama import _local_think, _LOCAL_MODEL
        prompt = (
            f"Does this new knowledge base entry make claims INCOMPATIBLE with any existing entry?\n\n"
            f"NEW ENTRY: \"{title}\"\n{content[:400]}\n\n"
            + "\n".join(batch) + "\n\n"
            "CONTRADICT = incompatible claims about the SAME thing (one says increase, other says decrease).\n"
            "OK = different topics, complementary, or one extends/supersedes the other.\n\n"
            "For each existing entry, respond with ONE line:\n"
            "EXISTING N: CONTRADICT — <the specific incompatible claims>\n"
            "or\n"
            "EXISTING N: OK\n"
        )
        result = _local_think(
            prompt, max_tokens=300, model=_LOCAL_MODEL,
            system="You are a strict KB consistency checker. You RARELY flag contradictions. When in doubt, say OK.",
            temperature=0.05,
        )
    except Exception:
        return ""

    if not result:
        return ""

    omission_markers = ["without mention", "doesn't mention", "not mention",
                        "does not mention", "no mention", "without specif",
                        "not directly", "without indicating",
                        "no genuine contra", "no contradiction", "not a contra",
                        "no real contra", "consistently", "no conflict"]
    warnings = []
    for line in result.strip().splitlines():
        if "CONTRADICT" in line:
            try:
                explanation_text = line.split("CONTRADICT")[1].strip().lstrip("—").lstrip("-").strip()
                if any(m in explanation_text.lower() for m in omission_markers):
                    continue
                num = int(line.split("EXISTING")[1].split(":")[0].strip()) - 1
                explanation = line.split("CONTRADICT")[1].strip().lstrip("—").lstrip("-").strip()
                if 0 <= num < len(candidates):
                    e = candidates[num]
                    warnings.append(
                        f"  ⚠ CONTRADICTS [{e['id']}] \"{e['title']}\": {explanation}\n"
                        f"    → Tag: learn(..., related_to='{e['id']}', relation_type='contradicts')"
                    )
            except (ValueError, IndexError):
                continue

    if not warnings:
        return ""
    return "⚠ CONTRADICTION WARNING:\n" + "\n".join(warnings)



def search_knowledge(query: str, top_k: int = 5, category: str = "") -> str:
    """Search the persistent knowledge base for constraints, decisions, patterns, and bugfixes. MANDATORY before modifying any module — always check for existing constraints first. Returns matching entries from both project and global KBs, ranked by relevance. Filter by category ('architecture', 'decision', 'pattern', 'bugfix') to narrow results. Each result includes ID, title, content, tags, and relevance score."""
    _track("search_knowledge")
    ctx.ensure_ready_sync()
    top_k = max(1, min(20, top_k))
    cat = category if category else None

    proj_results = ctx.project_engine.search_knowledge(query, top_k=top_k, category=cat)
    glob_results = ctx.global_engine.search_knowledge(query, top_k=top_k, category=cat)

    if not proj_results and not glob_results:
        return "No knowledge entries found. Use add_knowledge to build the knowledge base."

    parts = []

    if proj_results:
        lines = []
        for i, r in enumerate(proj_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {fmt_score(r['score'])})\n"
                f"{r['content']}"
            )
        parts.append("=== Project Knowledge ===\n" + "\n\n---\n\n".join(lines))

    if glob_results:
        lines = []
        for i, r in enumerate(glob_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {fmt_score(r['score'])})\n"
                f"{r['content']}"
            )
        parts.append("=== Global Knowledge ===\n" + "\n\n---\n\n".join(lines))

    return "\n\n".join(parts)



def remove_knowledge(entry_id: str, scope: str = "project") -> str:
    """Delete a knowledge entry by its ID. Use after kb_health identifies stale entries, or when a decision has been superseded. Specify scope='global' to remove from the shared KB instead of the project KB."""
    ctx.ensure_ready_sync()
    if not entry_id.strip():
        return "Error: entry_id cannot be empty."
    engine = ctx.global_engine if scope == "global" else ctx.project_engine
    ok = engine.remove_knowledge(entry_id)
    if ok:
        ctx._kb_version = getattr(ctx, "_kb_version", 0) + 1
        # Inject tombstone into warm contexts — cheap (~1-2s) vs full re-prime (~30s).
        # Models see "REMOVED entry X" and disregard it. GC re-prime cleans up tombstones.
        try:
            from server.tools_analysis.synthesis_warm import queue_tombstone
            queue_tombstone(entry_id=entry_id, new_kb_ver=ctx._kb_version)
        except Exception:
            pass
        return f"Knowledge entry '{entry_id}' removed from {scope}."
    return f"Failed to remove entry '{entry_id}' from {scope}. It may not exist."



def list_knowledge(category: str = "", scope: str = "") -> str:
    """List all knowledge entries, optionally filtered by category. Returns entry IDs, titles, categories, and tags for both project and global KBs. Use to get an overview of what's in the KB, or filter by category ('architecture', 'decision', 'pattern', 'bugfix') to find specific entry types."""
    ctx.ensure_ready_sync()
    cat = category if category else None
    parts = []

    if scope in ("project", "both", ""):
        entries = ctx.project_engine.list_knowledge(category=cat)
        if entries:
            status = ctx.project_engine.get_knowledge_status()
            header = f"Project KB: {status['total_entries']} entries"
            lines = []
            for e in entries:
                tags_str = ", ".join(e["tags"]) if e["tags"] else ""
                lines.append(f"  - [{e['id']}] {e['title']} ({e['category']}) {tags_str}")
            parts.append(header + "\n" + "\n".join(lines))

    if scope in ("global", "both", ""):
        entries = ctx.global_engine.list_knowledge(category=cat)
        if entries:
            status = ctx.global_engine.get_knowledge_status()
            header = f"Global KB: {status['total_entries']} entries"
            lines = []
            for e in entries:
                tags_str = ", ".join(e["tags"]) if e["tags"] else ""
                lines.append(f"  - [{e['id']}] {e['title']} ({e['category']}) {tags_str}")
            parts.append(header + "\n" + "\n".join(lines))

    if not parts:
        return "No knowledge entries found."

    return "\n\n".join(parts)



def compact_knowledge(scope: str = "project", threshold: float = 0.85) -> str:
    """Deduplicate the knowledge base by merging entries with high semantic similarity. Use after 30+ entries accumulate. The threshold (0.0-1.0) controls how similar entries must be to merge — 0.85 is a good default. Returns counts of removed vs kept entries. Scope can be 'project', 'global', or 'both'."""
    ctx.ensure_ready_sync()
    clamped = max(0.5, min(1.0, threshold))
    notes = []
    if clamped != threshold:
        notes.append(f"Note: threshold {threshold} clamped to {clamped} (valid range 0.5–1.0).")
    threshold = clamped
    results = notes
    total_removed = 0
    if scope in ("project", "both"):
        r = ctx.project_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [project] removed={r['removed']}, kept={r['kept']}")
        total_removed += r["removed"]
    if scope in ("global", "both"):
        r = ctx.global_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [global]  removed={r['removed']}, kept={r['kept']}")
        total_removed += r["removed"]
    return "Compaction complete:\n" + "\n".join(results)



def export_knowledge(scope: str = "project", category: str = "") -> str:
    """Export all knowledge entries as markdown for backup or review. Optionally filter by category. Returns formatted markdown with all entry metadata and content. Use for periodic KB snapshots or before major KB reorganization."""
    ctx.ensure_ready_sync()
    cat = category if category else None
    parts = []

    if scope in ("project", "both"):
        md = ctx.project_engine.export_knowledge(category=cat)
        if md:
            parts.append(f"# Project Knowledge\n\n{md}")

    if scope in ("global", "both"):
        md = ctx.global_engine.export_knowledge(category=cat)
        if md:
            parts.append(f"# Global Knowledge\n\n{md}")

    if not parts:
        return "No knowledge entries to export."

    return "\n\n---\n\n".join(parts)



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
                # Related-to links stored as tags in format "relation_type:entry_id" or bare "entry_id"
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

    # Adaptive synthesis: what do the connections mean architecturally?
    try:
        from server.tools_analysis import _think_local_or_claude
        if top_pairs:
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
            synthesis = _think_local_or_claude(user_text)
            if synthesis:
                parts.append(f"\n## Architectural Interpretation *(adaptive)*")
                parts.append(synthesis)
    except Exception as e:
        logger.warning("Architectural synthesis failed: %s", e)

    return "\n".join(parts)



def knowledge_graph(query: str) -> str:
    """Search knowledge with spreading activation: matches entry A, then traverses A's relationships to find connected entries. Multi-hop discovery."""
    ctx.ensure_ready_sync()
    results = ctx.project_engine.search_knowledge(query, top_k=8)
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
            # Extract linked entry IDs from typed relationships (e.g., "caused_by:abc123")
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
        from server.tools_analysis import _think_local_or_claude
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
                parts.append(f"\n## Cluster Analysis *(adaptive)*")
                parts.append(synthesis)
    except Exception as e:
        logger.warning("Cluster analysis synthesis failed: %s", e)

    return "\n".join(parts)



def kb_health() -> str:
    """Check all KB entries for staleness: do the files/modules they mention still exist? Are line counts accurate?"""
    ctx.ensure_ready_sync()
    import re
    rows = ctx.project_engine.list_knowledge_full()
    if not rows:
        return "KB is empty."
    parts = ["# KB Health Report\n"]
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
        parts.append(f"## Stale ({len(stale)} entries)")
        for s in stale:
            parts.append(s)
    parts.append(f"\n## Healthy: {len(healthy)} entries")
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
