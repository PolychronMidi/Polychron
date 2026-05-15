"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import logging
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _resolve, _excluded, _is_regex
import time
import datetime

logger = logging.getLogger("HME")



def _check_symbols_have_kb(inv: dict) -> tuple[bool, str]:
    """Top-N highest-caller IIFE globals must each have at least one KB entry."""
    if ctx.project_engine is None:
        return True, "engine not available -- skipped (pipeline context)"
    from tools_analysis.health_analysis import _compute_iife_caller_counts
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    _, caller_counts, _ = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)
    if not caller_counts:
        return False, "no IIFE globals found"
    top_n = inv.get("top_n", 10)
    min_callers = inv.get("min_callers", 5)
    ranked = sorted(
        [(n, c) for n, c in caller_counts.items() if c >= min_callers],
        key=lambda x: -x[1]
    )[:top_n]
    if not ranked:
        return True, "no modules meet min_callers threshold"
    kb_titles_lower: set[str] = set()
    kb_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp", "rag_data", "project_knowledge")
    if os.path.isdir(kb_dir):
        for kb_file in globmod.glob(os.path.join(kb_dir, "*.json")):
            try:
                with open(kb_file, encoding="utf-8") as _f:
                    kb_entry = json.load(_f)
                title = kb_entry.get("title", "").lower()
                content = kb_entry.get("content", "").lower()
                kb_titles_lower.add(title + " " + content[:200])
            except Exception as _err:
                logger.debug(f"unnamed-except evolution_invariants.py:226: {type(_err).__name__}: {_err}")
                continue

    uncovered = []
    for name, _ in ranked:
        name_lower = name.lower()
        # Primary: semantic search; fallback: title/content text scan
        hits = ctx.project_engine.search_knowledge(name, top_k=1)
        if not hits:
            found = any(name_lower in text for text in kb_titles_lower)
            if not found:
                uncovered.append(name)
    if uncovered:
        return False, f"{len(uncovered)}/{len(ranked)} uncovered: {', '.join(uncovered)}"
    return True, f"all {len(ranked)} top-caller modules have KB entries"


def _is_regex(s: str) -> bool:
    return any(c in s for c in r"\.[](){}*+?^$|")


def _check_kb_freshness(inv: dict) -> tuple[bool, str]:
    """Warn if no KB entry has been updated within max_age_days days (staleness signal)."""
    if ctx.project_engine is None:
        return True, "engine not available -- skipped (pipeline context)"
    import time
    max_age_days = inv.get("max_age_days", 14)
    entries = ctx.project_engine.list_knowledge_full()
    if not entries:
        return True, "KB empty"
    max_ts = max(e.get("timestamp", 0) for e in entries)
    age_days = (time.time() - max_ts) / 86400
    if age_days > max_age_days:
        from datetime import datetime
        last_str = datetime.fromtimestamp(max_ts).strftime("%Y-%m-%d") if max_ts else "never"
        return False, f"most recent KB update {age_days:.0f}d ago (last: {last_str}, threshold: {max_age_days}d)"
    from datetime import datetime
    last_str = datetime.fromtimestamp(max_ts).strftime("%Y-%m-%d")
    return True, f"last updated {age_days:.0f}d ago ({last_str})"


def _check_kb_content_no_pattern(inv: dict) -> tuple[bool, str]:
    """Scan all KB entries; fail if any title or content matches the given pattern.

    Use to guard against LLM artifact leaks (e.g. <|thinking|> tags in KB content).
    """
    if ctx.project_engine is None:
        return True, "engine not available -- skipped (pipeline context)"
    pattern = inv["pattern"]
    entries = ctx.project_engine.list_knowledge_full()
    if not entries:
        return True, "KB empty (nothing to check)"
    leaking = []
    for e in entries:
        text = (e.get("title", "") or "") + "\n" + (e.get("content", "") or "")
        if re.search(pattern, text, re.IGNORECASE):
            leaking.append(e.get("id", "?")[:12])
    if leaking:
        return False, f"{len(leaking)} entries contain pattern '{pattern}': {', '.join(leaking[:5])}"
    return True, f"all {len(entries)} entries clean"

