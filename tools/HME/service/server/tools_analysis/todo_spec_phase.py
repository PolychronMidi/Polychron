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
    _todo_lock,
)
from server.tools_analysis.todo_spec_ingest import (  # noqa: F401
    _common_prefix_len, _normalize_for_match,
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
# Matches a Next-up entry. Accepts E1-E5 or legacy easy/medium/hard.
_NEXT_UP_RE = re.compile(
    r"^\s*-\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)(?:\s+Reason:\s+(.+?))?\s*$",
    re.IGNORECASE,
)
# Matches an open spec checkbox: "- [ ] [tier] text".
_SPEC_OPEN_RE = re.compile(
    r"^(\s*-\s+\[)\s(\]\s+\[(?:E[1-5]|easy|medium|hard)\]\s+)(.+?)$",
    re.IGNORECASE,
)


from .todo_spec_archive import (  # noqa: E402
    _phase_blocks,
    _detect_complete_set, _archive_set,
    _reset_spec_to_fresh_slate, _reset_todo_to_fresh_slate,
    _trim_just_shipped, _JUST_SHIPPED_LIMIT,
)


# Phase detection + close-with-spec-update -- sub-cluster C.

def _detect_phase_complete(spec_md: str) -> list[dict]:
    """For each Phase block, return one entry per phase that:
       - has at least one `- [x]` item AND
       - has zero `- [ ]` items AND
       - does NOT yet have a "phase complete" sentinel paragraph.
    Caller can use this to surface "Phase N is now complete -- add a
    completion paragraph" reminders. Pure detection; no mutation.
    """
    open_re = re.compile(r"^\s*-\s+\[\s\]")
    closed_re = re.compile(r"^\s*-\s+\[x\]")
    sentinel_re = re.compile(r"_phase\s+\d+\s+complete_|_phase\s+complete_|\*\*phase\s+complete\*\*", re.IGNORECASE)
    lines = spec_md.split("\n")
    out = []
    for start, end, header in _phase_blocks(spec_md):
        block = lines[start:end]
        opens = sum(1 for ln in block if open_re.match(ln))
        closes = sum(1 for ln in block if closed_re.match(ln))
        has_sentinel = any(sentinel_re.search(ln) for ln in block)
        if closes >= 1 and opens == 0 and not has_sentinel:
            out.append({
                "header": header.strip(),
                "start_line": start,
                "end_line": end,
                "closed_count": closes,
            })
    return out


def _close_with_spec_update(entry: dict) -> tuple[str, str]:
    """Atomic SPEC/TODO close: flip the BEST-MATCHING `- [ ] [tier] <text>`
    in doc/templates/SPEC.md to `[x]`, append a Just-shipped entry to doc/templates/TODO.md.

    Match strategy: pick the open SPEC item whose normalized text
    shares the longest common prefix with the HME todo entry's normalized
    text, requiring at least 30 chars of common prefix to fire (avoids
    false positives where two items share a generic preamble like
    "Add"). TODO.md Next-up entries are often shortened versions of
    the full SPEC.md item text, so strict equality / containment misses
    legitimately-paired items.

    After flip+append, trims TODO.md "Just shipped" to most recent N
    entries (skill-set's rolling-window pattern; older history lives in
    SPEC.md phase blocks + git log). Returns (flipped_spec_line,
    shipped_line); flipped is empty if no SPEC item matched."""
    text = entry.get("text", "").strip()
    # Strip the "(from spec -- Reason)" provenance suffix if present.
    text_root = re.sub(r"\s+\(from spec.*?\)\s*$", "", text)
    text_norm = _normalize_for_match(text_root)
    flipped = ""
    flipped_idx = -1
    if os.path.exists(_spec_file()) and text_norm:
        with open(_spec_file(), encoding="utf-8") as f:
            spec_md = f.read()
        spec_lines = spec_md.splitlines()
        # Score every open SPEC item by common-prefix length.
        candidates = []
        for i, line in enumerate(spec_lines):
            m = _SPEC_OPEN_RE.match(line)
            if not m:
                continue
            spec_text = m.group(3).rstrip(".").strip()
            spec_norm = _normalize_for_match(spec_text)
            cp = _common_prefix_len(spec_norm, text_norm)
            # Require at least 30 chars of shared prefix OR full equality
            # OR one being a strict prefix of the other.
            if (
                cp >= 30
                or spec_norm == text_norm
                or spec_norm.startswith(text_norm)
                or text_norm.startswith(spec_norm)
            ):
                candidates.append((cp, i, m, spec_text))
        if candidates:
            candidates.sort(key=lambda c: -c[0])
            cp, i, m, spec_text = candidates[0]
            new_line = m.group(1) + "x" + m.group(2) + m.group(3)
            spec_lines[i] = new_line
            flipped = spec_text
            flipped_idx = i
            with open(_spec_file(), "w", encoding="utf-8") as f:
                f.write("\n".join(spec_lines) + ("\n" if spec_md.endswith("\n") else ""))
    # Append to TODO.md Just shipped at the FIRST entry slot (newest-first).
    # Skip past HTML comment blocks (`<!-- ... -->`) so the insertion
    # lands in real content space, not inside the template stub.
    shipped = f"- {text_root} -- by HME todo #{entry.get('id')} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if os.path.exists(_todo_md_file()):
        with open(_todo_md_file(), encoding="utf-8") as f:
            md = f.read()
        marker = "## Just shipped (last cycle)"
        if marker in md:
            lines = md.split("\n")
            out = []
            in_section = False
            in_comment = False
            inserted = False
            for line in lines:
                if not inserted:
                    s = line.strip()
                    if s == marker:
                        out.append(line)
                        in_section = True
                        continue
                    if in_section:
                        if "<!--" in line and "-->" not in line:
                            in_comment = True
                            out.append(line)
                            continue
                        if in_comment:
                            out.append(line)
                            if "-->" in line:
                                in_comment = False
                            continue
                        # Real content line within Just shipped -- insert
                        # `shipped` BEFORE it, then continue normally.
                        if s and not s.startswith("##"):
                            out.append(shipped)
                            out.append(line)
                            inserted = True
                            in_section = False
                            continue
                        # Hit next section header without finding entries.
                        if s.startswith("##"):
                            out.append(shipped)
                            out.append(line)
                            inserted = True
                            in_section = False
                            continue
                        # Blank line inside section -- keep going.
                        out.append(line)
                        continue
                out.append(line)
            if not inserted:
                # Section was at file end with no entries; append at EOF.
                out.append(shipped)
            new_md = "\n".join(out)
            # Apply rolling-window trim AFTER the new entry lands so the
            # newest entry always survives. Trim count is the difference
            # between count-before and the configured limit.
            trimmed_md, _trim_n = _trim_just_shipped(new_md)
            with open(_todo_md_file(), "w", encoding="utf-8") as f:
                f.write(trimmed_md)
    return flipped, shipped
