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


def _project_scope_tag() -> str:
    try:
        import json
        cfg = os.path.join(ctx.PROJECT_ROOT, "config", "project-adapter.json")
        with open(cfg, encoding="utf-8") as f:
            project_id = str(json.load(f).get("project_id") or "").strip()
        return f"project:{project_id}" if project_id else ""
    except Exception as exc:
        logger.debug("project scope tag unavailable: %s", exc)
        return ""


def add_knowledge(title: str, content: str, category: str = "general", tags: list[str] = [], scope: str = "project", related_to: str = "", relation_type: str = "", listening_notes: str = "") -> str:
    """Persist a knowledge entry to the KB. Tell the STORY, not just the fact: include WHY this matters musically, what the listener experiences when this constraint is violated, and what happened in the round that discovered it. Categories: 'architecture', 'decision', 'pattern', 'bugfix', 'general'. Use listening_notes to describe the musical effect ('coherent sections lost their sense of arrival'). Use related_to=<entry_id> with relation_type (caused_by, fixed_by, depends_on, contradicts, similar_to, supersedes) for knowledge_graph edges. Scope 'project'/'global'/'both'."""
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("kb", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
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
    project_tag_list = list(tag_list)
    project_tag = _project_scope_tag()
    if project_tag and project_tag not in project_tag_list:
        project_tag_list.append(project_tag)
    results = []

    # Horizon III asymptote -- auto-densification. When the caller didn't
    auto_predecessor_note = ""
    has_explicit_relation = bool(related_to) or any(
        ":" in t and len(t.split(":", 1)[1]) >= 8 for t in tag_list
    )
    if not has_explicit_relation:
        try:
            import math as _math
            cand_vec = ctx.shared_model.encode([f"{title} {content}".strip()])[0]
            cand_norm = _math.sqrt(sum(float(x) * float(x) for x in cand_vec)) or 1.0
            tbl = ctx.project_engine.knowledge_table
            if tbl is not None:
                df = tbl.to_pandas()
                top = (None, 0.0, "")
                for _, row in df.iterrows():
                    v = row.get("vector")
                    if v is None:
                        continue
                    try:
                        vlist = list(v)
                        if len(vlist) != len(cand_vec):
                            continue
                        v_norm = _math.sqrt(sum(float(x) * float(x) for x in vlist)) or 1.0
                        dot = sum(float(a) * float(b) for a, b in zip(cand_vec, vlist))
                        sim = dot / (cand_norm * v_norm)
                    except Exception as _exc:
                        # silent-ok: optional fallback path.
                        continue
                    if sim > top[1]:
                        top = (str(row.get("id", "")), sim, str(row.get("title", "")))
                if top[0] and top[1] >= 0.70:
                    # Strong match -- auto-set related_to with derived_from.
                    related_to = top[0]
                    relation_type = relation_type or "derived_from"
                    auto_predecessor_note = (
                        f"  (i) Auto-densification (Horizon III): linked as "
                        f"`derived_from:{top[0][:8]}` ({top[1]:.2f} similarity, "
                        f"title: {top[2][:40]})"
                    )
                elif top[0] and top[1] >= 0.50:
                    auto_predecessor_note = (
                        f"  (i) Suggested predecessor (Horizon III): "
                        f"[{top[0][:8]}] {top[2][:40]} (similarity {top[1]:.2f})\n"
                        f"     Re-add with tags=\"derived_from:{top[0]}\" if confirming."
                    )
        except Exception as _e:
            logger.debug("auto-predecessor scan failed: %s", _e)

    if scope in ("project", "both"):
        r = ctx.project_engine.add_knowledge(
            title=title,
            content=content,
            category=category,
            tags=project_tag_list,
            related_to=related_to,
            relation_type=relation_type,
        )
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

    # Incremental warm context update -- batched and parallelized across all 3 models.
    # Debounced 3s so rapid-fire learn() calls coalesce into one llama.cpp round-trip.
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
    if auto_predecessor_note:
        base += "\n" + auto_predecessor_note
    return base + contradiction_warning if not contradiction_warning else base + "\n\n" + contradiction_warning


def _check_kb_contradictions(title: str, content: str, engine) -> str:
    """Check if a new KB entry contradicts existing entries. Returns warning string or empty."""
    try:
        related = engine.search_knowledge(f"{title} {content}", top_k=5)
    except Exception as _err:
        logger.debug(f"unnamed-except tools_knowledge.py:79: {type(_err).__name__}: {_err}")
        return ""
    candidates = [e for e in related
                  if (_s := e.get("score")) is not None and 0.3 < _s < 0.9]
    if not candidates:
        return ""

    batch = []
    for i, e in enumerate(candidates[:3]):
        batch.append(
            f"EXISTING {i + 1} [{e['id']}] \"{e['title']}\": {e['content'][:300]}"
        )

    try:
        from server.tools_analysis.synthesis import (
            local_think as _local_think,
            LOCAL_MODEL as _LOCAL_MODEL,
        )
        prompt = (
            f"Does this new knowledge base entry make claims INCOMPATIBLE with any existing entry?\n\n"
            f"NEW ENTRY: \"{title}\"\n{content[:400]}\n\n"
            + "\n".join(batch) + "\n\n"
            "CONTRADICT = incompatible claims about the SAME thing (one says increase, other says decrease).\n"
            "OK = different topics, complementary, or one extends/supersedes the other.\n\n"
            "For each existing entry, respond with ONE line:\n"
            "EXISTING N: CONTRADICT -- <the specific incompatible claims>\n"
            "or\n"
            "EXISTING N: OK\n"
        )
        result = _local_think(
            prompt, max_tokens=300, model=_LOCAL_MODEL,
            system="You are a strict KB consistency checker. You RARELY flag contradictions. When in doubt, say OK.",
            temperature=0.05,
        )
    except Exception as _err:
        logger.debug(f"unnamed-except tools_knowledge.py:109: {type(_err).__name__}: {_err}")
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
                explanation_text = line.split("CONTRADICT")[1].strip().lstrip("--").lstrip("-").strip()
                if any(m in explanation_text.lower() for m in omission_markers):
                    continue
                num = int(line.split("EXISTING")[1].split(":")[0].strip()) - 1
                explanation = line.split("CONTRADICT")[1].strip().lstrip("--").lstrip("-").strip()
                if 0 <= num < len(candidates):
                    e = candidates[num]
                    warnings.append(
                        f"  [!] CONTRADICTS [{e['id']}] \"{e['title']}\": {explanation}\n"
                        f"    -> Tag: learn(..., related_to='{e['id']}', relation_type='contradicts')"
                    )
            except (ValueError, IndexError):
                continue

    if not warnings:
        return ""
    return "[!] CONTRADICTION WARNING:\n" + "\n".join(warnings)



def search_knowledge(query: str, top_k: int = 5, category: str = "") -> str:
    """Search the persistent knowledge base for constraints, decisions, patterns, and bugfixes. MANDATORY before modifying any module -- always check for existing constraints first. Returns matching entries from both project and global KBs, ranked by relevance. Filter by category ('architecture', 'decision', 'pattern', 'bugfix') to narrow results. Each result includes ID, title, content, tags, and relevance score."""
    _track("search_knowledge")
    ctx.ensure_ready_sync()
    top_k = max(1, min(20, top_k))
    cat = category if category else None

    proj_results = ctx.project_engine.search_knowledge(query, top_k=top_k, category=cat)
    glob_results = ctx.global_engine.search_knowledge(query, top_k=top_k, category=cat)

    # Drop hard-zero scores: cross-encoder rerank clamps negatives to 0,
    proj_results = [r for r in proj_results
                    if (_s := r.get("score")) is not None and _s > 0]
    glob_results = [r for r in glob_results
                    if (_s := r.get("score")) is not None and _s > 0]

    if not proj_results and not glob_results:
        try:
            from tool_invocations import i_form as _i_form
            _hint = _i_form('learn', primer=True)
        except ImportError:
            _hint = "i/learn title=... content=..."
        return f"No knowledge entries found. Use `{_hint}` to build the knowledge base."

    parts = []

    if proj_results:
        lines = []
        for i, r in enumerate(proj_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {fmt_score(r['score'])})\n"
                f"{r['content']}"
            )
        parts.append("Project Knowledge\n" + "\n\n\n\n".join(lines))

    if glob_results:
        lines = []
        for i, r in enumerate(glob_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {fmt_score(r['score'])})\n"
                f"{r['content']}"
            )
        parts.append("Global Knowledge\n" + "\n\n\n\n".join(lines))

    return "\n\n".join(parts)



def remove_knowledge(entry_id: str, scope: str = "project") -> str:
    """Delete a knowledge entry by its ID. Use after kb_health identifies stale entries, or when a decision has been superseded. Specify scope='global' to remove from the shared KB instead of the project KB."""
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("kb", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
    ctx.ensure_ready_sync()
    if not entry_id.strip():
        return "Error: entry_id cannot be empty."
    engine = ctx.global_engine if scope == "global" else ctx.project_engine
    ok = engine.remove_knowledge(entry_id)
    if ok:
        ctx._kb_version = getattr(ctx, "_kb_version", 0) + 1
        # Inject tombstone into warm contexts -- cheap (~1-2s) vs full re-prime (~30s).
        try:
            from server.tools_analysis.synthesis_warm import queue_tombstone
            queue_tombstone(entry_id=entry_id, new_kb_ver=ctx._kb_version)
        except Exception as _err1:
            logger.debug(f"queue_tombstone: {type(_err1).__name__}: {_err1}")
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
    """Deduplicate the knowledge base by merging entries with high semantic similarity. Use after 30+ entries accumulate. The threshold (0.0-1.0) controls how similar entries must be to merge -- 0.85 is a good default. Returns counts of removed vs kept entries. Scope can be 'project', 'global', or 'both'."""
    ctx.ensure_ready_sync()
    clamped = max(0.5, min(1.0, threshold))
    notes = []
    if clamped != threshold:
        notes.append(f"Note: threshold {threshold} clamped to {clamped} (valid range 0.5-1.0).")
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

    return "\n\n\n\n".join(parts)




# Re-export -- memory_dream extracted to sibling.
from .tools_knowledge_dream import memory_dream  # noqa: F401, E402
