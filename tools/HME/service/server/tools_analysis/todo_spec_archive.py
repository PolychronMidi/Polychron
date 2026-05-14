"""SPEC.md / TODO.md / devlog lifecycle bridge -- connects ephemeral todo state
to durable handoff documentation. Surface (via i/todo dispatcher actions):
ingest_from_spec, promote_to_spec, close_with_spec_update, phase_complete.

Extracted from todo.py (was lines 851-1508). Zero external Python callers -- all
entry is via the i/todo command surface. todo.py re-exports the public symbols.
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


# SPEC/TODO bridge -- connects ephemeral i/todo state to durable
# doc/templates/SPEC.md + doc/templates/TODO.md handoff docs. See doc/templates/SPEC.md Phase 0.


# _spec_file() moved to paths.spec_file() -- lazy resolution for hot-reload
# _todo_md_file() moved to paths.todo_file()
# Archive lives under KB as the "devlog" arm -- searchable through the
# same substrate as other knowledge entries, decoupled from the active
# doc/ directory so completed work doesn't tax agents reading the spec.
# Each archive event writes ONE timestamped file containing the
# just-completed set of phases (no monthly rotation; the archive trigger
# IS set-completion).
# _devlog_dir() moved to paths.kb_devlog_dir()
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


from .todo_spec_ingest import _normalize_for_match  # noqa: E402


# Archive + devlog + reset -- sub-cluster B.

_JUST_SHIPPED_LIMIT = int(os.environ.get("HME_JUST_SHIPPED_LIMIT", "10"))


def _ensure_devlog_dir() -> None:
    os.makedirs(_devlog_dir(), exist_ok=True)


def _slugify(text: str, max_len: int = 40) -> str:
    """Filesystem-safe slug for archive filenames."""
    s = re.sub(r"[^a-zA-Z0-9_\-]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "set"


def _phase_blocks(spec_md: str) -> list[tuple[int, int, str]]:
    """Parse doc/templates/SPEC.md for `### Phase <N>: <name>` blocks. Returns
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



def _detect_complete_set() -> dict:
    """Detect whether ALL phases in doc/templates/SPEC.md are complete (each phase
    has zero `[ ]` items AND a `_Phase N complete_` sentinel paragraph).
    Returns {complete: bool, phases: [(n, header, start, end)], missing: [reason...]}.

    A "set" = all phases currently in SPEC.md. The archive trigger fires
    only when the entire set is complete -- that's the "fresh slate"
    moment the user asked for. Half-completed sets stay in place."""
    out = {"complete": False, "phases": [], "missing": []}
    if not os.path.exists(_spec_file()):
        out["missing"].append(f"{_spec_file()} missing")
        return out
    with open(_spec_file(), encoding="utf-8") as f:
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


def _archive_set(set_name: str = "", force: bool = False) -> dict:
    """Archive the entire set of phases in doc/templates/SPEC.md to a single
    timestamped KB devlog file. Refuses if any phase is incomplete UNLESS
    force=True (operator override for "archive the leftover as-is" cases).

    Layout: tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md
    Contents: all phase blocks verbatim + the SPEC's preamble (Goal /
    Architecture / Phases header) + any closing sections (Glossary,
    Three-loop NEVER lists, etc.) -- the FULL spec snapshot at archive
    time. Future agents can grep the devlog for "how did we land
    Phase X" without paying the active-spec context tax.

    Also archives the matching TODO.md state (entire file snapshot,
    since "Just shipped" entries correlate with phases) so the devlog
    captures both the plan AND the what-shipped record.

    After archive: doc/templates/SPEC.md is replaced with a fresh-slate
    template; doc/templates/TODO.md is replaced with empty 3-section template.
    The active docs are now ready for the NEXT set without any
    completed-work tax.

    Returns {ok: bool, devlog_path: str, message: str}."""
    detection = _detect_complete_set()
    if not detection["complete"] and not force:
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
    devlog_path = os.path.join(_devlog_dir(), f"{ts}-{slug}.md")
    # Snapshot SPEC.md fully + TODO.md fully into the devlog file.
    spec_md = open(_spec_file(), encoding="utf-8").read() if os.path.exists(_spec_file()) else ""
    todo_md = open(_todo_md_file(), encoding="utf-8").read() if os.path.exists(_todo_md_file()) else ""
    phase_count = len(detection["phases"])
    devlog_content = [
        f"# Devlog -- {set_name}",
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
    # Reset active SPEC.md to a fresh-slate template -- preserves the
    # preamble (Goal / Architecture) and trailing sections (Glossary,
    # Three-loop NEVER lists, How this file evolves, Difficulty labels,
    # Empty-queue bail) since those are stable across sets. Drops only
    # the Phase blocks -- those moved to the devlog.
    _reset_spec_to_fresh_slate(set_name, ts, devlog_path)
    _reset_todo_to_fresh_slate()
    # Auto-fire learning extraction on the new devlog so KB/learnings.jsonl
    # accumulates each cycle's patterns without a human running i/learn learnings.
    try:
        import subprocess as _sp
        _le = os.path.join(ENV.require("PROJECT_ROOT"),
                           "tools", "HME", "scripts", "learning_extract.py")
        if os.path.isfile(_le):
            _sp.run(["python3", _le, "extract"], capture_output=True, timeout=10)
    except Exception:
        pass  # silent-ok: diagnostic; failure non-fatal
    return {
        "ok": True,
        "devlog_path": devlog_path,
        "message": f"Archived {phase_count} phase(s) to {devlog_path}; doc/templates/SPEC.md and doc/templates/TODO.md reset to fresh slate.",
    }




# Reset / trim / overflow archival functions.

def _reset_spec_to_fresh_slate(prev_set_name: str, prev_ts: str, devlog_path: str) -> None:
    """After archiving a set, replace BOTH the preamble AND the Phase
    blocks in doc/templates/SPEC.md with generic-initiative placeholders pointing
    at the devlog. Trailing sections (Glossary, NEVER lists,
    How-this-file-evolves, Difficulty labels, Empty-queue bail) are
    truly stable across sets and preserved verbatim.

    Why reset the preamble too: the previous set's Goal / Architecture
    sections are set-specific narrative ("Evolve buddy_system into
    co-buddies", etc.) -- preserving them frames the NEXT set as if
    it's a continuation of the PREVIOUS one, which it usually isn't.
    Each set should declare its own Goal at the start; the placeholder
    text invites that.
    """
    if not os.path.exists(_spec_file()):
        return
    with open(_spec_file(), encoding="utf-8") as f:
        spec_md = f.read()
    lines = spec_md.split("\n")
    # Find boundary lines: end of preamble (just before "## Phases" or
    # the first "### Phase N:"), start of post-phases trailing block
    # (the first "## " after the last "### Phase N:" -- i.e., a top-level
    # section after the Phases section).
    blocks = _phase_blocks(spec_md)
    if not blocks:
        # No phases yet -- only reset the title + preamble, leave rest.
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
    # Generic preamble template -- initiative-agnostic.
    rel_devlog = os.path.relpath(devlog_path, ENV.require('PROJECT_ROOT'))
    fresh_preamble = [
        "# Polychron Active SPEC",
        "",
        "> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to \"Polychron Active SPEC\" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text=\"<slug>\"` (force) archives the set.",
        ">",
        "> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](../HME.md), [doc/ARCHITECTURE.md](../ARCHITECTURE.md), [README.md](../../README.md), and [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.",
        ">",
        "> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text=\"<slug>\"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.",
        "",
        f"_Previous set ({prev_set_name}) archived {prev_ts} to {rel_devlog}._",
        "",
        "## Goal",
        "",
        "<One paragraph naming the current initiative -- what's being built or fixed, for whom, and why this set is grouped together. Should change at every set boundary.>",
        "",
        "## Architecture / stack (one-liner each, current-initiative-relevant)",
        "",
        "<Bullet the architectural touchpoints THIS initiative interacts with. Stable cross-initiative architecture lives in doc/ARCHITECTURE.md and CLAUDE.md; don't restate here.>",
        "",
        "- <subsystem>: <one-line>",
        "- <data dir / queue / manifest>: <one-line>",
        "- <handoff doc>: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up)",
        "",
        "## Phases",
        "",
        "### Phase 0: <next initiative -- name>",
        "",
        "<1-paragraph context for the new initiative.>",
        "",
        "- [ ] [easy] First item of the new initiative",
        "",
    ]
    # Strip per-cycle scratch from trailing block before write.
    trailing = _strip_per_cycle_scratch(lines[last_phase_end:])
    with open(_spec_file(), "w", encoding="utf-8") as f:
        f.write("\n".join(fresh_preamble + trailing))


def _strip_per_cycle_scratch(trailing: list[str]) -> list[str]:
    """Clear BOTH deferred sections on archive.

    Per-cycle scratch + out-of-scope reset each archive cycle.
    Glossary, NEVER lists, How-evolves, Worthiness gate preserved.
    """
    out: list[str] = []
    skipping = False
    placeholder_msg = "<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->"
    for line in trailing:
        if line.startswith("## Deferred to next cycle") or line.startswith("## Deferred / out of scope"):
            out.append(line)
            out.append("")
            out.append(placeholder_msg)
            out.append("")
            skipping = True
            continue
        if skipping:
            if line.startswith("## ") or line.startswith("---"):
                skipping = False
                out.append(line)
            continue
        out.append(line)
    return out


def _reset_todo_to_fresh_slate() -> None:
    """After archiving a set, reset doc/templates/TODO.md to the empty 3-section
    template. The previous set's "Just shipped" entries are preserved
    in the devlog snapshot."""
    if not os.path.exists(_todo_md_file()):
        return
    fresh = (
        "# Polychron HME TODO (handoff doc)\n\n"
        "> Cross-cycle state. Every skill reads this on start and updates it on close. "
        "Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.\n\n"
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
        "(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)\n\n"
        "---\n\n"
        "When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been "
        "flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "
        "\"Empty-queue bail\" appendix.\n"
    )
    with open(_todo_md_file(), "w", encoding="utf-8") as f:
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
    overflow_path = os.path.join(_devlog_dir(), "_in-flight-shipped-overflow.md")
    header_present = os.path.exists(overflow_path)
    body = []
    if not header_present:
        body.append("# In-flight just-shipped overflow")
        body.append("")
        body.append("> Trimmed from doc/templates/TODO.md \"Just shipped\" rolling-10 window mid-set. "
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
    phase blocks + git log -- the user said the file should not bloat
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
            # Track comment blocks -- never trim inside them.
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
