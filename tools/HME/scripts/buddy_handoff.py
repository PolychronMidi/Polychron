#!/usr/bin/env python3
"""Buddy hand-off paradigm — primary/senior lifecycle management.

Replaces the multi-buddy floor-pinning model with a single dynamic
primary that retires to a senior pool when its context approaches
auto-compaction. Senior buddies are on standby — their accumulated
context is preserved and only consulted manually for tough problems
(via `i/consult sid=<sid>` — works for both the active primary and
retired seniors; role-named aliases `primary=`, `buddy=`, `senior=`
are equivalent).

Files (under PROJECT_ROOT/tmp/):
  hme-buddy-primary.sid          — current primary buddy's session id
  hme-buddy-primary.floor        — primary's model floor (default: easy)
  hme-buddy-primary.effort_floor — primary's effort floor (default: low)
  hme-buddy-seniors/<sid>.json   — one file per retired senior with metadata
  hme-buddy-seniors/_index.jsonl — append-only retirement log

Lifecycle:
  - SessionStart: buddy_init.sh reads primary.sid and points the legacy
    tmp/hme-buddy.sid pointer at it (no fresh `claude -p` spawn). If
    primary.sid is empty/missing, falls through to spawn a fresh buddy
    and records its sid as the inaugural primary.
  - Retire: when the primary's context exceeds BUDDY_RETIRE_PCT (default
    90%), the primary is moved to seniors/<sid>.json with retire metadata
    (retired_at, context_at_retire, ctx_window). The next SessionStart
    spawns a fresh primary.
  - Consult: senior sessions are NOT auto-routed. They're invoked
    manually via `claude --resume <senior-sid> -p "<question>"` (the
    `consult` command here wraps that). Each consult call grows the
    senior's transcript like normal — beware of pushing a senior past
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
import sys as _sys
if __name__ == "__main__" and "buddy_handoff" not in _sys.modules:
    _sys.modules["buddy_handoff"] = _sys.modules[__name__]
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


def _retire_threshold() -> float:
    raw = os.environ.get("BUDDY_RETIRE_PCT")
    if raw:
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    # .env fallback so the script behaves consistently outside hook env.
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                if line.startswith("BUDDY_RETIRE_PCT="):
                    return float(line.split("=", 1)[1].strip())
        except (OSError, ValueError):
            pass
    return DEFAULT_RETIRE_PCT


def _read_primary() -> dict | None:
    if not PRIMARY_SID.exists():
        return None
    sid = PRIMARY_SID.read_text().strip()
    if not sid:
        return None
    floor = PRIMARY_FLOOR.read_text().strip() if PRIMARY_FLOOR.exists() else "easy"
    effort = PRIMARY_EFFORT.read_text().strip() if PRIMARY_EFFORT.exists() else "low"
    return {"sid": sid, "floor": floor, "effort_floor": effort}


def _import_dispatcher():
    """Import buddy_dispatcher lazily to reuse its _buddy_context_used()
    helper without forcing a circular module load."""
    sys.path.insert(0, str(Path(__file__).parent))
    import buddy_dispatcher as _bd  # noqa: E402
    return _bd


def _format_consults(consults: list | None) -> str:
    """Render a `consults=N last=Xago` suffix for cmd_status. Empty when
    no consults recorded — matches the prior status-line shape so seniors
    that have never been called surface unchanged. Accepts None for
    seniors whose metadata predates the consults schema."""
    if not consults:
        return ""
    last = consults[-1] if isinstance(consults[-1], dict) else {}
    last_ts = last.get("ts")
    if last_ts is None:
        last_ts = 0
    ago_s = max(0, int(time.time() - last_ts))
    if ago_s < 60:
        ago = f"{ago_s}s"
    elif ago_s < 3600:
        ago = f"{ago_s // 60}m"
    elif ago_s < 86400:
        ago = f"{ago_s // 3600}h"
    else:
        ago = f"{ago_s // 86400}d"
    return f" consults={len(consults)} last={ago}ago"






# Re-exports — KB crystallization helpers live in buddy_handoff_kb.py.
from buddy_handoff_kb import (  # noqa: F401, E402
    _extract_and_crystallize, _findings_nudge, _record_consult,
    _KB_DIRECTIVE, _KB_BLOCK_RE, _CONSULT_HISTORY_CAP, _FINDING_MARKERS,
)

def _list_seniors() -> list[dict]:
    """List retired seniors, annotating each with `transcript_missing` when
    the senior's JSONL is gone (Claude Code may purge old transcripts).
    A consult against a stale senior fails opaquely; surfacing the state
    upstream lets cmd_status display [stale] and lets future tooling
    refuse consults to dead targets rather than silently failing."""
    if not SENIORS_DIR.exists():
        return []
    bd = _import_dispatcher()
    out = []
    for f in sorted(SENIORS_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            rec = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        sid = rec.get("sid") or ""
        rec["transcript_missing"] = (
            sid != "" and bd._transcript_path_for_sid(sid) is None
        )
        out.append(rec)
    return out


def _retire(primary: dict, reason: str = "") -> dict:
    """Move the primary's metadata to seniors/<sid>.json + append index.
    Clears primary.sid afterward so the next SessionStart spawns fresh."""
    SENIORS_DIR.mkdir(parents=True, exist_ok=True)
    bd = _import_dispatcher()
    ctx = bd._buddy_context_used(primary["sid"])
    record = {
        "sid": primary["sid"],
        "floor": primary["floor"],
        "effort_floor": primary["effort_floor"],
        "retired_at": time.time(),
        "retired_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reason": reason or "manual",
        "context_at_retire": ctx,
    }
    senior_file = SENIORS_DIR / f"{primary['sid']}.json"
    senior_file.write_text(json.dumps(record, indent=2, default=str))
    with SENIORS_INDEX.open("a") as f:
        f.write(json.dumps({"sid": primary["sid"], "retired_at": record["retired_at"],
                            "reason": record["reason"]}) + "\n")
    # Clear primary pointers so SessionStart spawns a fresh primary.
    for p in (PRIMARY_SID, PRIMARY_FLOOR, PRIMARY_EFFORT,
              LEGACY_SID, LEGACY_FLOOR, LEGACY_EFFORT):
        if p.exists():
            p.unlink()
    _emit_activity("buddy_handoff_retire", {
        "sid": primary["sid"], "reason": record["reason"],
        "context_at_retire": ctx,
    })
    return record


def _emit_activity(event: str, payload: dict) -> None:
    """Best-effort activity emit. Matches the convention used by
    buddy_init.sh's _spawn_buddy and the dispatcher's manifest writes.
    Complex values (dict/list) are JSON-encoded so they round-trip
    through emit.py's scalar-only --key=value parser without becoming
    Python-repr strings."""
    emit = PROJECT_ROOT / "tools" / "HME" / "activity" / "emit.py"
    if not emit.exists():
        return
    args = ["--event=" + event]
    for k, v in payload.items():
        if v is None:
            continue
        if isinstance(v, (dict, list)):
            v = json.dumps(v, default=str)
        args.append(f"--{k}={v}")
    import subprocess as _sp
    try:
        _sp.run(["python3", str(emit), *args],
                capture_output=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)})
    except (OSError, _sp.TimeoutExpired):
        pass


def _promote(sid: str, floor: str = "easy", effort: str = "low") -> None:
    # Promotion-from-senior coherence: if `sid` is currently in the
    # senior pool, the same sid would become both primary AND senior —
    # incoherent. Move the senior metadata to seniors/_archive/<sid>.json
    # so the historical record is preserved (consults log, retire
    # metadata) but `_list_seniors` no longer surfaces it.
    senior_file = SENIORS_DIR / f"{sid}.json"
    if senior_file.exists():
        archive_dir = SENIORS_DIR / "_archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive_path = archive_dir / f"{sid}.json"
        # If a prior archive exists (multiple promote/retire cycles for
        # same sid — unusual but possible), suffix with timestamp to
        # avoid overwrite.
        if archive_path.exists():
            archive_path = archive_dir / f"{sid}.{int(time.time())}.json"
        senior_file.rename(archive_path)
    PRIMARY_SID.parent.mkdir(parents=True, exist_ok=True)
    PRIMARY_SID.write_text(sid + "\n")
    PRIMARY_FLOOR.write_text(floor + "\n")
    PRIMARY_EFFORT.write_text(effort + "\n")
    # Mirror to legacy pointers so the dispatcher (which reads the legacy
    # path) sees the new primary immediately, without waiting for the next
    # SessionStart to re-run buddy_init.sh's mirror. Symmetric with
    # _retire(), which clears both pointer trios.
    LEGACY_SID.write_text(sid + "\n")
    LEGACY_FLOOR.write_text(floor + "\n")
    LEGACY_EFFORT.write_text(effort + "\n")
    _emit_activity("buddy_handoff_promote",
                   {"sid": sid, "floor": floor, "effort_floor": effort})


def cmd_status(args: argparse.Namespace) -> int:
    bd = _import_dispatcher()
    primary = _read_primary()
    seniors = _list_seniors()
    threshold = _retire_threshold()
    print(f"hand-off mode: BUDDY_HANDOFF={os.environ.get('BUDDY_HANDOFF', '?')} "
          f"retire_threshold={threshold:.0f}%")
    if primary:
        ctx = bd._buddy_context_used(primary["sid"])
        if ctx is None:
            # Q2 resolution: _buddy_context_used returns None ONLY when
            # the transcript file doesn't exist (Claude Code purged it
            # or it never existed). When the file exists with no
            # assistant events, it returns a 0-token dict — that's the
            # "right after spawn" state and falls into the known%=0
            # branch below, not here. So None means definitively stale.
            ctx_str = "ctx=missing  (transcript purged — primary is stale)"
            ctx_pct = 0.0
        else:
            bar_width = 10
            ctx_pct = ctx["used_pct"]
            filled = int(round(min(ctx_pct, 100.0) / 100.0 * bar_width))
            bar = "#" * filled + "." * (bar_width - filled)
            warn = "  ⚠ RETIRE-DUE" if ctx_pct >= threshold else ""
            ctx_str = f"ctx={ctx['tokens']:>7,}/{ctx['ctx_window']:,} [{bar}] {ctx_pct:5.1f}%{warn}"
        print(f"primary: sid={primary['sid']} floor={primary['floor']} "
              f"effort={primary['effort_floor']} {ctx_str}")
    else:
        print("primary: <none>  (next SessionStart will spawn a fresh primary)")
    senior_hint = ""
    if len(seniors) >= 10:
        # Q8a: surface a hint so the operator knows they can run
        # `i/handoff archive sid=<X>` to thin the active pool. No
        # automatic GC — the operator picks which seniors are still
        # worth hot-loading at status time.
        senior_hint = ("  (consider archiving older entries via "
                       "`i/handoff archive sid=<X>`)")
    print(f"seniors: {len(seniors)} retired{senior_hint}")
    for s in seniors:
        c = s.get("context_at_retire") or {}
        tk = c.get("tokens", 0) if isinstance(c, dict) else 0
        ts = s.get("retired_at_iso", "?")
        reason = s.get("reason", "?")
        sid_short = (s.get("sid", "") or "")[:16]
        consults_str = _format_consults(s.get("consults"))
        stale_str = "  [stale: transcript missing]" if s.get("transcript_missing") else ""
        print(f"  sid={sid_short}... retired={ts} ctx_at_retire={tk:,} "
              f"reason={reason}{consults_str}{stale_str}")
    if getattr(args, "json", False):
        snapshot = {
            "ts": time.time(),
            "handoff_mode": os.environ.get("BUDDY_HANDOFF", ""),
            "retire_threshold_pct": threshold,
            "primary": None,
            "seniors": seniors,
        }
        if primary:
            snapshot["primary"] = {**primary,
                                   "context": bd._buddy_context_used(primary["sid"])}
        log_path = TMP / "hme-buddy-handoff-log.json"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"hand-off log written: {log_path.relative_to(PROJECT_ROOT)}")
    return 0


def cmd_retire(args: argparse.Namespace) -> int:
    primary = _read_primary()
    if primary is None:
        print("no primary to retire (tmp/hme-buddy-primary.sid empty/missing)")
        return 1
    record = _retire(primary, reason=args.reason or "manual")
    print(f"retired sid={record['sid']} -> seniors/{record['sid']}.json")
    print(f"reason: {record['reason']}")
    return 0


def cmd_ensure_primary(args: argparse.Namespace) -> int:
    """Lazy-spawn a primary if none exists (option D from BUDDY_SYSTEM.md
    Q1). Idempotent — when primary.sid is already alive, returns 0
    immediately. Otherwise spawns synchronously via the shared
    buddy_spawn module (also used by buddy_init.sh's backgrounded
    SessionStart spawn) and writes the inaugural-primary trio. No
    polling; the call returns when the spawn completes."""
    primary = _read_primary()
    if primary is not None:
        print(f"primary already alive: sid={primary['sid']}")
        return 0
    # Lazy import to avoid a top-level cycle (buddy_spawn lives in the
    # same scripts/ dir; importing it here keeps buddy_handoff.py
    # importable for tests that mock the spawn).
    sys.path.insert(0, str(Path(__file__).parent))
    import buddy_spawn  # noqa: E402
    legacy_sid_file = TMP / "hme-buddy.sid"
    sid = buddy_spawn.spawn_buddy(
        slot=1, floor="easy", buddy_count=1,
        sid_file=legacy_sid_file,
        project_root=PROJECT_ROOT,
        mark_inaugural_primary=True,
    )
    if sid is None:
        print("ensure_primary: spawn failed (claude -p produced no "
              "session_id)", file=sys.stderr)
        return 1
    print(f"spawned primary: sid={sid} floor=easy effort=low")
    return 0


def cmd_archive(args: argparse.Namespace) -> int:
    """Q8a: move seniors/<sid>.json to seniors/_archive/<sid>.json so the
    senior is hidden from default `i/handoff status` output but remains
    callable via i/consult (which searches both locations). Operator-
    driven — no automatic GC heuristic. The historical record (consults,
    retire metadata) is preserved in archive.

    Symmetric with the auto-archive `_promote()` does when promoting an
    existing senior back to active (Q6); this is the manual variant for
    aging out seniors that haven't been consulted in a while."""
    if not args.sid:
        print("--sid required", file=sys.stderr)
        return 2
    senior_file = SENIORS_DIR / f"{args.sid}.json"
    if not senior_file.exists():
        print(f"sid {args.sid} not in active senior pool "
              f"(check seniors/_archive/ for already-archived)", file=sys.stderr)
        return 1
    archive_dir = SENIORS_DIR / "_archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{args.sid}.json"
    if archive_path.exists():
        archive_path = archive_dir / f"{args.sid}.{int(time.time())}.json"
    senior_file.rename(archive_path)
    print(f"archived sid={args.sid} -> {archive_path.relative_to(PROJECT_ROOT)}")
    return 0


def cmd_promote(args: argparse.Namespace) -> int:
    if not args.sid:
        print("--sid required")
        return 2
    _promote(args.sid, args.floor or "easy", args.effort or "low")
    print(f"promoted sid={args.sid} floor={args.floor or 'easy'} "
          f"effort={args.effort or 'low'}")
    print("(next SessionStart's buddy_init will adopt this sid as the primary)")
    return 0


def cmd_auto_retire_check(args: argparse.Namespace) -> int:
    """Check primary's context %; auto-retire if >= threshold. Idempotent
    and safe to call from dispatcher hot paths."""
    primary = _read_primary()
    if primary is None:
        print("no primary; nothing to check")
        return 0
    bd = _import_dispatcher()
    ctx = bd._buddy_context_used(primary["sid"])
    threshold = _retire_threshold()
    if ctx is None:
        print(f"primary={primary['sid']} ctx=? (no transcript) threshold={threshold:.0f}%; "
              "no action")
        return 0
    if ctx["used_pct"] >= threshold:
        record = _retire(primary, reason=f"auto_retire_at_{ctx['used_pct']:.1f}%")
        print(f"AUTO-RETIRED: primary={primary['sid']} ctx={ctx['used_pct']:.1f}% "
              f">= threshold={threshold:.0f}%")
        print(f"  -> seniors/{record['sid']}.json")
        return 0
    print(f"primary={primary['sid']} ctx={ctx['used_pct']:.1f}% "
          f"< threshold={threshold:.0f}%; no action")
    return 0



# Re-export of cmd_consult (extracted to sibling).
from buddy_handoff_consult import cmd_consult  # noqa: F401, E402

def main() -> int:
    parser = argparse.ArgumentParser(description="Buddy hand-off lifecycle manager")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="show primary + seniors + ctx %%")
    p_status.add_argument("--json", nargs="?", const=True, default=False,
                          help="also write tmp/hme-buddy-handoff-log.json")
    p_status.set_defaults(func=cmd_status)

    p_retire = sub.add_parser("retire", help="manually retire current primary to senior pool")
    p_retire.add_argument("--reason", default="manual",
                          help="reason recorded in the senior's metadata")
    p_retire.set_defaults(func=cmd_retire)

    p_promote = sub.add_parser("promote", help="designate a sid as the primary buddy")
    p_promote.add_argument("--sid", required=True)
    p_promote.add_argument("--floor", default="easy")
    p_promote.add_argument("--effort", default="low")
    p_promote.set_defaults(func=cmd_promote)

    p_auto = sub.add_parser("auto_retire_check",
                            help="check primary ctx; auto-retire if >= threshold")
    p_auto.set_defaults(func=cmd_auto_retire_check)

    p_consult = sub.add_parser("consult", help="manually invoke a specific senior")
    p_consult.add_argument("--sid", required=True)
    p_consult.add_argument("--question", required=True)
    p_consult.set_defaults(func=cmd_consult)

    p_archive = sub.add_parser("archive",
                               help="move a senior out of the active pool to "
                                    "seniors/_archive/ (still callable via i/consult)")
    p_archive.add_argument("--sid", required=True)
    p_archive.set_defaults(func=cmd_archive)

    p_ensure = sub.add_parser("ensure_primary",
                              help="lazy-spawn a primary if none exists "
                                   "(idempotent; option D from BUDDY_SYSTEM.md)")
    p_ensure.set_defaults(func=cmd_ensure_primary)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
