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
_EDIT_TOOLS = {"before_editing", "what_did_i_forget", "convention_check", "file_intel", "edit"}
_EXPLORE_TOOLS = {"find", "trace", "beat_snapshot", "search_code", "grep", "glob"}


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


import re as _re_budget

# Tool output budgets — per-tool char limits. Compound tools split budget across sub-reports.
# These are generous enough to never lose actionable data, tight enough to prevent context bloat.
BUDGET_TOOL = 5000       # single-mode tools (find, trace, review:digest, etc.)
BUDGET_COMPOUND = 8000   # compound tools (review:full, status:all, evolve:all)
BUDGET_SECTION = 2500    # per-section cap within compound tools
BUDGET_LOCAL_THINK = 2000  # max chars from _local_think() before trimming


def _budget_gate(text: str, budget: int = BUDGET_TOOL) -> str:
    """Rule-based output compression for MCP tool returns.

    Instant (no model calls). Preserves: file paths, line numbers, PASS/FAIL,
    errors, section headers, numbers. Compresses: long code blocks, verbose lists,
    redundant separators. Applied at MCP tool boundary only.
    """
    if not text or len(text) <= budget:
        return text

    sections = _re_budget.split(r'(?=^## )', text, flags=_re_budget.MULTILINE)
    if not sections:
        return text[:budget] + f"\n…(+{len(text) - budget} chars)"

    # Proportional budget per section, minimum 400 chars
    n = max(len(sections), 1)
    per_section = max(budget // n, 400)
    compressed = []

    for section in sections:
        if len(section) <= per_section:
            compressed.append(section)
            continue
        # Cap code fences to 8 lines
        section = _cap_code_blocks(section, max_lines=8)
        # Cap indented list items to 12
        section = _cap_list_items(section, max_items=12)
        # If still over section budget, preserve headers + truncate content
        if len(section) > per_section:
            lines = section.split("\n")
            kept = []
            size = 0
            for line in lines:
                line_cost = len(line) + 1
                if size + line_cost > per_section and not line.startswith("## "):
                    if not kept or (len(kept) == 1 and kept[0].startswith("## ")):
                        # First content line is oversized — truncate line, don't skip
                        kept.append(line[:per_section - size - 30] + "…")
                    remaining = len(lines) - len(kept)
                    if remaining > 0:
                        kept.append(f"  …(+{remaining} lines)")
                    break
                kept.append(line)
                size += line_cost
            section = "\n".join(kept)
        compressed.append(section)

    result = "".join(compressed)
    if len(result) > budget:
        result = result[:budget] + f"\n…(+{len(text) - budget} chars)"
    return result


def _cap_code_blocks(text: str, max_lines: int = 8) -> str:
    """Truncate fenced code blocks to max_lines, preserving the fence markers."""
    def _replace(m):
        fence_open = m.group(1)
        code = m.group(2)
        fence_close = m.group(3)
        lines = code.split("\n")
        if len(lines) <= max_lines:
            return m.group(0)
        kept = "\n".join(lines[:max_lines])
        return f"{fence_open}{kept}\n  ...({len(lines) - max_lines} more lines)\n{fence_close}"
    return _re_budget.sub(r'(```\w*\n)(.*?)(```)', _replace, text, flags=_re_budget.DOTALL)


def _cap_list_items(text: str, max_items: int = 12) -> str:
    """Cap consecutive indented list items (lines starting with 2+ spaces or - )."""
    lines = text.split("\n")
    result = []
    list_count = 0
    capped = False
    total_remaining = 0
    for line in lines:
        is_list = line.startswith("  ") or line.startswith("- ")
        if is_list:
            list_count += 1
            if list_count <= max_items:
                result.append(line)
            elif not capped:
                total_remaining += 1
            else:
                total_remaining += 1
        else:
            if list_count > max_items and not capped:
                result.append(f"  …(+{total_remaining} more items)")
                capped = True
                total_remaining = 0
            list_count = 0
            capped = False
            result.append(line)
    if list_count > max_items and not capped:
        result.append(f"  …(+{total_remaining} more items)")
    return "\n".join(result)


def _budget_section(text: str, budget: int = BUDGET_SECTION) -> str:
    """Apply budget to a single sub-report section within a compound tool."""
    return _budget_gate(text, budget=budget)


def _budget_local_think(text: str) -> str:
    """Trim _local_think output that exceeds the context budget.
    Rule-based: keeps conclusion/action sentences, drops verbose reasoning."""
    if not text or len(text) <= BUDGET_LOCAL_THINK:
        return text
    # Try to find conclusion markers and keep from there
    for marker in ["therefore", "the key", "in summary", "to summarize",
                    "recommendation", "suggested", "action:", "fix:"]:
        idx = text.lower().find(marker)
        if idx != -1 and len(text) - idx <= BUDGET_LOCAL_THINK:
            return text[idx:]
    # No marker: keep last BUDGET_LOCAL_THINK chars (conclusions tend to be at the end)
    return "…" + text[-(BUDGET_LOCAL_THINK - 1):]


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


_compositional_context_cache: dict = {}  # (module_name, digest_mtime, summary_mtime) → str


def _get_compositional_context(module_name: str) -> str:
    """Read narrative-digest.md and trace-summary.json for musical context.

    Searches narrative by module name AND related terms (subsystem keywords,
    camelCase fragments) to find mentions even when prose uses different phrasing.
    Mtime-cached to avoid redundant file I/O across compound tool calls.
    """
    digest_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "narrative-digest.md")
    summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
    try:
        d_mt = os.path.getmtime(digest_path) if os.path.isfile(digest_path) else 0.0
        s_mt = os.path.getmtime(summary_path) if os.path.isfile(summary_path) else 0.0
    except OSError:
        d_mt, s_mt = 0.0, 0.0
    cache_key = (module_name, d_mt, s_mt)
    if cache_key in _compositional_context_cache:
        return _compositional_context_cache[cache_key]

    parts = []
    # Build search terms: module name + camelCase fragments (specific enough to avoid noise)
    search_terms = {module_name.lower()}
    import re
    _generic = {"engine", "manager", "helper", "utils", "state", "config", "monitor", "controller"}
    fragments = re.findall(r'[A-Z]?[a-z]+', module_name)
    for frag in fragments:
        if len(frag) > 5 and frag.lower() not in _generic:
            search_terms.add(frag.lower())

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
        except Exception as _err1:
            logger.debug(f"parts.append: {type(_err1).__name__}: {_err1}")
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
        except Exception as _err2:
            logger.debug(f"parts.append: {type(_err2).__name__}: {_err2}")
    result = "\n".join(parts) if parts else ""
    _compositional_context_cache[cache_key] = result
    # Evict stale entries (keep cache bounded — only current mtime matters)
    stale = [k for k in _compositional_context_cache if k != cache_key and k[0] == module_name]
    for k in stale:
        del _compositional_context_cache[k]
    return result


_trace_cache: dict = {"path": "", "mtime": 0.0, "records": []}

# Git subprocess result cache — keyed by (cwd, args_tuple), TTL 30s
import time as _time_git
_git_cache: dict = {}
_GIT_CACHE_TTL = 30.0


def _git_run(args: list, cwd: str, timeout: int = 5) -> str:
    """Run a git command with 30s result caching. Returns stdout or ''."""
    import subprocess as _subprocess_git
    cache_key = (cwd, tuple(args))
    entry = _git_cache.get(cache_key)
    if entry and (_time_git.monotonic() - entry[0]) < _GIT_CACHE_TTL:
        return entry[1]
    try:
        r = _subprocess_git.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        result = r.stdout
    except Exception as _err:
        logger.debug(f"unnamed-except __init__.py:306: {type(_err).__name__}: {_err}")
        result = ""
    _git_cache[cache_key] = (_time_git.monotonic(), result)
    return result


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
            except Exception as _err:
                logger.debug(f"unnamed-except __init__.py:326: {type(_err).__name__}: {_err}")
                continue
    _trace_cache["path"] = trace_path
    _trace_cache["mtime"] = mt
    _trace_cache["records"] = records
    return records


# ---------------------------------------------------------------------------
# Import subpackages and register sys.modules aliases so that existing
# `from .synthesis_groq import X` imports resolve to the moved modules
# inside synthesis/, evolution/, coupling/ subpackages.
# ---------------------------------------------------------------------------
import sys as _sys
_PKG = __name__


def _alias_subpackage(subpkg_name, module_names):
    """Register sys.modules aliases so `from .module_name import X` works
    even though module_name.py moved into a subpackage directory."""
    for name in module_names:
        mod = _sys.modules.get(f"{_PKG}.{subpkg_name}.{name}")
        if mod:
            _sys.modules[f"{_PKG}.{name}"] = mod


# ── Import order: subpackages first (with immediate aliasing), then flat modules
from . import tool_cache  # noqa: E402, F401

# synthesis/ — 14 modules, aliased immediately so downstream imports resolve
from . import synthesis  # noqa: E402, F401
_alias_subpackage("synthesis", [
    "synthesis", "synthesis_cerebras", "synthesis_config", "synthesis_gemini",
    "synthesis_groq", "synthesis_llamacpp", "synthesis_mistral", "synthesis_nvidia",
    "synthesis_openrouter", "synthesis_pipeline", "synthesis_proxy_route",
    "synthesis_reasoning", "synthesis_session", "synthesis_warm",
    "synthesis_inference", "synthesis_cascade",
])

# coupling/ — 5 modules
from . import coupling  # noqa: E402, F401
_alias_subpackage("coupling", [
    "coupling", "coupling_bridges", "coupling_channels",
    "coupling_clusters", "coupling_data",
])

# evolution/ — 9 modules
from . import evolution  # noqa: E402, F401
_alias_subpackage("evolution", [
    "evolution", "evolution_admin", "evolution_evolve", "evolution_introspect",
    "evolution_invariants", "evolution_next", "evolution_selftest",
    "evolution_suggest", "evolution_trace", "evolution_strategies",
])

# ── Flat modules (import after subpackages are aliased)
from . import symbols          # noqa: E402, F401
from . import workflow         # noqa: E402, F401
from . import workflow_audit   # noqa: E402, F401
from . import reasoning        # noqa: E402, F401
from . import reasoning_think  # noqa: E402, F401
from . import health           # noqa: E402, F401
from . import runtime          # noqa: E402, F401
from . import composition      # noqa: E402, F401
from . import trust_analysis   # noqa: E402, F401
from . import digest           # noqa: E402, F401
from . import section_compare  # noqa: E402, F401
from . import perceptual       # noqa: E402, F401
from . import review_unified   # noqa: E402, F401
from . import read_unified     # noqa: E402, F401
from . import learn_unified    # noqa: E402, F401
from . import status_unified   # noqa: E402, F401
from . import trace_unified    # noqa: E402, F401
from . import todo             # noqa: E402, F401
from . import enrich_prompt    # noqa: E402, F401
from . import tools_passthru   # noqa: E402, F401

# Re-export synthesis functions for tools_knowledge.py compatibility
from .synthesis import (  # noqa: E402, F401
    _local_think, _think_local_or_claude,
    _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
