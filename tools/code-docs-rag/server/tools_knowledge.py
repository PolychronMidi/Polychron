"""code-docs-rag knowledge tools."""
import os
import time
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)

logger = logging.getLogger("code-docs-rag")

@ctx.mcp.tool()
def add_knowledge(title: str, content: str, category: str = "general", tags: str = "", scope: str = "project", related_to: str = "", relation_type: str = "") -> str:
    """Persist a knowledge entry (decision, calibration anchor, pattern, or bugfix) to the KB. Only call this after the user confirms a task is complete — never speculatively. Categories: 'architecture', 'decision', 'pattern', 'bugfix', 'general'. Use related_to=<entry_id> with relation_type (caused_by, fixed_by, depends_on, contradicts, similar_to, supersedes) to create typed graph edges for knowledge_graph traversal. Tags are comma-separated strings. Scope 'project' stores locally, 'global' stores in shared KB, 'both' stores in both. Automatically detects and merges redundant entries or supersedes outdated ones."""
    if not title.strip():
        return "Error: title cannot be empty."
    if not content.strip():
        return "Error: content cannot be empty."
    valid_categories = {"architecture", "decision", "pattern", "bugfix", "general"}
    if category not in valid_categories:
        return f"Error: invalid category '{category}'. Valid: {', '.join(sorted(valid_categories))}"
    # Accept both comma-separated string and list (LLM agents sometimes pass lists)
    if isinstance(tags, list):
        tags = ",".join(str(t) for t in tags)
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
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

    return f"Knowledge added ({scope}):\n  Title: {title}\n  Category: {category}\n" + "\n".join(results)



@ctx.mcp.tool()
def search_knowledge(query: str, top_k: int = 5, category: str = "") -> str:
    """Search the persistent knowledge base for constraints, decisions, patterns, and bugfixes. MANDATORY before modifying any module — always check for existing constraints first. Returns matching entries from both project and global KBs, ranked by relevance. Filter by category ('architecture', 'decision', 'pattern', 'bugfix') to narrow results. Each result includes ID, title, content, tags, and relevance score."""
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



@ctx.mcp.tool()
def remove_knowledge(entry_id: str, scope: str = "project") -> str:
    """Delete a knowledge entry by its ID. Use after kb_health identifies stale entries, or when a decision has been superseded. Specify scope='global' to remove from the shared KB instead of the project KB."""
    if not entry_id.strip():
        return "Error: entry_id cannot be empty."
    engine = ctx.global_engine if scope == "global" else ctx.project_engine
    ok = engine.remove_knowledge(entry_id)
    if ok:
        return f"Knowledge entry '{entry_id}' removed from {scope}."
    return f"Failed to remove entry '{entry_id}' from {scope}. It may not exist."



@ctx.mcp.tool()
def list_knowledge(category: str = "", scope: str = "") -> str:
    """List all knowledge entries, optionally filtered by category. Returns entry IDs, titles, categories, and tags for both project and global KBs. Use to get an overview of what's in the KB, or filter by category ('architecture', 'decision', 'pattern', 'bugfix') to find specific entry types."""
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



@ctx.mcp.tool()
def compact_knowledge(scope: str = "project", threshold: float = 0.85) -> str:
    """Deduplicate the knowledge base by merging entries with high semantic similarity. Use after 30+ entries accumulate. The threshold (0.0-1.0) controls how similar entries must be to merge — 0.85 is a good default. Returns counts of removed vs kept entries. Scope can be 'project', 'global', or 'both'."""
    results = []
    if scope in ("project", "both"):
        r = ctx.project_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [project] removed={r['removed']}, kept={r['kept']}")
    if scope in ("global", "both"):
        r = ctx.global_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [global]  removed={r['removed']}, kept={r['kept']}")
    return "Compaction complete:\n" + "\n".join(results)



@ctx.mcp.tool()
def export_knowledge(scope: str = "project", category: str = "") -> str:
    """Export all knowledge entries as markdown for backup or review. Optionally filter by category. Returns formatted markdown with all entry metadata and content. Use for periodic KB snapshots or before major KB reorganization."""
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



@ctx.mcp.tool()
def memory_dream() -> str:
    """Consolidation pass: replay all KB entries, discover hidden connections via pairwise similarity. Inspired by Vestige's memory dreaming."""
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
                # Check if already linked
                tags_i = rows[i].get("tags", "")
                tags_j = rows[j].get("tags", "")
                already_linked = rows[j]["id"] in tags_i or rows[i]["id"] in tags_j
                if not already_linked:
                    discoveries.append((sim, rows[i]["title"], rows[j]["title"], rows[i]["id"], rows[j]["id"]))
    discoveries.sort(key=lambda x: -x[0])
    if not discoveries:
        return f"Memory dream complete: {len(rows)} entries, no hidden connections found (all similarities < 0.35)."
    parts = [f"# Memory Dream ({len(rows)} entries, {len(discoveries)} hidden connections)\n"]
    for sim, title_a, title_b, id_a, id_b in discoveries[:10]:
        parts.append(f"  {sim:.0%} similarity:")
        parts.append(f"    [{id_a[:8]}] {title_a}")
        parts.append(f"    [{id_b[:8]}] {title_b}")
        parts.append(f"    -> Consider: add_knowledge related_to=\"{id_b}\" relation_type=\"similar_to\"")
        parts.append("")
    return "\n".join(parts)



@ctx.mcp.tool()
def knowledge_graph(query: str) -> str:
    """Search knowledge with spreading activation: matches entry A, then traverses A's relationships to find connected entries. Multi-hop discovery."""
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
    return "\n".join(parts)



@ctx.mcp.tool()
def kb_health() -> str:
    """Check all KB entries for staleness: do the files/modules they mention still exist? Are line counts accurate?"""
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
                lines = sum(1 for _ in open(abs_path, encoding="utf-8", errors="ignore"))
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
    return "\n".join(parts)



