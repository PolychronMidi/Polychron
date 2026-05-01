"""CLI command handlers for buddy_handoff.py.

Each cmd_* function takes the parsed argparse.Namespace and returns an exit
code. The buddy_handoff parent module is imported lazily inside _bh() to
avoid a circular import: this module's top-level import chain goes
buddy_handoff -> buddy_handoff_commands; if we imported buddy_handoff at
top level here too we'd hit a partially-initialized module when the parent
is imported first (e.g. from a test that does `import buddy_handoff_commands`
directly).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def _bh():
    import buddy_handoff
    return buddy_handoff


def cmd_status(args: argparse.Namespace) -> int:
    bd = _bh()._import_dispatcher()
    primary = _bh()._read_primary()
    seniors = _bh()._list_seniors()
    threshold = _bh()._retire_threshold()
    print(f"hand-off mode: BUDDY_HANDOFF={os.environ.get('BUDDY_HANDOFF', '?')} "
          f"retire_threshold={threshold:.0f}%")
    if primary:
        ctx = bd._buddy_context_used(primary["sid"])
        if ctx is None:
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
        senior_hint = ("  (consider archiving older entries via "
                       "`i/handoff archive sid=<X>`)")
    print(f"seniors: {len(seniors)} retired{senior_hint}")
    for s in seniors:
        c = s.get("context_at_retire") or {}
        tk = c.get("tokens", 0) if isinstance(c, dict) else 0
        ts = s.get("retired_at_iso", "?")
        reason = s.get("reason", "?")
        sid_short = (s.get("sid", "") or "")[:16]
        consults_str = _bh()._format_consults(s.get("consults"))
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
        log_path = _bh().TMP / "hme-buddy-handoff-log.json"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"hand-off log written: {log_path.relative_to(_bh().PROJECT_ROOT)}")
    return 0


def cmd_retire(args: argparse.Namespace) -> int:
    primary = _bh()._read_primary()
    if primary is None:
        print("no primary to retire (tmp/hme-buddy-primary.sid empty/missing)")
        return 1
    record = _bh()._retire(primary, reason=args.reason or "manual")
    print(f"retired sid={record['sid']} -> seniors/{record['sid']}.json")
    print(f"reason: {record['reason']}")
    return 0


def cmd_ensure_primary(args: argparse.Namespace) -> int:
    """Lazy-spawn a primary if none exists. Idempotent — when primary.sid
    is already alive, returns 0 immediately."""
    primary = _bh()._read_primary()
    if primary is not None:
        print(f"primary already alive: sid={primary['sid']}")
        return 0
    sys.path.insert(0, str(Path(__file__).parent))
    import buddy_spawn  # noqa: E402
    legacy_sid_file = _bh().TMP / "hme-buddy.sid"
    sid = buddy_spawn.spawn_buddy(
        slot=1, floor="easy", buddy_count=1,
        sid_file=legacy_sid_file,
        project_root=_bh().PROJECT_ROOT,
        mark_inaugural_primary=True,
    )
    if sid is None:
        print("ensure_primary: spawn failed (claude -p produced no "
              "session_id)", file=sys.stderr)
        return 1
    print(f"spawned primary: sid={sid} floor=easy effort=low")
    return 0


def cmd_archive(args: argparse.Namespace) -> int:
    """Move seniors/<sid>.json to seniors/_archive/<sid>.json so the senior
    is hidden from default `i/handoff status` output but remains callable
    via i/consult (which searches both locations)."""
    if not args.sid:
        print("--sid required", file=sys.stderr)
        return 2
    senior_file = _bh().SENIORS_DIR / f"{args.sid}.json"
    if not senior_file.exists():
        print(f"sid {args.sid} not in active senior pool "
              f"(check seniors/_archive/ for already-archived)", file=sys.stderr)
        return 1
    archive_dir = _bh().SENIORS_DIR / "_archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{args.sid}.json"
    if archive_path.exists():
        archive_path = archive_dir / f"{args.sid}.{int(time.time())}.json"
    senior_file.rename(archive_path)
    print(f"archived sid={args.sid} -> {archive_path.relative_to(_bh().PROJECT_ROOT)}")
    return 0


def cmd_promote(args: argparse.Namespace) -> int:
    if not args.sid:
        print("--sid required")
        return 2
    _bh()._promote(args.sid, args.floor or "easy", args.effort or "low")
    print(f"promoted sid={args.sid} floor={args.floor or 'easy'} "
          f"effort={args.effort or 'low'}")
    print("(next SessionStart's buddy_init will adopt this sid as the primary)")
    return 0


def cmd_auto_retire_check(args: argparse.Namespace) -> int:
    """Check primary's context %; auto-retire if >= threshold. Idempotent
    and safe to call from dispatcher hot paths."""
    primary = _bh()._read_primary()
    if primary is None:
        print("no primary; nothing to check")
        return 0
    bd = _bh()._import_dispatcher()
    ctx = bd._buddy_context_used(primary["sid"])
    threshold = _bh()._retire_threshold()
    if ctx is None:
        print(f"primary={primary['sid']} ctx=? (no transcript) threshold={threshold:.0f}%; "
              "no action")
        return 0
    if ctx["used_pct"] >= threshold:
        record = _bh()._retire(primary, reason=f"auto_retire_at_{ctx['used_pct']:.1f}%")
        print(f"AUTO-RETIRED: primary={primary['sid']} ctx={ctx['used_pct']:.1f}% "
              f">= threshold={threshold:.0f}%")
        print(f"  -> seniors/{record['sid']}.json")
        return 0
    print(f"primary={primary['sid']} ctx={ctx['used_pct']:.1f}% "
          f"< threshold={threshold:.0f}%; no action")
    return 0
