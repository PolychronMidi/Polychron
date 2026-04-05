import os
import json
import math
import logging

logger = logging.getLogger("HME")

# ---------------------------------------------------------------------------
# Project rules — loaded from config/project-rules.json at import time.
# Logic stays in Python; declarations live in config. Add new rules there.
# ---------------------------------------------------------------------------
def _load_project_rules() -> dict:
    config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config", "project-rules.json")
    try:
        with open(os.path.realpath(config_path), encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Acceptable warning: helpers: could not load project-rules.json: %s", e)
        return {}

_PROJECT_RULES = _load_project_rules()

CROSSLAYER_BOUNDARY_VIOLATIONS: list[str] = _PROJECT_RULES.get("crosslayer_boundary_violations", [
    "conductorIntelligence.", "conductorState.",
    "systemDynamicsProfiler.", "pipelineCouplingManager.",
])
KNOWN_L0_CHANNELS: frozenset[str] = frozenset(_PROJECT_RULES.get("known_l0_channels", []))
DRY_PATTERNS: list[dict] = _PROJECT_RULES.get("dry_patterns", [])
DOC_UPDATE_TRIGGERS: dict[str, list[str]] = _PROJECT_RULES.get("doc_update_triggers", {})
KNOWN_NON_TOOL_IDENTIFIERS: frozenset[str] = frozenset(_PROJECT_RULES.get("known_non_tool_identifiers", []))
REGISTRATION_PATTERNS: list[str] = _PROJECT_RULES.get("registration_patterns", [
    "conductorIntelligence.register",
    "crossLayerRegistry.register",
    "feedbackRegistry.register",
])
COUPLING_MATRIX_EXEMPT_PATHS: list[str] = _PROJECT_RULES.get("coupling_matrix_exempt_paths", [])
COUPLING_MATRIX_LEGACY_PATHS: list[str] = _PROJECT_RULES.get("coupling_matrix_legacy_paths", [])
SUBSYSTEM_NAMES: list[str] = _PROJECT_RULES.get("subsystem_names", [
    "conductor", "crossLayer", "composers", "rhythm", "fx", "time", "play", "writer",
])
_lct = _PROJECT_RULES.get("line_count_thresholds", {})
LINE_COUNT_TARGET: int = _lct.get("target", 200)
LINE_COUNT_WARN: int = _lct.get("warn", 250)
LINE_COUNT_CRITICAL: int = _lct.get("critical", 300)

# Budget-aware limits for composite tool output — full 4-step scaling
BUDGET_LIMITS = {
    "greedy":       {"kb_entries": 10, "callers": 20, "symbols": 25, "kb_content": 400, "similar": 5},
    "moderate":     {"kb_entries": 5,  "callers": 10, "symbols": 15, "kb_content": 200, "similar": 3},
    "conservative": {"kb_entries": 3,  "callers": 6,  "symbols": 10, "kb_content": 120, "similar": 1},
    "minimal":      {"kb_entries": 1,  "callers": 3,  "symbols": 5,  "kb_content": 60,  "similar": 0},
}


def get_context_budget() -> str:
    """Read context-window pressure from status line. Returns 'greedy', 'moderate', 'conservative', or 'minimal'."""
    try:
        with open("/tmp/claude-context.json") as _f:
            ctx = json.load(_f)
        remaining = ctx.get("remaining_pct", 50)
        if remaining > 75:
            return "greedy"
        elif remaining > 50:
            return "moderate"
        elif remaining > 25:
            return "conservative"
        else:
            return "minimal"
    except Exception:
        return "moderate"


def validate_project_path(file_path: str, project_root: str) -> str | None:
    """Resolve path and ensure it's within PROJECT_ROOT. Returns abs path or None."""
    expanded = os.path.expanduser(file_path)
    abs_path = expanded if os.path.isabs(expanded) else os.path.join(project_root, expanded)
    abs_path = os.path.realpath(abs_path)
    if not abs_path.startswith(os.path.realpath(project_root)):
        return None
    return abs_path


def fmt_score(score) -> str:
    """Format a cross-encoder logit score as a human-readable percentage via sigmoid."""
    if not isinstance(score, (int, float)):
        return "?"
    if score <= 0:
        return "0%"
    # Sigmoid maps raw logits to [0,1]: logit 9 → ~100%, logit 2 → ~88%, logit 0.1 → ~52%
    sig = 1.0 / (1.0 + math.exp(-float(score)))
    return f"{sig:.0%}"


def fmt_sim_score(score) -> str:
    """Format a similarity score already in [0,1] range (vector distance, cosine, etc.)."""
    if not isinstance(score, (int, float)):
        return "?"
    return f"{max(0.0, min(1.0, float(score))):.0%}"


def format_knowledge_results(results: list[dict], label: str, min_score: float = 0.01) -> list[str]:
    # Filter out zero-score results — these are negative cross-encoder scores clamped to 0,
    # meaning the entry is irrelevant to this query. Showing them is pure noise.
    results = [r for r in results if r.get("score", 0) >= min_score]
    if not results:
        return []
    lines = []
    for k in results:
        tags_str = ", ".join(k["tags"]) if k["tags"] else ""
        lines.append(
            f"  [{k['category']}] {k['title']} (score: {fmt_score(k['score'])}){' | ' + tags_str if tags_str else ''}\n"
            f"  {k['content']}"
        )
    return [f"=== {label} ===\n" + "\n\n".join(lines)]


def check_path_in_project(path: str, project_root: str) -> str | None:
    """Check a directory path is within project root. Returns error string or None if OK."""
    target = os.path.join(project_root, path) if not os.path.isabs(path) else path
    if not os.path.realpath(target).startswith(os.path.realpath(project_root)):
        return f"Error: path '{path}' is outside the project root."
    return None
