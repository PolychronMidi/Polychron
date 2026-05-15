"""TODO.md close/complete compatibility for hidden hme_todo actions."""
import os
import re
import sys

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from .todo_md_sync import completion_state, mark_matching_done, normalize_tier  # noqa: E402


def _detect_phase_complete(spec_md: str) -> list[dict]:
    state = completion_state(spec_md)
    if not state["complete"]:
        return []
    return [{"header": "## TODO", "start_line": 0, "end_line": 0, "closed_count": state["total"]}]


def _close_with_spec_update(entry: dict) -> tuple[str, str]:
    """Flip the matching TODO.md task line to done."""
    text = entry.get("text", "").strip()
    text_root = re.sub(r"\s+\(from spec.*?\)\s*$", "", text)
    probe = dict(entry)
    probe["text"] = text_root
    flipped, shipped = mark_matching_done(probe)
    if not shipped:
        shipped = f"- [x] [{normalize_tier(entry.get('tier'))}] {text_root}"
    return flipped, shipped
