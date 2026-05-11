#!/usr/bin/env python3
"""Buddy hand-off paradigm -- primary/senior lifecycle management.

Replaces the multi-buddy floor-pinning model with a single dynamic
primary that retires to a senior pool when its context approaches
auto-compaction. Senior buddies are on standby -- their accumulated
context is preserved and only consulted manually for tough problems
(via `i/consult sid=<sid>` -- works for both the active primary and
retired seniors; role-named aliases `primary=`, `buddy=`, `senior=`
are equivalent).

Files (under PROJECT_ROOT/tmp/):
  hme-buddy-primary.sid          -- current primary buddy's session id
  hme-buddy-primary.floor        -- primary's model floor (default: easy)
  hme-buddy-primary.effort_floor -- primary's effort floor (default: low)
  hme-buddy-seniors/<sid>.json   -- one file per retired senior with metadata
  hme-buddy-seniors/_index.jsonl -- append-only retirement log

Lifecycle:
  - SessionStart: buddy_init.sh reads primary.sid and points the legacy
    runtime/hme/buddy.sid pointer at it (no fresh `claude -p` spawn). If
    primary.sid is empty/missing, falls through to spawn a fresh buddy
    and records its sid as the inaugural primary.
  - Retire: when the primary's context exceeds BUDDY_RETIRE_PCT (default
    90%), the primary is moved to seniors/<sid>.json with retire metadata
    (retired_at, context_at_retire, ctx_window). The next SessionStart
    spawns a fresh primary.
  - Consult: senior sessions are NOT auto-routed. They're invoked
    manually via `claude --resume <senior-sid> -p "<question>"` (the
    `consult` command here wraps that). Each consult call grows the
    senior's transcript like normal -- beware of pushing a senior past
    its retire threshold during heavy consultation.

Usage:
  buddy_handoff.py status                    # show primary + seniors + ctx %
  buddy_handoff.py retire [--reason=...]     # promote primary to senior
  buddy_handoff.py promote --sid=<sid>       # designate a sid as primary
  buddy_handoff.py auto_retire_check         # check threshold, retire if over
  buddy_handoff.py consult --sid=<sid> --question="..."   # manual senior call
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


_CONSULT_HISTORY_CAP = 50  # bounded growth on senior metadata file


# Markers that suggest a consult response contains crystallizable findings.
# Per 0e7fbf4d's HME integration analysis: senior wisdom is fragile (lives
# in transcripts that compaction wipes); HME's KB is durable. Auto-suggest
# crystallization when the response carries finding-shape vocabulary.
_FINDING_MARKERS = (
    r"\btier-1:",
    r"\bbug:",
    r"\bshould-fix:",
    r"\barchitectural:",
    r"\bblocker:",
    r"\bRESOLVED",  # buddy uses this in the open-questions answers
)


# KB-crystallization directive prefixed to every consult question. Per
# 0e7fbf4d's HME integration analysis -- this is the "heavy" version
# that converts the senior into an active KB contributor rather than
# just emitting findings into a fragile transcript. Each extracted
# block calls `i/learn add` automatically post-consult.
_KB_DIRECTIVE = (
    "[FRAMEWORK DIRECTIVE -- KB CRYSTALLIZATION]\n"
    "If your response contains findings worth preserving in HME's "
    "durable KB (calibration anchors, design decisions, gotchas, "
    "architectural patterns), append one or more crystallization "
    "blocks to the END of your response, AFTER your main reply. "
    "Format exactly:\n"
    "  [[KB-CRYSTALLIZE]]\n"
    "  title: <short title>\n"
    "  category: pattern | decision | architectural | gotcha\n"
    "  content: <one-paragraph finding worth keeping>\n"
    "  [[/KB-CRYSTALLIZE]]\n"
    "The parent agent auto-extracts these blocks and calls "
    "`i/learn add` for each. Skip blocks if no crystallization-worthy "
    "finding exists -- don't manufacture them. The transcript dies on "
    "compaction; the KB doesn't.\n"
    "[/FRAMEWORK DIRECTIVE]\n\n"
)


_KB_BLOCK_RE = (
    r"\[\[KB-CRYSTALLIZE\]\]\s*"
    r"title:\s*(?P<title>.+?)\s*"
    r"category:\s*(?P<category>pattern|decision|architectural|gotcha)\s*"
    r"content:\s*(?P<content>.+?)\s*"
    r"\[\[/KB-CRYSTALLIZE\]\]"
)


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
TMP = PROJECT_ROOT / "tmp"
PRIMARY_SID = TMP / "hme-buddy-primary.sid"
PRIMARY_FLOOR = TMP / "hme-buddy-primary.floor"
PRIMARY_EFFORT = TMP / "hme-buddy-primary.effort_floor"
LEGACY_SID = TMP / "hme-buddy.sid"
LEGACY_FLOOR = TMP / "hme-buddy.floor"
LEGACY_EFFORT = TMP / "hme-buddy.effort_floor"
SENIORS_DIR = TMP / "hme-buddy-seniors"
SENIORS_INDEX = SENIORS_DIR / "_index.jsonl"

DEFAULT_RETIRE_PCT = 90.0 # don't lower this, there is already a 10% margin between this point and auto-compaction which happens at 100%




def _extract_and_crystallize(response: str) -> int:
    """Extract [[KB-CRYSTALLIZE]] blocks from a consult response and
    call `i/learn add` for each. Returns the count of blocks that were
    successfully crystallized. Best-effort: i/learn failures are
    logged but don't abort the loop (one bad block shouldn't lose the
    others)."""
    if not response:
        return 0
    import re
    blocks = re.findall(_KB_BLOCK_RE, response, flags=re.DOTALL)
    if not blocks:
        return 0
    # Anchor to PROJECT_ROOT so sandbox tests can stub `i/learn`
    # by planting their own shim under the test PROJECT_ROOT. In
    # production, PROJECT_ROOT IS the repo root, so this matches
    # the canonical i/ wrapper location.
    learn_script = (PROJECT_ROOT / "i" / "learn").resolve()
    if not learn_script.exists():
        # Couldn't find the wrapper -- fall back to the underlying CLI.
        learn_script = None
    crystallized = 0
    import subprocess as _sp
    for title, category, content in blocks:
        title = title.strip()
        category = category.strip()
        content = content.strip()
        if not title or not content:
            continue
        try:
            cmd = ["bash", str(learn_script)] if learn_script else [
                "node",
                str(Path(__file__).parent.parent / "scripts" / "hme-cli.js"),
                "learn",
            ]
            cmd += [
                f"title={title}",
                f"content={content}",
                f"category={category}",
            ]
            result = _sp.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                crystallized += 1
                print(f"# crystallized: [{category}] {title[:60]}",
                      file=sys.stderr)
            else:
                print(f"# crystallize failed for '{title[:40]}': "
                      f"rc={result.returncode} stderr={result.stderr[:120]}",
                      file=sys.stderr)
        except (OSError, _sp.TimeoutExpired) as e:
            print(f"# crystallize error for '{title[:40]}': {e}",
                  file=sys.stderr)
    return crystallized


def _findings_nudge(response: str) -> None:
    """Scan a consult response for finding-shaped markers and emit a
    stderr nudge if any are present. Light version of the KB
    crystallization integration -- operator-driven, not auto-write.
    Silent when no markers found (no noise on routine consults)."""
    if not response:
        return
    import re
    pattern = re.compile("|".join(_FINDING_MARKERS), re.IGNORECASE)
    matches = pattern.findall(response)
    if not matches:
        return
    print(f"# consult produced {len(matches)} finding-shaped marker(s) "
          f"({', '.join(sorted(set(m.strip(':').lower() for m in matches)))})"
          f" -- consider `i/learn add title=... content=...` to crystallize "
          f"into KB before transcript compaction.",
          file=sys.stderr)


def _record_consult(sid: str, question: str) -> None:
    """Append a consult record to the senior's metadata file. Best-effort:
    silent on read/write failure so the consult call itself isn't blocked
    by a metadata write. Caps list at _CONSULT_HISTORY_CAP entries.

    Records caller_sid (the active primary at consult time, since that's
    who initiated) so cross-session forensics can answer 'who's been
    hammering this senior'. Falls back to None when no primary is
    recorded (e.g. test sandbox or pre-paradigm session)."""
    # Q8a: search active pool first, fall back to archive -- archived
    # seniors stay callable, and consult history should accrue to
    # whichever file represents them. If neither exists, no-op (consult
    # to active primary or unknown sid).
    senior_file = SENIORS_DIR / f"{sid}.json"
    if not senior_file.exists():
        archive_file = SENIORS_DIR / "_archive" / f"{sid}.json"
        if not archive_file.exists():
            return
        senior_file = archive_file
    caller_sid = None
    if PRIMARY_SID.exists():
        try:
            caller_sid = PRIMARY_SID.read_text().strip() or None
        except OSError:
            pass  # silent-ok: best-effort fs op
    if caller_sid is None:
        # Visible-by-default debug: caller resolved to None means consult
        # was invoked outside an active session (cron, manual shell), or
        # PRIMARY_SID is missing. Surfacing the gap beats silently
        # absorbing it.
        print(f"# debug: caller_sid resolved to None (no active primary "
              f"recorded at consult time) -- record will lack caller info",
              file=sys.stderr)
    try:
        rec = json.loads(senior_file.read_text())
        consults = rec.get("consults")
        if consults is None:
            consults = []
        consults.append({
            "ts": time.time(),
            "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "question_excerpt": (question or "")[:60],
            "caller_sid": caller_sid,
        })
        rec["consults"] = consults[-_CONSULT_HISTORY_CAP:]
        senior_file.write_text(json.dumps(rec, indent=2, default=str))
    except (OSError, ValueError):
        pass  # silent-ok: best-effort fs op


