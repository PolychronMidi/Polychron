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




import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))

from buddy_handoff_kb import (  # noqa: E402
    _extract_and_crystallize, _findings_nudge, _record_consult,
    _KB_DIRECTIVE, _KB_BLOCK_RE, _CONSULT_HISTORY_CAP, _FINDING_MARKERS,
)

def _import_main():
    """Lazy import of parent buddy_handoff for cross-module symbols."""
    from buddy_handoff import _read_primary, _emit_activity, _import_dispatcher, SENIORS_DIR, PRIMARY_SID
    return _read_primary, _emit_activity, _import_dispatcher, SENIORS_DIR, PRIMARY_SID


def _write_consult_sentinel(sid: str | None) -> None:
    """Decision-audit sentinel: pretooluse_edit reads this to mark architectural edits as consulted. Best-effort, called AFTER the API response returns so proxy-fired UserPromptSubmit hooks can't wipe it mid-call."""
    try:
        sentinel = TMP / "hme-turn-consults.txt"
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sid_str = (sid or "")[:12]
        with open(sentinel, "a", encoding="utf-8") as f:
            f.write(f"{int(time.time())} sid={sid_str}\n")
    except OSError:
        pass  # silent-ok: best-effort fs op


def _pick_senior_for_question(question: str, seniors_dir: Path) -> str | None:
    """Auto-route by expertise overlap. Reads each senior's expertise_topics
    and consults count, ranks by keyword-in-question + recency. Returns sid or
    None if no senior has discoverable expertise. Closes BUDDY_SYSTEM Q2."""
    if not seniors_dir.is_dir():
        return None
    q_lower = question.lower()
    best_sid: str | None = None
    best_score = 0
    for fp in sorted(seniors_dir.glob("*.json")):
        if fp.name.startswith("_"):
            continue
        try:
            rec = json.loads(fp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        topics = rec.get("expertise_topics") or []
        score = sum(2 for t in topics if t.lower() in q_lower)
        score += min(len(rec.get("consults") or []), 5)
        if score > best_score:
            best_score = score
            best_sid = rec.get("sid")
    return best_sid if best_score > 0 else None


def cmd_consult(args: argparse.Namespace) -> int:
    """Manually invoke a specific senior. Spawns claude --resume <sid> -p
    with the supplied question and prints the response. Each consult call
    grows the senior's transcript like a normal claude invocation.

    When --sid is omitted, auto-route to best-expertise-match senior via
    _pick_senior_for_question (BUDDY_SYSTEM Q2)."""
    _read_primary, _emit_activity, _import_dispatcher, SENIORS_DIR, PRIMARY_SID = _import_main()
    if not args.question:
        print("--question=\"...\" required")
        return 2
    if not args.sid:
        picked = _pick_senior_for_question(args.question, SENIORS_DIR)
        if picked:
            print(f"# auto-routed to senior sid={picked} by expertise match",
                  file=sys.stderr)
            args.sid = picked
        elif getattr(args, "engine", "claude-resume") == "synthesis":
            args.sid = ""
        else:
            print("--sid=<senior-sid> required (no expertise-match auto-route available; "
                  "or pass --engine=synthesis for a sid-less fast consult)",
                  file=sys.stderr)
            return 2
    # Q8a addendum: archived seniors must remain callable via i/consult
    # -- archiving means "hidden from default status," not "removed from
    # the consultable pool." Search both the active pool and the archive
    # before deciding the target is unknown.
    senior_file = SENIORS_DIR / f"{args.sid}.json" if args.sid else None
    archive_file = SENIORS_DIR / "_archive" / f"{args.sid}.json" if args.sid else None
    target_known = bool(args.sid) and (senior_file.exists() or archive_file.exists())
    # Skip the pool-membership warning for sid-less synthesis consults (no sid to check).
    if args.sid and not target_known:
        primary = _read_primary()
        if primary is None or primary["sid"] != args.sid:
            print(f"warning: sid {args.sid} is not in the senior pool "
                  f"(active or archived)", file=sys.stderr)
    import subprocess
    # Prepend the KB-crystallization directive so the senior knows to
    # emit structured [[KB-CRYSTALLIZE]] blocks for findings worth
    # preserving. The parent extracts those blocks post-response and
    # calls `i/learn add` for each -- converting fragile transcript
    # wisdom into durable KB entries.
    # [HME-SENIOR-CONSULT] marker tells the HME proxy to skip MODE=4 swap.
    _senior_marker = "[HME-SENIOR-CONSULT]\n\n" if getattr(args, "senior_consult", False) else ""
    framed_question = _senior_marker + _KB_DIRECTIVE + args.question
    # Sentinel write deferred to AFTER the API call -- synthesis/overdrive routes through the HME proxy which fires UserPromptSubmit, wiping turn state mid-call.
    # Synthesis fast path: single API call (~5s) vs subprocess (~30-300s).
    if getattr(args, "engine", "claude-resume") == "synthesis":
        try:
            import sys as _sys, os as _os
            _sys.path.insert(0, _os.path.join(_os.environ.get("PROJECT_ROOT", "."),
                                              "tools", "HME", "service"))
            from server.tools_analysis.synthesis import synthesis_reasoning
        except ImportError as e:
            print(f"# synthesis engine unavailable: {e}", file=sys.stderr)
            return 4
        _proj = _os.environ.get("PROJECT_ROOT", "")
        _persona_md = Path(_proj) / ".claude" / "agents" / "buddy-primary.md" if _proj else None
        persona_body = None
        if _persona_md and _persona_md.is_file():
            try:
                _text = _persona_md.read_text(encoding="utf-8")
                if _text.startswith("---"):
                    _end = _text.find("\n---\n", 4)
                    persona_body = _text[_end + 5:].strip() if _end > 0 else _text.strip()
                else:
                    persona_body = _text.strip()
            except OSError:
                pass  # silent-ok: best-effort fs op
        persona_body = persona_body or (
            "You are a Polychron co-buddy senior consultant. Answer concisely with "
            "grounded reasoning. Cite file:line for every claim."
        )
        resp = synthesis_reasoning.call(
            prompt=framed_question, system=persona_body,
            max_tokens=2048, temperature=0.3, profile="reasoning", tier="E3",
        )
        if resp:
            print(resp)
            _record_consult(args.sid or "synthesis", args.question)
            _write_consult_sentinel(args.sid or "synthesis")
            return 0
        print("# synthesis cascade exhausted; falling back to claude-resume", file=sys.stderr)
    cmd = ["claude", "--resume", args.sid, "-p", framed_question]
    # Buddy / primary / senior detection for the print line; unknown sids -> "buddy".
    primary = _read_primary()
    if primary is not None and primary["sid"] == args.sid:
        role = "primary"
    elif (SENIORS_DIR / f"{args.sid}.json").exists():
        role = "senior"
    else:
        role = "buddy"
    # Q7 resolution: per-sid lockfile prevents concurrent consults from
    # invoking `claude --resume` on the same session simultaneously
    # (re-entrancy not guaranteed). Stale-detection: if a lockfile is
    # older than the maximum reasonable consult duration (1 hour --
    # well past the dynamic timeout's worst case), assume the prior
    # holder crashed and reclaim. Lockfile is best-effort: a TOCTOU
    # race between two consults ~1ms apart could let both through, but
    # the rare case is no worse than the pre-lockfile baseline.
    lock_dir = TMP / "hme-consult-lock"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file = lock_dir / f"{args.sid}.lock"
    if lock_file.exists():
        try:
            lock_age = time.time() - lock_file.stat().st_mtime
        except OSError:
            lock_age = 0
        if lock_age < 3600:
            print(f"# consult locked: another consult to {args.sid} in "
                  f"flight (lock age {int(lock_age)}s); refuse to "
                  f"double-invoke claude --resume on the same session",
                  file=sys.stderr)
            return 3
        # Stale lock -- prior consult must have crashed.
        try:
            lock_file.unlink()
        except OSError:
            pass  # silent-ok: best-effort fs op
    try:
        lock_file.write_text(f"{os.getpid()}\n{time.time()}\n")
    except OSError:
        pass  # silent-ok: best-effort fs op  # best-effort lock; proceed without if filesystem refuses
    print(f"# consulting {role} sid={args.sid}", file=sys.stderr)
    # Q9 resolution: when consulting a senior whose ctx has grown past
    # the pre-compaction floor, warn-and-proceed (NOT refuse -- refuse
    # is too aggressive without manifest harm). Cool-down: first warn
    # for a senior at >80% goes loud (stderr); subsequent warns for the
    # same senior within 1h go to debug only so we don't train the
    # operator to ignore them. mtime on tmp/hme-consult-warn-cooldown/
    # <sid> is the cool-down state (no parsing needed).
    # Compute ctx once for both the Q9 warn check (senior-only) and the
    # end-of-consult activity emit (any role) -- saves a duplicate
    # transcript walk and avoids the NameError if the warn branch was
    # skipped.
    bd_for_warn = _import_dispatcher()
    ctx_data = bd_for_warn._buddy_context_used(args.sid)
    pre_compaction_floor = 80.0
    cooldown_window_s = 3600
    if role == "senior" and ctx_data:
        used_pct = ctx_data.get("used_pct")
        # Missing used_pct shouldn't warn (we can't measure). Per
        # CLAUDE.md style: explicit None check rather than silent
        # `.get(key, 0)` fallback that conflates "key absent" with
        # "key explicitly zero".
        if used_pct is not None and used_pct >= pre_compaction_floor:
            cooldown_dir = TMP / "hme-consult-warn-cooldown"
            cooldown_dir.mkdir(parents=True, exist_ok=True)
            cooldown_file = cooldown_dir / f"{args.sid}.warn"
            recently_warned = False
            if cooldown_file.exists():
                try:
                    age = time.time() - cooldown_file.stat().st_mtime
                    recently_warned = age < cooldown_window_s
                except OSError:
                    pass  # silent-ok: best-effort fs op
            warn_msg = (f"senior {args.sid} ctx={ctx_data['used_pct']:.1f}% "
                        f"is past the pre-compaction floor "
                        f"({pre_compaction_floor:.0f}%). Each consult adds "
                        f"tokens; auto-compaction will wipe accumulated "
                        f"context if it crosses ~90%. Proceeding anyway -- "
                        f"see BUDDY_SYSTEM.md Q9.")
            if recently_warned:
                print(f"# [debug] {warn_msg}", file=sys.stderr)
            else:
                print(f"# WARNING: {warn_msg}", file=sys.stderr)
                try:
                    cooldown_file.write_text(f"{time.time()}\n")
                except OSError:
                    pass  # silent-ok: best-effort fs op
    # Dynamic timeout = max(1800, transcript_mb * 30 + 600).
    # 1800s floor; +30s/MB for resume cost; +600s response budget for
    # Opus extended thinking. Bias-generous (asymmetric: too-loose makes
    # user wait on hung process; too-tight wastes tokens on every long
    # consult). Idle watchdog (Popen+select per-byte reset) is the better
    # primitive when this formula stops scaling.
    transcript_mb = 0.0
    bd = _import_dispatcher()
    transcript_path = bd._transcript_path_for_sid(args.sid)
    if transcript_path is not None:
        try:
            transcript_mb = Path(transcript_path).stat().st_size / (1024 * 1024)
        except OSError:
            pass  # silent-ok: best-effort fs op
    consult_timeout = max(1800, int(transcript_mb * 30 + 600))
    # try/finally so the lockfile is released even on subprocess.run
    # timeout (TimeoutExpired raised) or unexpected error. Without this,
    # a timeout would orphan the lock for 1h until stale-detection
    # reclaims it -- blocking legitimate retries in the meantime.
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                env={**os.environ, "HME_THREAD_CHILD": "1"},
                                timeout=consult_timeout)
        if result.stdout:
            sys.stdout.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)
        if result.returncode == 0:
            # Track only successful senior consults; failed invocations + consults to active primary skipped. Surfaces heavy-consultation in `i/handoff status`.
            _record_consult(args.sid, args.question)
            _write_consult_sentinel(args.sid)
            # KB crystallization (heavy): extract [[KB-CRYSTALLIZE]]
            # blocks from the response and auto-call `i/learn add` for
            # each. Converts fragile transcript wisdom into durable KB
            # entries before the senior's transcript hits compaction.
            crystallized = _extract_and_crystallize(result.stdout or "")
            # Light fallback: if no structured blocks landed (older
            # transcripts that haven't seen the directive yet, or the
            # senior chose to emit unstructured findings), still nudge
            # the operator with the legacy pattern-match.
            if crystallized == 0:
                _findings_nudge(result.stdout or "")
        # HME integration: emit an activity event regardless of outcome
        # so the activity bridge can see consultation cadence
        # (cross-session forensics, rate analytics). Best-effort,
        # non-fatal -- the consult itself already succeeded or failed.
        # Payload kept lean: target sid, role, exit code, question
        # excerpt. Heavy data (full Q+A) lives in transcripts.
        _emit_activity("buddy_consult", {
            "sid": args.sid, "role": role,
            "rc": result.returncode,
            "question_excerpt": (args.question or "")[:60],
            "ctx_pct_at_call": (ctx_data.get("used_pct")
                                if isinstance(ctx_data, dict) else None),
        })
        return result.returncode
    finally:
        try:
            if lock_file.exists():
                lock_file.unlink()
        except OSError:
            pass  # silent-ok: best-effort fs op


