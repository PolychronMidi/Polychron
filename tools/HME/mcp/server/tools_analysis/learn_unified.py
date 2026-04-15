"""HME learn — unified KB tool.

Merges add_knowledge, remove_knowledge, and search_knowledge
into one tool with action auto-detection.
"""
import logging

from server import context as ctx
from server.onboarding_chain import chained
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
@chained("learn")
def learn(query: str = "", title: str = "", content: str = "",
          category: str = "general", tags: list[str] = [],
          remove: str = "", scope: str = "project",
          related_to: str = "", relation_type: str = "",
          listening_notes: str = "", top_k: int = 5,
          action: str = "") -> str:
    """Unified KB interface. Auto-detects action from parameters:
    learn(query='coupling') → search KB.
    learn(title='...', content='...') → add entry.
    learn(remove='entry_id') → delete entry.
    action='list' → list all entries (category filters).
    action='compact' → deduplicate similar entries.
    action='export' → export KB as markdown.
    action='graph' → spreading-activation knowledge graph (uses query).
    action='dream' → pairwise similarity pass, find hidden connections.
    action='health' → KB staleness check.
    action='hypothesize' → register a hypothesis (title=claim, content=
      falsification criterion, tags=modules, query=round tag,
      listening_notes=initial evidence).
    action='hypothesis_test' → record a test verdict (remove=id,
      content=CONFIRMED|REFUTED|INCONCLUSIVE, query=round,
      listening_notes=evidence).
    action='hypotheses' → list hypotheses (category=OPEN|CONFIRMED|...)."""
    _track("learn")
    _act = action or ("add" if title else "search" if query else "other")
    append_session_narrative("kb_add" if _act == "add" else "search", f"learn({_act}): {title or query or action}")
    ctx.ensure_ready_sync()

    # Explicit action routing
    if action == "list":
        from server.tools_knowledge import list_knowledge as _lk
        return _lk(category=category, scope=scope)

    if action == "compact":
        from server.tools_knowledge import compact_knowledge as _ck
        return _ck(scope=scope)

    if action == "export":
        from server.tools_knowledge import export_knowledge as _ek
        return _ek(scope=scope, category=category)

    if action == "graph":
        from server.tools_knowledge import knowledge_graph as _kg
        return _kg(query or title or "")

    if action == "dream":
        from server.tools_knowledge import memory_dream as _md
        return _md()

    if action == "health":
        from server.tools_knowledge import kb_health as _kbh
        return _kbh()

    # Hypothesis lifecycle — Phase 3.1 of openshell_features_to_mimic.md
    if action == "hypothesize":
        # title = claim, content = falsification criterion, tags = modules,
        # query = proposer round tag (R93 etc), listening_notes = initial evidence
        from .hypothesis_registry import add_hypothesis as _ah
        return _ah(
            claim=title,
            falsification=content,
            modules=list(tags) if tags else [],
            round_tag=query,
            evidence=listening_notes,
        )

    if action == "hypothesis_test":
        # remove = hypothesis id, content = verdict, query = round,
        # listening_notes = evidence
        from .hypothesis_registry import test_hypothesis as _th
        return _th(
            hypothesis_id=remove,
            verdict=content,
            round_tag=query,
            evidence=listening_notes,
        )

    if action == "hypotheses":
        from .hypothesis_registry import hypotheses_report as _hr
        return _hr(status_filter=category if category != "general" else "")

    if action == "crystallize":
        from .crystallizer import crystallize_cli as _cc
        return _cc()

    if action == "ground_truth":
        # Phase 5.5 — human ground-truth feedback. We reuse the learn()
        # parameter surface: title=section, tags[0]=moment_type,
        # tags[1]=sentiment, query=round_tag, content=comment,
        # listening_notes=also-comment (either works).
        from .ground_truth import record_ground_truth as _gt
        _moment = tags[0] if tags and len(tags) > 0 else ""
        _sent = tags[1] if tags and len(tags) > 1 else ""
        _comment = content or listening_notes or ""
        return _gt(
            section=title,
            moment_type=_moment,
            sentiment=_sent,
            comment=_comment,
            round_tag=query,
        )

    # Remove action
    if remove:
        from server.tools_knowledge import remove_knowledge as _rk
        return _rk(remove, scope=scope)

    # Add action (title + content provided)
    if title and content:
        from server.tools_knowledge import add_knowledge as _ak
        return _ak(title=title, content=content, category=category,
                   tags=tags, scope=scope, related_to=related_to,
                   relation_type=relation_type, listening_notes=listening_notes)

    # Search action (query provided, or title without content = search)
    search_term = query or title
    if search_term:
        from server.tools_knowledge import search_knowledge as _sk
        # Only filter by category if explicitly set (not the default 'general')
        search_cat = category if category and category != "general" else ""
        return _sk(search_term, top_k=top_k, category=search_cat)

    return ("Error: provide query (search), title+content (add), remove=id (delete), or action=list/compact/export/graph/dream/health.\n"
            "Examples:\n"
            "  learn(query='coupling constraints')\n"
            "  learn(title='R49 fix', content='...', category='bugfix')\n"
            "  learn(remove='abc123')\n"
            "  learn(action='compact')\n"
            "  learn(action='health')")
