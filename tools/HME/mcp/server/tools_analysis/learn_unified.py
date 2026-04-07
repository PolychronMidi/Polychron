"""HME learn — unified KB tool.

Merges add_knowledge, remove_knowledge, and search_knowledge
into one tool with action auto-detection.
"""
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def learn(query: str = "", title: str = "", content: str = "",
          category: str = "general", tags: list[str] = [],
          remove: str = "", scope: str = "project",
          related_to: str = "", relation_type: str = "",
          listening_notes: str = "", top_k: int = 5) -> str:
    """Unified KB interface. Auto-detects action:
    learn(query='coupling') → search KB.
    learn(title='...', content='...') → add entry.
    learn(remove='entry_id') → delete entry.
    All parameters from add_knowledge/search_knowledge/remove_knowledge
    are supported."""
    _track("learn")
    ctx.ensure_ready_sync()

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
        return _sk(search_term, top_k=top_k, category=category)

    return ("Error: provide query (search), title+content (add), or remove=id (delete).\n"
            "Examples:\n"
            "  learn(query='coupling constraints')\n"
            "  learn(title='R49 fix', content='...', category='bugfix')\n"
            "  learn(remove='abc123')")
