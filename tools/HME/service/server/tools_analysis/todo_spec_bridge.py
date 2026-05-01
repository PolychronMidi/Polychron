"""SPEC.md / TODO.md / devlog lifecycle bridge — connects ephemeral todo state
to durable handoff documentation. Surface (via i/todo dispatcher actions):
ingest_from_spec, promote_to_spec, close_with_spec_update, phase_complete.

Extracted from todo.py (was lines 851-1508). Zero external Python callers — all
entry is via the i/todo command surface. todo.py re-exports the public symbols.
See doc/SPEC.md Phase 0 for the workflow this bridge implements.
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


# SPEC/TODO bridge — connects ephemeral i/todo state to durable
# doc/SPEC.md + doc/TODO.md handoff docs. See doc/SPEC.md Phase 0.


_SPEC_FILE = os.path.join(ENV.require("PROJECT_ROOT"), "doc", "SPEC.md")
_TODOMD_FILE = os.path.join(ENV.require("PROJECT_ROOT"), "doc", "TODO.md")
# Archive lives under KB as the "devlog" arm — searchable through the
# same substrate as other knowledge entries, decoupled from the active
# doc/ directory so completed work doesn't tax agents reading the spec.
# Each archive event writes ONE timestamped file containing the
# just-completed set of phases (no monthly rotation; the archive trigger
# IS set-completion).
_DEVLOG_DIR = os.path.join(ENV.require("PROJECT_ROOT"), "tools", "HME", "KB", "devlog")
# Matches a Next-up entry: "- [tier] description. Reason: ..."
_NEXT_UP_RE = re.compile(
    r"^\s*-\s+\[(easy|medium|hard)\]\s+(.+?)(?:\s+Reason:\s+(.+?))?\s*$",
    re.IGNORECASE,
)
# Matches an open spec checkbox: "- [ ] [tier] text"
_SPEC_OPEN_RE = re.compile(
    r"^(\s*-\s+\[)\s(\]\s+\[(?:easy|medium|hard)\]\s+)(.+?)$",
    re.IGNORECASE,
)


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


def _ingest_from_spec(meta: dict, todos: list) -> list[dict]:
    """Read doc/TODO.md's Next up section, materialize each entry as an
    i/todo entry with source='spec' and tier=<label>. Skips entries
    whose text already matches an OPEN i/todo entry (universal dedup).
    Returns the list of newly-created entries."""
    if not os.path.exists(_TODOMD_FILE):
        logger.warning(f"ingest_from_spec: {_TODOMD_FILE} missing")
        return []
    with open(_TODOMD_FILE, encoding="utf-8") as f:
        md = f.read()
    next_up_lines = _read_section(md, "Next up (queued for next cycle)")
    created = []
    for line in next_up_lines:
        # Skip HTML comments + empty lines
        s = line.strip()
        if not s or s.startswith("<!--") or s.startswith("-->"):
            continue
        m = _NEXT_UP_RE.match(line)
        if not m:
            continue
        tier_str, body, reason = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
        # Strip trailing period from body if reason was attached
        if body.endswith("."):
            body = body[:-1]
        text_norm = body
        # Dedup: skip if an open entry with same text exists
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
            text_with_provenance = f"{body} (from spec — {reason})"
        entry = _write_todo_entry(
            meta, text=text_with_provenance, status="pending",
            critical=False, source="spec", tier=tier_str.lower(),
        )
        todos.append(entry)
        created.append(entry)
    return created


def _promote_to_spec(entry: dict) -> str:
    """Append an i/todo entry to doc/TODO.md's Next up section. Returns
    the appended line for caller display."""
    tier = _normalize_tier(entry.get("tier", "medium"))
    text = entry.get("text", "").strip()
    line = f"- [{tier}] {text}. Reason: i/todo #{entry.get('id')} promoted at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if not os.path.exists(_TODOMD_FILE):
        logger.warning(f"promote_to_spec: {_TODOMD_FILE} missing — creating")
        with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
            f.write("# TODO\n\n## In flight\n\n## Just shipped (last cycle)\n\n## Next up (queued for next cycle)\n\n")
    with open(_TODOMD_FILE, encoding="utf-8") as f:
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
    with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
        f.write(md)
    return line


def _normalize_for_match(s: str) -> str:
    """Coerce two markdown entries to a comparable form: lowercase,
    strip backticks/asterisks/quotes, collapse whitespace, drop trailing
    period. SPEC.md items and TODO.md Next-up entries can be hand-edited
    differently between the two docs (e.g. one has backticks around
    `i/todo` and the other doesn't), so a strict equality match misses
    legitimately-paired items. This normalization is the same shape as
    the lifesaver dedup normalizer — strip noise before comparing.
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


_JUST_SHIPPED_LIMIT = int(os.environ.get("HME_JUST_SHIPPED_LIMIT", "10"))


def _ensure_devlog_dir() -> None:
    os.makedirs(_DEVLOG_DIR, exist_ok=True)


def _slugify(text: str, max_len: int = 40) -> str:
    """Filesystem-safe slug for archive filenames."""
    s = re.sub(r"[^a-zA-Z0-9_\-]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "set"


def _detect_complete_set() -> dict:
    """Detect whether ALL phases in doc/SPEC.md are complete (each phase
    has zero `[ ]` items AND a `_Phase N complete_` sentinel paragraph).
    Returns {complete: bool, phases: [(n, header, start, end)], missing: [reason...]}.

    A "set" = all phases currently in SPEC.md. The archive trigger fires
    only when the entire set is complete — that's the "fresh slate"
    moment the user asked for. Half-completed sets stay in place."""
    out = {"complete": False, "phases": [], "missing": []}
    if not os.path.exists(_SPEC_FILE):
        out["missing"].append(f"{_SPEC_FILE} missing")
        return out
    with open(_SPEC_FILE, encoding="utf-8") as f:
        spec_md = f.read()
    blocks = _phase_blocks(spec_md)
    if not blocks:
        out["missing"].append("no phase blocks found in SPEC")
        return out
    sentinel_re = re.compile(r"_phase\s+\d+\s+complete_", re.IGNORECASE)
    open_re = re.compile(r"^\s*-\s+\[\s\]")
    lines = spec_md.split("\n")
    all_complete = True
    for start, end, header in blocks:
        m = re.match(r"^###\s+Phase\s+(\d+):", header)
        if not m:
            continue
        phase_n = int(m.group(1))
        block = lines[start:end]
        opens = sum(1 for ln in block if open_re.match(ln))
        has_sentinel = any(sentinel_re.search(ln) for ln in block)
        out["phases"].append({"n": phase_n, "header": header.strip(), "start": start, "end": end,
                              "open_items": opens, "has_sentinel": has_sentinel})
        if opens > 0:
            out["missing"].append(f"Phase {phase_n} has {opens} open `[ ]` item(s)")
            all_complete = False
        elif not has_sentinel:
            out["missing"].append(f"Phase {phase_n} missing `_Phase {phase_n} complete_` sentinel")
            all_complete = False
    out["complete"] = all_complete and bool(out["phases"])
    return out


def _archive_set(set_name: str = "") -> dict:
    """Archive the entire set of phases in doc/SPEC.md to a single
    timestamped KB devlog file. Refuses if any phase is incomplete.

    Layout: tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md
    Contents: all phase blocks verbatim + the SPEC's preamble (Goal /
    Architecture / Phases header) + any closing sections (Glossary,
    Three-loop NEVER lists, etc.) — the FULL spec snapshot at archive
    time. Future agents can grep the devlog for "how did we land
    Phase X" without paying the active-spec context tax.

    Also archives the matching TODO.md state (entire file snapshot,
    since "Just shipped" entries correlate with phases) so the devlog
    captures both the plan AND the what-shipped record.

    After archive: doc/SPEC.md is replaced with a fresh-slate
    template; doc/TODO.md is replaced with empty 3-section template.
    The active docs are now ready for the NEXT set without any
    completed-work tax.

    Returns {ok: bool, devlog_path: str, message: str}."""
    detection = _detect_complete_set()
    if not detection["complete"]:
        return {
            "ok": False,
            "devlog_path": "",
            "message": (
                "Refused: set is not fully complete.\n  " +
                "\n  ".join(detection["missing"])
            ),
        }
    _ensure_devlog_dir()
    ts = time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime())
    if not set_name:
        # Derive slug from the first phase's header
        first_header = detection["phases"][0]["header"]
        m = re.match(r"^###\s+Phase\s+\d+:\s*(.+?)\s*$", first_header)
        set_name = m.group(1) if m else "set"
    slug = _slugify(set_name)
    devlog_path = os.path.join(_DEVLOG_DIR, f"{ts}-{slug}.md")
    # Snapshot SPEC.md fully + TODO.md fully into the devlog file.
    spec_md = open(_SPEC_FILE, encoding="utf-8").read() if os.path.exists(_SPEC_FILE) else ""
    todo_md = open(_TODOMD_FILE, encoding="utf-8").read() if os.path.exists(_TODOMD_FILE) else ""
    phase_count = len(detection["phases"])
    devlog_content = [
        f"# Devlog — {set_name}",
        "",
        f"_Archived: {ts}_",
        f"_Phases: {phase_count} ({', '.join(str(p['n']) for p in detection['phases'])})_",
        "",
        "## SPEC snapshot",
        "",
        spec_md.rstrip(),
        "",
        "## TODO snapshot",
        "",
        todo_md.rstrip(),
        "",
    ]
    with open(devlog_path, "w", encoding="utf-8") as f:
        f.write("\n".join(devlog_content) + "\n")
    # Reset active SPEC.md to a fresh-slate template — preserves the
    # preamble (Goal / Architecture) and trailing sections (Glossary,
    # Three-loop NEVER lists, How this file evolves, Difficulty labels,
    # Empty-queue bail) since those are stable across sets. Drops only
    # the Phase blocks — those moved to the devlog.
    _reset_spec_to_fresh_slate(set_name, ts, devlog_path)
    _reset_todo_to_fresh_slate()
    return {
        "ok": True,
        "devlog_path": devlog_path,
        "message": f"Archived {phase_count} phase(s) to {devlog_path}; doc/SPEC.md and doc/TODO.md reset to fresh slate.",
    }


def _reset_spec_to_fresh_slate(prev_set_name: str, prev_ts: str, devlog_path: str) -> None:
    """After archiving a set, replace BOTH the preamble AND the Phase
    blocks in doc/SPEC.md with generic-initiative placeholders pointing
    at the devlog. Trailing sections (Glossary, NEVER lists,
    How-this-file-evolves, Difficulty labels, Empty-queue bail) are
    truly stable across sets and preserved verbatim.

    Why reset the preamble too: the previous set's Goal / Architecture
    sections are set-specific narrative ("Evolve buddy_system into
    co-buddies", etc.) — preserving them frames the NEXT set as if
    it's a continuation of the PREVIOUS one, which it usually isn't.
    Each set should declare its own Goal at the start; the placeholder
    text invites that.
    """
    if not os.path.exists(_SPEC_FILE):
        return
    with open(_SPEC_FILE, encoding="utf-8") as f:
        spec_md = f.read()
    lines = spec_md.split("\n")
    # Find boundary lines: end of preamble (just before "## Phases" or
    # the first "### Phase N:"), start of post-phases trailing block
    # (the first "## " after the last "### Phase N:" — i.e., a top-level
    # section after the Phases section).
    blocks = _phase_blocks(spec_md)
    if not blocks:
        # No phases yet — only reset the title + preamble, leave rest.
        # Caller already verified set is complete; without phases this
        # is a degenerate case (nothing to archive). No-op.
        return
    first_phase_start = blocks[0][0]
    last_phase_end = blocks[-1][1]
    # The preamble runs from line 0 through the line just BEFORE the
    # `## Phases` header (or first `### Phase` if `## Phases` absent).
    preamble_end = first_phase_start
    # Walk back from first_phase_start to find the `## Phases` header
    # if present; preserve from there inclusive (Phases header itself).
    phases_header_idx = first_phase_start
    for i in range(first_phase_start - 1, -1, -1):
        if lines[i].strip() == "## Phases":
            phases_header_idx = i
            break
    # Generic preamble template — initiative-agnostic.
    rel_devlog = os.path.relpath(devlog_path, ENV.require('PROJECT_ROOT'))
    fresh_preamble = [
        "# Polychron Active SPEC",
        "",
        "> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; reset back to \"Polychron Active SPEC\" after `i/todo clear` archives the set.",
        ">",
        "> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](HME.md), [doc/ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md), and [CLAUDE.md](../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.",
        ">",
        "> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../tools/HME/KB/devlog/) — each `i/todo clear` (when all phases are checked + sentinel-marked) timestamps the SPEC+TODO state into a single devlog file and resets the active doc to a fresh-slate template.",
        "",
        f"_Previous set ({prev_set_name}) archived {prev_ts} to {rel_devlog}._",
        "",
        "## Goal",
        "",
        "<One paragraph naming the current initiative — what's being built or fixed, for whom, and why this set is grouped together. Should change at every set boundary.>",
        "",
        "## Architecture / stack (one-liner each, current-initiative-relevant)",
        "",
        "<Bullet the architectural touchpoints THIS initiative interacts with. Stable cross-initiative architecture lives in doc/ARCHITECTURE.md and CLAUDE.md; don't restate here.>",
        "",
        "- <subsystem>: <one-line>",
        "- <data dir / queue / manifest>: <one-line>",
        "- <handoff doc>: doc/SPEC.md (canonical phases) + doc/TODO.md (3-section: In flight / Just shipped / Next up)",
        "",
        "## Phases",
        "",
        "### Phase 0: <next initiative — name>",
        "",
        "<1-paragraph context for the new initiative.>",
        "",
        "- [ ] [easy] First item of the new initiative",
        "",
    ]
    # Build new file: fresh preamble + everything from the post-phases
    # trailing block (Deferred / Glossary / NEVER lists / How-this-
    # evolves / etc.) preserved verbatim.
    trailing = lines[last_phase_end:]
    with open(_SPEC_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(fresh_preamble + trailing))


def _reset_todo_to_fresh_slate() -> None:
    """After archiving a set, reset doc/TODO.md to the empty 3-section
    template. The previous set's "Just shipped" entries are preserved
    in the devlog snapshot."""
    if not os.path.exists(_TODOMD_FILE):
        return
    fresh = (
        "# Polychron HME TODO (handoff doc)\n\n"
        "> Cross-cycle state. Every skill reads this on start and updates it on close. "
        "Three sections, in this order. See [doc/SPEC.md](SPEC.md) for the full architectural plan.\n\n"
        "## In flight\n\n"
        "<!-- Exactly one line per currently-running skill, format:\n"
        "  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>\n"
        "  Empty when no skill is running. -->\n\n"
        "## Just shipped (last cycle)\n\n"
        "<!-- Append-on-close, newest first. Trim to last 10; older history lives in\n"
        "  the previous set's devlog at tools/HME/KB/devlog/. -->\n\n"
        "## Next up (queued for next cycle)\n\n"
        "<!-- One line per queued item:\n"
        "  - [<difficulty>] <description>. Reason: <source> -->\n\n"
        "(empty — populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)\n\n"
        "---\n\n"
        "When this Next up is empty AND every `- [ ]` in [doc/SPEC.md](SPEC.md) has been "
        "flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "
        "\"Empty-queue bail\" appendix.\n"
    )
    with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
        f.write(fresh)


def _archive_just_shipped_overflow(trimmed_entries: list[str]) -> str:
    """When TODO.md "Just shipped" trims past the rolling-window cap
    mid-set (before the set is fully archived), the trimmed entries
    land in the current devlog scratch file so they're not lost.
    Path: tools/HME/KB/devlog/_in-flight-shipped-overflow.md (single
    rolling file, cleared on next archive_set)."""
    if not trimmed_entries:
        return ""
    _ensure_devlog_dir()
    overflow_path = os.path.join(_DEVLOG_DIR, "_in-flight-shipped-overflow.md")
    header_present = os.path.exists(overflow_path)
    body = []
    if not header_present:
        body.append("# In-flight just-shipped overflow")
        body.append("")
        body.append("> Trimmed from doc/TODO.md \"Just shipped\" rolling-10 window mid-set. "
                    "Cleared when the current set is archived via `i/todo archive_set`.")
        body.append("")
    body.append(f"<!-- trimmed {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} -->")
    body.extend(trimmed_entries)
    body.append("")
    with open(overflow_path, "a", encoding="utf-8") as f:
        if header_present:
            f.write("\n")
        f.write("\n".join(body) + "\n")
    return overflow_path


def _trim_just_shipped(md: str) -> tuple[str, int]:
    """Trim the Just shipped section to most recent N entries (per
    skill-set's rolling-window pattern). Older entries live in SPEC.md
    phase blocks + git log — the user said the file should not bloat
    over time. Mutates the section in-place; non-list lines (HTML
    comments, blank lines) are preserved. Returns (new_md, trimmed_count)."""
    marker = "## Just shipped (last cycle)"
    if marker not in md:
        return md, 0
    lines = md.split("\n")
    out = []
    in_section = False
    in_comment = False
    entry_count = 0
    trimmed = 0
    for line in lines:
        s = line.strip()
        if s == marker:
            out.append(line)
            in_section = True
            entry_count = 0
            continue
        if in_section:
            # Section ends at next "## " or "---"
            if s.startswith("## ") or s.startswith("---"):
                in_section = False
                out.append(line)
                continue
            # Track comment blocks — never trim inside them.
            if "<!--" in line and "-->" not in line:
                in_comment = True
                out.append(line)
                continue
            if in_comment:
                out.append(line)
                if "-->" in line:
                    in_comment = False
                continue
            # Real entry line (markdown list item)
            if s.startswith("- "):
                entry_count += 1
                if entry_count > _JUST_SHIPPED_LIMIT:
                    trimmed += 1
                    continue
            out.append(line)
            continue
        out.append(line)
    return "\n".join(out), trimmed


def _phase_blocks(spec_md: str) -> list[tuple[int, int, str]]:
    """Parse doc/SPEC.md for `### Phase <N>: <name>` blocks. Returns
    list of (start_line_idx, end_line_idx_exclusive, header_line)
    tuples. The end is the line where the next `### Phase` or `## `
    starts (or EOF). Used by phase-completion detection."""
    lines = spec_md.split("\n")
    starts = []
    for i, line in enumerate(lines):
        if re.match(r"^###\s+Phase\s+\d+:", line):
            starts.append((i, line))
    blocks = []
    for k, (start, header) in enumerate(starts):
        if k + 1 < len(starts):
            end = starts[k + 1][0]
        else:
            # Phase block ends at next "## " (top-level section) or EOF
            end = len(lines)
            for j in range(start + 1, len(lines)):
                if lines[j].startswith("## "):
                    end = j
                    break
        blocks.append((start, end, header))
    return blocks


def _detect_phase_complete(spec_md: str) -> list[dict]:
    """For each Phase block, return one entry per phase that:
       - has at least one `- [x]` item AND
       - has zero `- [ ]` items AND
       - does NOT yet have a "phase complete" sentinel paragraph.
    Caller can use this to surface "Phase N is now complete — add a
    completion paragraph" reminders. Pure detection; no mutation.
    """
    open_re = re.compile(r"^\s*-\s+\[\s\]")
    closed_re = re.compile(r"^\s*-\s+\[x\]")
    sentinel_re = re.compile(r"_phase\s+complete_|\*\*phase\s+complete\*\*", re.IGNORECASE)
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
    in doc/SPEC.md to `[x]`, append a Just-shipped entry to doc/TODO.md.

    Match strategy: pick the open SPEC item whose normalized text
    shares the longest common prefix with the i/todo entry's normalized
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
    # Strip the "(from spec — Reason)" provenance suffix if present.
    text_root = re.sub(r"\s+\(from spec.*?\)\s*$", "", text)
    text_norm = _normalize_for_match(text_root)
    flipped = ""
    flipped_idx = -1
    if os.path.exists(_SPEC_FILE) and text_norm:
        with open(_SPEC_FILE, encoding="utf-8") as f:
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
            with open(_SPEC_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(spec_lines) + ("\n" if spec_md.endswith("\n") else ""))
    # Append to TODO.md Just shipped at the FIRST entry slot (newest-first).
    # Skip past HTML comment blocks (`<!-- ... -->`) so the insertion
    # lands in real content space, not inside the template stub.
    shipped = f"- {text_root} — by i/todo #{entry.get('id')} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if os.path.exists(_TODOMD_FILE):
        with open(_TODOMD_FILE, encoding="utf-8") as f:
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
                        # Real content line within Just shipped — insert
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
                        # Blank line inside section — keep going.
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
            with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
                f.write(trimmed_md)
    return flipped, shipped
