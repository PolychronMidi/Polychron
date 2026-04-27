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

    if action == "promote_discovery":
        # Phase 6.4 (R97) — promote a synthesized discovery draft from
        # metrics/hme-discoveries-draft.jsonl into the human-curated
        # doc/hme-discoveries.md. Requires:
        #   - `remove` = draft id (12-char hex)
        #   - draft must have promotable=true (stable across ≥3 runs)
        # Optional:
        #   - `listening_notes` = human annotation appended to the entry
        from .discovery_promote import promote_discovery as _pd
        return _pd(
            draft_id=remove,
            annotation=listening_notes or content or "",
        )

    if action == "discoveries":
        # List all drafts with their stability + promotable status.
        from .discovery_promote import list_discoveries as _ld
        return _ld()

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

    # Accept-draft action: consume tmp/hme-learn-draft.json (written by
    # posttooluse_bash on STABLE/EVOLVED verdict) and add it to KB.
    # Triggered by `i/learn action=add accept_draft=true` or
    # `i/learn action=accept_draft`. Lets the agent commit a round's
    # learning with one tool call instead of inventing wording.
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
            pass
        return f"draft accepted → {_ret}"

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
        # Tool-layer BRIEF emission: a KB search IS a read-prior signal if
        # the query mentions a module name. Emit for any camelCase token ≥6
        # chars that looks like a module identifier. Narrow try around
        # each token — the previous single outer try meant one bad emit
        # aborted the whole loop so later tokens in the same query were
        # never recorded.
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
            # read_unified is optional — log at debug so planned
            # environments without it don't spam but any regression
            # (module vanished mid-session) is still visible.
            logger.debug(f"brief-recorded import unavailable: {_brief_err}")
        return _sk(search_term, top_k=top_k, category=search_cat)

    return ("Error: provide query (search), title+content (add), remove=id (delete), or action=list/compact/export/graph/dream/health.\n"
            "Examples:\n"
            "  learn(query='coupling constraints')\n"
            "  learn(title='R49 fix', content='...', category='bugfix')\n"
            "  learn(remove='abc123')\n"
            "  learn(action='compact')\n"
            "  learn(action='health')")
