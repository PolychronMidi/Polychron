"""HME learn -- unified KB tool.

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
    learn(query='coupling') -> search KB.
    learn(title='...', content='...') -> add entry.
    learn(remove='entry_id') -> delete entry.
    action='list' -> list all entries (category filters).
    action='compact' -> deduplicate similar entries.
    action='export' -> export KB as markdown.
    action='graph' -> spreading-activation knowledge graph (uses query).
    action='dream' -> pairwise similarity pass, find hidden connections.
    action='health' -> KB durability/coverage check.
    action='hypothesize' -> register a hypothesis (title=claim, content=
      falsification criterion, tags=modules, query=round tag,
      listening_notes=initial evidence).
    action='hypothesis_test' -> record a test verdict (remove=id,
      content=CONFIRMED|REFUTED|INCONCLUSIVE, query=round,
      listening_notes=evidence).
    action='hypotheses' -> list hypotheses (category=OPEN|CONFIRMED|...)."""
    _track("learn")
    _act = action or ("add" if title else "search" if query else "other")
    append_session_narrative("kb_add" if _act == "add" else "search", f"learn({_act}): {title or query or action}")
    ctx.ensure_ready_sync()

    # Explicit action routing
    routed = dispatch(action, {
        "list": lambda: _list(category, scope),
        "compact": lambda: _compact(scope),
        "export": lambda: _export(scope, category),
        "graph": lambda: _graph(query or title or ""),
        "dream": _dream,
        "health": _health,
        "hypothesize": lambda: _hypothesize(title, content, tags, query, listening_notes),
        "hypothesis_test": lambda: _hypothesis_test(remove, content, query, listening_notes),
        "hypotheses": lambda: _hypotheses(category),
        "crystallize": _crystallize,
        "suggest_predecessors": lambda: _suggest_predecessors(title, content),
        "ground_truth": lambda: _ground_truth(title, content, tags, query, listening_notes),
    })
    if routed is not None:
        return routed

    # Remove action
    if remove:
        from server.tools_knowledge import remove_knowledge as _rk
        return _rk(remove, scope=scope)

    # consume tmp/hme-learn-draft.json and add to KB
    if action in ("accept_draft",) or (action == "add" and not (title and content)):
        import json as _json
        import os as _os
        _draft_path = _os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-learn-draft.json")
        if not _os.path.isfile(_draft_path):
            return ("No draft found at tmp/hme-learn-draft.json. "
                    "Drafts are auto-generated after a STABLE/EVOLVED pipeline run. "
                    "Pass title= and content= explicitly to add manually.")
        try:
            with open(_draft_path) as _df:
                _draft = _json.load(_df)
        except (OSError, ValueError) as _de:
            return f"Could not read draft: {_de}"
        from server.tools_knowledge import add_knowledge as _ak_d
        _ret = _ak_d(
            title=_draft.get("title", "untitled"),
            content=_draft.get("content", ""),
            category=_draft.get("category", "decision"),
            tags=_draft.get("tags", []),
            scope=scope,
        )
        try:
            _os.replace(_draft_path, _draft_path + ".accepted")
        except OSError:
            pass  # silent-ok: best-effort fs op
        return f"draft accepted -> {_ret}"

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
        search_cat = category if category and category != "general" else ""
        # emit BRIEF read-prior signal per camelCase token in query
        try:
            from .read_unified import _emit_brief_recorded
            import re as _re
            for _token in _re.findall(r'\b[a-z][a-zA-Z0-9]{5,}\b', search_term):
                if not any(c.isupper() for c in _token[1:]):
                    continue
                try:
                    _emit_brief_recorded(_token, source="learn_query")
                except Exception as _emit_err:
                    logger.warning(f"brief-recorded emit failed for {_token!r}: {type(_emit_err).__name__}: {_emit_err}")
        except ImportError as _brief_err:
            # read_unified is optional -- log at debug so planned
            logger.debug(f"brief-recorded import unavailable: {_brief_err}")
        return _sk(search_term, top_k=top_k, category=search_cat)

    return ("Error: provide query (search), title+content (add), remove=id (delete), or action=list/compact/export/graph/dream/health.\n"
            "Examples:\n"
            "  learn(query='coupling constraints')\n"
            "  learn(title='R49 fix', content='...', category='bugfix')\n"
            "  learn(remove='abc123')\n"
            "  learn(action='compact')\n"
            "  learn(action='health')")
