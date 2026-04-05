"""HyperMeta-Ecstasy analysis tools — split into focused modules.

Import order matters: synthesis first (no tool dependencies), then modules that
register @ctx.mcp.tool() decorators. All tools auto-register at import time.
"""
import json
import os
import logging

from server import context as ctx

logger = logging.getLogger("HyperMeta-Ecstasy")

# ---------------------------------------------------------------------------
# Shared lightweight helpers used by multiple sub-modules
# ---------------------------------------------------------------------------

_usage_stats: dict[str, int] = {}


def _track(name: str):
    _usage_stats[name] = _usage_stats.get(name, 0) + 1


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
            content = open(digest_path, encoding="utf-8").read()
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
            regimes = summary.get("regimeDistribution", {})
            if regimes:
                regime_str = ", ".join(f"{k}: {v:.0%}" for k, v in regimes.items()
                                       if isinstance(v, (int, float)))
                parts.append(f"**Last run regimes:** {regime_str}")
            coupling = summary.get("aggregateCouplingLabels", {})
            if coupling:
                labels = [str(k) for k in list(coupling.keys())[:6]]
                parts.append(f"**Coupling labels:** {', '.join(labels)}")
            trust = summary.get("trustStats", {})
            if trust:
                top_systems = sorted(trust.items(), key=lambda x: -x[1] if isinstance(x[1], (int, float)) else 0)[:3]
                if top_systems:
                    parts.append(f"**Top trust systems:** {', '.join(f'{k}: {v:.2f}' for k, v in top_systems if isinstance(v, (int, float)))}")
        except Exception:
            pass
    return "\n".join(parts) if parts else ""


# Import sub-modules to register tools (order: synthesis first, then tools)
from . import synthesis  # noqa: E402, F401 — synthesis engine (no tools, just helpers)
from . import symbols    # noqa: E402, F401
from . import workflow   # noqa: E402, F401
from . import reasoning  # noqa: E402, F401
from . import health     # noqa: E402, F401
from . import evolution  # noqa: E402, F401
from . import runtime      # noqa: E402, F401
from . import composition    # noqa: E402, F401
from . import trust_analysis  # noqa: E402, F401
from . import digest             # noqa: E402, F401
from . import section_compare    # noqa: E402, F401
from . import perceptual         # noqa: E402, F401

# Re-export synthesis functions for tools_knowledge.py compatibility
from .synthesis import (  # noqa: E402, F401
    _get_api_key, _local_think, _think_local_or_claude, _claude_think,
    _format_kb_corpus, _THINK_MODEL, _warm_cache,
    _get_max_tokens, _get_effort, _get_tool_budget,
)
