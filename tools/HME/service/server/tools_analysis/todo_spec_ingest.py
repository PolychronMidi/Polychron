"""SPEC.md / TODO.md / devlog lifecycle bridge -- connects ephemeral todo state
to durable active-initiative documentation. Surface (via hidden hme_todo actions):
ingest_from_spec, promote_to_spec, close_with_spec_update, phase_complete.

Extracted from todo.py (was lines 851-1508). Zero external Python callers -- all
entry is via the hidden hme_todo surface. todo.py re-exports the public symbols.
See doc/templates/SPEC.md Phase 0 for the workflow this bridge implements.
"""
import json
import os
import re
import sys
import time
import logging

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402
from paths import spec_file as _spec_file, todo_file as _todo_md_file, kb_devlog_dir as _devlog_dir  # noqa: E402

from server import context as ctx
from server.tools_analysis import _track

logger = logging.getLogger("HME")

# Pull persistence + entry primitives from the parent module. todo.py loads
# its core definitions BEFORE re-exporting from this sibling, so this
# import resolves without a cycle.
from server.tools_analysis.todo import (
    _load_todos, _save_todos, _write_todo_entry, _allocate_id,
    _find_main, _find_any, _check_main_done, _mark_status,
    _todo_lock, _normalize_tier,  # noqa: F401
)


# SPEC/TODO bridge -- connects ephemeral HME todo state to durable
# doc/templates/SPEC.md + doc/templates/TODO.md active docs. See doc/templates/SPEC.md Phase 0.


# _spec_file() moved to paths.spec_file() -- lazy resolution for hot-reload
# _todo_md_file() moved to paths.todo_file()
# Archive lives under KB as the "devlog" arm -- searchable through the
# same substrate as other knowledge entries, decoupled from the active
# doc/ directory so completed work doesn't tax agents reading the spec.
# Each archive event writes ONE timestamped file containing the
# just-completed set of phases (no monthly rotation; the archive trigger
# IS set-completion).
# _devlog_dir() moved to paths.kb_devlog_dir()
# Next-up entry: "- [tier] description. Reason: ...". Accepts E1-E5 or legacy easy/medium/hard.
_NEXT_UP_RE = re.compile(
    r"^\s*-\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)(?:\s+Reason:\s+(.+?))?\s*$",
    re.IGNORECASE,
)
# Open spec checkbox: "- [ ] [tier] text". E1-E5 or legacy easy/medium/hard.
_SPEC_OPEN_RE = re.compile(
    r"^(\s*-\s+\[)\s(\]\s+\[(?:E[1-5]|easy|medium|hard)\]\s+)(.+?)$",
    re.IGNORECASE,
)



# Spec/TODO ingest + promote -- sub-cluster A.

def _read_section(md_text: str, header: str) -> list[str]:
    """Return the lines of a section (between '## <header>' and the
    next '## ' or '---' marker), stripped of empty leading/trailing
    lines. Header match is case-sensitive."""
    lines = md_text.splitlines()
    out = []
    in_section = False
    for line in lines:
        if line.startswith("## "):
            if in_section:
                break
            if line.strip()[3:].strip() == header:
                in_section = True
                continue
        if in_section:
            if line.startswith("---"):
                break
            out.append(line)
    # Trim leading/trailing blanks
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return out


def _ingest_from_spec(meta: dict, todos: list, phase: int | str = 0) -> list[dict]:
    """Materialize SPEC/TODO entries as HME todo entries (source='spec', tier=<label>).
    Skips entries whose text already matches an OPEN HME todo entry (universal dedup).

    `phase=0` (default): read doc/templates/TODO.md "Next up" section (legacy path).
    `phase=N` or `phase="latest"`: read open `- [ ]` items from doc/templates/SPEC.md
    Phase N block (or the highest-numbered Phase if "latest"). spec-kit-style
    auto-tasks-from-Phase eliminates the manual TODO.md staging step.

    Returns the list of newly-created entries."""
    spec_lines: list[str] = []
    if phase == 0:
        if not os.path.exists(_todo_md_file()):
            logger.warning(f"ingest_from_spec: {_todo_md_file()} missing")
            return []
        with open(_todo_md_file(), encoding="utf-8") as f:
            md = f.read()
        spec_lines = _read_section(md, "Next up (queued for next cycle)")
    else:
        spec_lines = _read_phase_block(phase)
        if not spec_lines:
            logger.warning(f"ingest_from_spec: phase={phase!r} not found in {_spec_file()}")
            return []
    created = []
    for line in spec_lines:
        s = line.strip()
        if not s or s.startswith("<!--") or s.startswith("-->"):
            continue
        # Phase blocks use _SPEC_OPEN_RE shape (`- [ ] [tier] text`); TODO Next-up uses
        # _NEXT_UP_RE shape (`- [tier] text. Reason: ...`). Try both.
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
        text_with_provenance = body
        if reason:
            text_with_provenance = f"{body} (from spec -- {reason})"
        elif phase != 0:
            text_with_provenance = f"{body} (from SPEC Phase {phase})"
        entry = _write_todo_entry(
            meta, text=text_with_provenance, status="pending",
            critical=False, source="spec", tier=tier_str.lower(),
        )
        todos.append(entry)
        created.append(entry)
    return created


def _read_phase_block(phase: int | str) -> list[str]:
    """Return the lines inside `### Phase N: <title>` (next-### or EOF terminates).
    `phase="latest"` resolves to the highest-numbered Phase header in SPEC.md."""
    if not os.path.exists(_spec_file()):
        return []
    with open(_spec_file(), encoding="utf-8") as f:
        spec_md = f.read()
    lines = spec_md.splitlines()
    headers = []
    for i, ln in enumerate(lines):
        m = re.match(r"^###\s+Phase\s+(\d+)\s*:", ln)
        if m:
            headers.append((int(m.group(1)), i))
    if not headers:
        return []
    if phase == "latest":
        target_n = max(n for n, _ in headers)
    else:
        try:
            target_n = int(phase)
        except (TypeError, ValueError):
            return []
    target_idx = next((i for n, i in headers if n == target_n), None)
    if target_idx is None:
        return []
    next_idx = next((i for n, i in headers if i > target_idx), len(lines))
    # Also stop at any next `## ` (top-level section) before the next Phase.
    for i in range(target_idx + 1, next_idx):
        if lines[i].startswith("## "):
            next_idx = i
            break
    return lines[target_idx + 1:next_idx]


def _promote_to_spec(entry: dict) -> str:
    """Append an HME todo entry to doc/templates/TODO.md's Next up section. Returns
    the appended line for caller display."""
    tier = _normalize_tier(entry.get("tier", "medium"))
    text = entry.get("text", "").strip()
    line = f"- [{tier}] {text}. Reason: HME todo #{entry.get('id')} promoted at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if not os.path.exists(_todo_md_file()):
        logger.warning(f"promote_to_spec: {_todo_md_file()} missing -- creating")
        with open(_todo_md_file(), "w", encoding="utf-8") as f:
            f.write("# TODO\n\n## In flight\n\n## Just shipped (last cycle)\n\n## Next up (queued for next cycle)\n\n")
    with open(_todo_md_file(), encoding="utf-8") as f:
        md = f.read()
    # Insert at end of Next up section (before --- or EOF)
    marker = "## Next up (queued for next cycle)"
    if marker not in md:
        md += f"\n{marker}\n\n{line}\n"
    else:
        # Find where to insert: end of Next up section
        idx = md.index(marker) + len(marker)
        rest = md[idx:]
        # Find next '---' or end of file
        end = rest.find("\n---")
        if end == -1:
            end = len(rest)
        # Append line just before that boundary
        before = md[:idx] + rest[:end].rstrip() + "\n" + line + "\n"
        after = rest[end:]
        md = before + after
    with open(_todo_md_file(), "w", encoding="utf-8") as f:
        f.write(md)
    return line


def _normalize_for_match(s: str) -> str:
    """Coerce two markdown entries to a comparable form: lowercase,
    strip backticks/asterisks/quotes, collapse whitespace, drop trailing
    period. SPEC.md items and TODO.md Next-up entries can be hand-edited
    differently between the two docs (e.g. one has backticks around
    tool names and the other doesn't), so a strict equality match misses
    legitimately-paired items. This normalization is the same shape as
    the lifesaver dedup normalizer -- strip noise before comparing.
    """
    if not s:
        return ""
    out = s.lower()
    # Drop markdown emphasis chars + quote marks
    out = re.sub(r"[`*_'\"]+", "", out)
    # Collapse whitespace
    out = re.sub(r"\s+", " ", out).strip()
    # Trim trailing period (TODO.md format includes "Reason:" after period;
    # SPEC.md items often end without period)
    if out.endswith("."):
        out = out[:-1]
    return out


def _common_prefix_len(a: str, b: str) -> int:
    """Length of the longest common prefix of normalized strings."""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i
