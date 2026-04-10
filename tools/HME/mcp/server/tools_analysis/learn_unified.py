"""HME learn — unified KB tool.

Merges add_knowledge, remove_knowledge, and search_knowledge
into one tool with action auto-detection.
"""
import logging

from server import context as ctx
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
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
    action='health' → KB staleness check."""
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
