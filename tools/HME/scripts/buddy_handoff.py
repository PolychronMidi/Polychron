#!/usr/bin/env python3
"""Buddy hand-off paradigm — primary/senior lifecycle management.

Replaces the multi-buddy floor-pinning model with a single dynamic
primary that retires to a senior pool when its context approaches
auto-compaction. Senior buddies are on standby — their accumulated
context is preserved and only consulted manually for tough problems
(via `i/consult senior=<sid> question="..."`).

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

DEFAULT_RETIRE_PCT = 90.0


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


def _list_seniors() -> list[dict]:
    if not SENIORS_DIR.exists():
        return []
    out = []
    for f in sorted(SENIORS_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            continue
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
    PRIMARY_SID.parent.mkdir(parents=True, exist_ok=True)
    PRIMARY_SID.write_text(sid + "\n")
    PRIMARY_FLOOR.write_text(floor + "\n")
    PRIMARY_EFFORT.write_text(effort + "\n")
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
            ctx_str = "ctx=?  (no transcript)"
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
    print(f"seniors: {len(seniors)} retired")
    for s in seniors:
        c = s.get("context_at_retire") or {}
        tk = c.get("tokens", 0) if isinstance(c, dict) else 0
        ts = s.get("retired_at_iso", "?")
        reason = s.get("reason", "?")
        sid_short = (s.get("sid", "") or "")[:16]
        print(f"  sid={sid_short}... retired={ts} ctx_at_retire={tk:,} reason={reason}")
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


def cmd_consult(args: argparse.Namespace) -> int:
    """Manually invoke a specific senior. Spawns claude --resume <sid> -p
    with the supplied question and prints the response. Each consult call
    grows the senior's transcript like a normal claude invocation."""
    if not args.sid or not args.question:
        print("--sid=<senior-sid> AND --question=\"...\" both required")
        return 2
    senior_file = SENIORS_DIR / f"{args.sid}.json"
    if not senior_file.exists():
        # Allow consulting the active primary too (sometimes useful for
        # cross-checking) but warn the user.
        primary = _read_primary()
        if primary is None or primary["sid"] != args.sid:
            print(f"warning: sid {args.sid} is not in the senior pool", file=sys.stderr)
    import subprocess
    cmd = ["claude", "--resume", args.sid, "-p", args.question]
    print(f"# consulting senior sid={args.sid}", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=True, text=True,
                            env={**os.environ, "HME_THREAD_CHILD": "1"},
                            timeout=300)
    if result.stdout:
        sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    return result.returncode


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

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
