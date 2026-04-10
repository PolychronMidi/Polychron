"""HME analysis tools — split into focused modules.

Import order matters: synthesis first (no tool dependencies), then modules that
register @ctx.mcp.tool() decorators. All tools auto-register at import time.
"""
import json
import os
import logging

from server import context as ctx

logger = logging.getLogger("HME")

# ---------------------------------------------------------------------------
# Shared lightweight helpers used by multiple sub-modules
# ---------------------------------------------------------------------------

_usage_stats: dict[str, int] = {}

# Session intent tracking: detect audit vs focused editing patterns
_session_intent: str = "unknown"  # "audit", "editing", "exploring", "unknown"
_AUDIT_TOOLS = {"status", "review", "coupling_intel", "codebase_health", "trust_report", "channel_topology"}
_EDIT_TOOLS = {"before_editing", "what_did_i_forget", "convention_check", "file_intel"}
_EXPLORE_TOOLS = {"find", "trace", "beat_snapshot", "search_code", "grep"}


def _track(name: str):
    global _session_intent
    _usage_stats[name] = _usage_stats.get(name, 0) + 1
    # Update session intent based on tool usage pattern
    total = sum(_usage_stats.values())
    if total < 3:
        return  # too early to classify
    audit_count = sum(_usage_stats.get(t, 0) for t in _AUDIT_TOOLS)
    edit_count = sum(_usage_stats.get(t, 0) for t in _EDIT_TOOLS)
    explore_count = sum(_usage_stats.get(t, 0) for t in _EXPLORE_TOOLS)
    if audit_count > edit_count and audit_count > explore_count:
        _session_intent = "audit"
    elif edit_count > audit_count:
        _session_intent = "editing"
    elif explore_count > audit_count:
        _session_intent = "exploring"
    else:
        _session_intent = "unknown"


def get_session_intent() -> str:
    """Return the detected session intent: audit, editing, exploring, or unknown.
    Tools can use this to adjust verbosity — audit sessions want maximum data density,
    editing sessions want concise KB constraints only."""
    return _session_intent


def _filter_kb_relevance(kb_results: list, module_name: str) -> list:
    """Post-filter KB results to only include entries actually relevant to the module.

    With few KB entries, semantic search returns everything. This keyword filter
    checks whether the module name or its camelCase fragments appear in the entry's
    title, content, or tags. Entries with no keyword overlap are noise.
    """
    import re
    # Build search terms from camelCase fragments
    # Full module name always searched; fragments only if specific enough (>5 chars, not generic)
    _generic_fragments = {"engine", "manager", "helper", "utils", "state", "config", "monitor", "controller"}
    terms = {module_name.lower()}
    fragments = re.findall(r'[A-Z]?[a-z]+', module_name)
    for frag in fragments:
        if len(frag) > 5 and frag.lower() not in _generic_fragments:
            terms.add(frag.lower())

    filtered = []
    for entry in kb_results:
        haystack = (entry.get("title", "") + " " + entry.get("content", "")[:300]
                     + " " + " ".join(entry.get("tags", []) if isinstance(entry.get("tags"), list) else [str(entry.get("tags", ""))])).lower()
        # Word-boundary match: "section" should match "section memory" but not "maxPerSection"
        if any(re.search(r'(?<![a-z])' + re.escape(term) + r'(?![a-z])', haystack) for term in terms):
            filtered.append(entry)
    return filtered  # no fallback — irrelevant KB entries are worse than no entries


def _get_compositional_context(module_name: str) -> str:
    """Read narrative-digest.md and trace-summary.json for musical context.

    Searches narrative by module name AND related terms (subsystem keywords,
    camelCase fragments) to find mentions even when prose uses different phrasing.
    """
    parts = []
    # Build search terms: module name + camelCase fragments (specific enough to avoid noise)
    search_terms = {module_name.lower()}
    import re
    _generic = {"engine", "manager", "helper", "utils", "state", "config", "monitor", "controller"}
    fragments = re.findall(r'[A-Z]?[a-z]+', module_name)
    for frag in fragments:
        if len(frag) > 5 and frag.lower() not in _generic:
            search_terms.add(frag.lower())

    digest_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "narrative-digest.md")
    if os.path.isfile(digest_path):
        try:
            with open(digest_path, encoding="utf-8") as _f:
                content = _f.read()
            matched = []
            for line in content.split("\n"):
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                line_lower = stripped.lower()
                # Match if any search term appears
                if any(term in line_lower for term in search_terms):
                    matched.append(stripped)
            if matched:
                parts.append("**Narrative mentions:**")
                for l in matched[:5]:
                    parts.append(f"  {l[:200]}")
        except Exception:
            pass
    summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
    if os.path.isfile(summary_path):
        try:
            with open(summary_path) as f:
                summary = json.load(f)
            regimes = summary.get("regimes", {})
            if regimes:
                total_r = sum(v for v in regimes.values() if isinstance(v, (int, float))) or 1
                regime_str = ", ".join(f"{k}: {v/total_r:.0%}" for k, v in regimes.items()
                                       if isinstance(v, (int, float)))
                parts.append(f"**Last run regimes:** {regime_str}")
            coupling = summary.get("aggregateCouplingLabels", {})
            if coupling:
                labels = [str(k) for k in list(coupling.keys())[:6]]
                parts.append(f"**Coupling labels:** {', '.join(labels)}")
            trust_dom = summary.get("trustDominance", {})
            dominant = trust_dom.get("dominantSystems", []) if isinstance(trust_dom, dict) else []
            if dominant:
                top = [f"{s['system']}({s.get('score', 0):.2f})" for s in dominant[:3]]
                parts.append(f"**Top trust systems:** {', '.join(top)}")
        except Exception:
            pass
    return "\n".join(parts) if parts else ""


_trace_cache: dict = {"path": "", "mtime": 0.0, "records": []}


def _load_trace(trace_path: str) -> list[dict]:
    """Load trace.jsonl with mtime-based caching. Shared by composition/trust/section tools."""
    import json as _json
    try:
        mt = os.path.getmtime(trace_path)
    except OSError:
        return []
    if _trace_cache["path"] == trace_path and _trace_cache["mtime"] == mt:
        return _trace_cache["records"]
    records = []
    with open(trace_path, encoding="utf-8") as f:
        for line in f:
            try:
                records.append(_json.loads(line))
            except Exception:
                continue
    _trace_cache["path"] = trace_path
    _trace_cache["mtime"] = mt
    _trace_cache["records"] = records
    return records


# Import sub-modules to register tools (order: synthesis first, then tools)
from . import synthesis  # noqa: E402, F401 — synthesis engine (no tools, just helpers)
from . import symbols    # noqa: E402, F401
from . import workflow        # noqa: E402, F401
from . import workflow_audit  # noqa: E402, F401
from . import reasoning        # noqa: E402, F401
from . import reasoning_think  # noqa: E402, F401
from . import health           # noqa: E402, F401
from . import evolution  # noqa: E402, F401
from . import runtime      # noqa: E402, F401
from . import composition    # noqa: E402, F401
from . import trust_analysis  # noqa: E402, F401
from . import digest             # noqa: E402, F401
from . import section_compare    # noqa: E402, F401
from . import perceptual         # noqa: E402, F401
from . import evolution_next     # noqa: E402, F401
from . import coupling           # noqa: E402, F401
from . import evolution_evolve   # noqa: E402, F401
from . import search_unified     # noqa: E402, F401
from . import review_unified     # noqa: E402, F401
from . import read_unified       # noqa: E402, F401
from . import learn_unified      # noqa: E402, F401
from . import status_unified     # noqa: E402, F401
from . import trace_unified      # noqa: E402, F401
from . import todo               # noqa: E402, F401
from . import prompt_enricher    # noqa: E402, F401

# Re-export synthesis functions for tools_knowledge.py compatibility
from .synthesis import (  # noqa: E402, F401
    _local_think, _think_local_or_claude,
    _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
