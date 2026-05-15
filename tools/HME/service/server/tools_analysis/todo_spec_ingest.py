"""TODO.md ingest/promote compatibility for hidden hme_todo actions."""
import os
import re
import sys
import logging

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from paths import todo_file as _todo_md_file  # noqa: E402

logger = logging.getLogger("HME")

from server.tools_analysis.todo import (
    _write_todo_entry, _check_main_done,
)


from .todo_md_sync import (  # noqa: E402
    _read_section as _read_md_section,
    common_prefix_len as _md_common_prefix_len,
    normalize_for_match as _md_normalize_for_match,
    normalize_tier,
    task_items,
)

_NEXT_UP_RE = re.compile(
    r"^\s*-\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)(?:\s+Reason:\s+(.+?))?\s*$",
    re.IGNORECASE,
)
# Open spec checkbox: "- [ ] [tier] text". E1-E5 or legacy easy/medium/hard.
_SPEC_OPEN_RE = re.compile(
    r"^(\s*-\s+\[)\s(\]\s+\[(?:E[1-5]|easy|medium|hard)\]\s+)(.+?)$",
    re.IGNORECASE,
)

def _read_section(md_text: str, header: str) -> list[str]:
    if header.lower().startswith("next"):
        return _read_md_section(md_text, "next")
    if header.lower().startswith("in flight") or header.lower() == "now":
        return _read_md_section(md_text, "now")
    if header.lower().startswith("just shipped") or header.lower() == "done":
        return _read_md_section(md_text, "done")
    return _read_md_section(md_text, header)


def _ingest_from_spec(meta: dict, todos: list, phase: int | str = 0) -> list[dict]:
    """Materialize open TODO.md task lines as HME todo entries."""
    if not os.path.exists(_todo_md_file()):
        logger.warning(f"ingest_from_spec: {_todo_md_file()} missing")
        return []
    with open(_todo_md_file(), encoding="utf-8") as f:
        md = f.read()
    spec_lines = _read_phase_block(phase)
    if not spec_lines:
        spec_lines = [it["line"] for it in task_items(md, sections=("now", "next")) if not it["done"]]
    created = []
    for line in spec_lines:
        s = line.strip()
        if not s or s == "(empty)" or s.startswith("<!--") or s.startswith("-->"):
            continue
        m_phase = _SPEC_OPEN_RE.match(line)
        if m_phase:
            tier_str = re.search(r"\[(E[1-5]|easy|medium|hard)\]",
                                 m_phase.group(2), re.IGNORECASE).group(1)
            body = m_phase.group(3).strip()
            reason = ""
        else:
            m = _NEXT_UP_RE.match(line)
            if not m:
                continue
            tier_str, body, reason = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
        if body.endswith("."):
            body = body[:-1]
        text_norm = body
        already = False
        for t in todos:
            if (
                t.get("text", "").strip() == text_norm
                and not _check_main_done(t)
            ):
                already = True
                break
        if already:
            continue
        text_with_provenance = f"{body} (from TODO -- {reason})" if reason else body
        entry = _write_todo_entry(
            meta, text=text_with_provenance, status="pending",
            critical=False, source="todo_md", tier=tier_str,
        )
        todos.append(entry)
        created.append(entry)
    return created


def _read_phase_block(phase: int | str) -> list[str]:
    """Compatibility name: return open TODO.md Now/Next task lines."""
    if not os.path.exists(_todo_md_file()):
        return []
    with open(_todo_md_file(), encoding="utf-8") as f:
        md = f.read()
    return [it["line"] for it in task_items(md, sections=("now", "next")) if not it["done"]]


def _promote_to_spec(entry: dict) -> str:
    """Compatibility name: return the TODO.md line rendered by store sync."""
    tier = normalize_tier(entry.get("tier", "E3"))
    text = entry.get("text", "").strip()
    return f"- [ ] [{tier}] {text}"


def _normalize_for_match(s: str) -> str:
    """Coerce two markdown entries to a comparable form: lowercase,
    strip backticks/asterisks/quotes, collapse whitespace, drop trailing
    period. Compatibility callers still use this for legacy close-by-text
    matching, so keep it aligned with TODO.md task normalization.
    """
    return _md_normalize_for_match(s)


def _common_prefix_len(a: str, b: str) -> int:
    """Length of the longest common prefix of normalized strings."""
    return _md_common_prefix_len(a, b)
