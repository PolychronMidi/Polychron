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
            pass  # silent-ok: best-effort parse
    # .env fallback so the script behaves consistently outside hook env.
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                if line.startswith("BUDDY_RETIRE_PCT="):
                    return float(line.split("=", 1)[1].strip())
        except (OSError, ValueError):
            pass  # silent-ok: best-effort fs op
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
    no consults recorded -- matches the prior status-line shape so seniors
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






# Re-exports -- KB crystallization helpers live in buddy_handoff_kb.py.
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


def _infer_senior_expertise(sid: str) -> list[str]:
    """Scan the senior's transcript for top keyword clusters + KB-CRYSTALLIZE
    block topics. Returns up to 5 topic strings. Closes BUDDY_SYSTEM Q2."""
    bd = _import_dispatcher()
    tp = bd._transcript_path_for_sid(sid)
    if not tp or not Path(tp).is_file():
        return []
    try:
        text = Path(tp).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    import re as _re
    topics: dict[str, int] = {}
    kb_blocks = _re.findall(r"\[\[KB-CRYSTALLIZE\]\][^\n]*\ntitle:\s*([^\n]+)", text, _re.IGNORECASE)
    for kb in kb_blocks:
        topics[kb.strip().lower()[:60]] = topics.get(kb.strip().lower()[:60], 0) + 5
    keyword_clusters = (
        "concurrency", "race", "lock", "mutex",
        "cache", "ttl", "invalidation", "stale",
        "detector", "regex", "false positive",
        "buddy", "dispatch", "subagent", "specialist",
        "auto-flip", "auto-commit", "spec.md", "todo.md",
        "kb crystallize", "tier", "phase",
    )
    for kw in keyword_clusters:
        n = text.lower().count(kw)
        if n > 2:
            topics[kw] = topics.get(kw, 0) + n
    ranked = sorted(topics.items(), key=lambda kv: -kv[1])
    return [t for t, _ in ranked[:5]]


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
        "expertise_topics": _infer_senior_expertise(primary["sid"]),
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
        pass  # silent-ok: best-effort fs op


def _promote(sid: str, floor: str = "easy", effort: str = "low") -> None:
    # Promotion-from-senior coherence: if `sid` is currently in the
    # senior pool, the same sid would become both primary AND senior --
    # incoherent. Move the senior metadata to seniors/_archive/<sid>.json
    # so the historical record is preserved (consults log, retire
    # metadata) but `_list_seniors` no longer surfaces it.
    senior_file = SENIORS_DIR / f"{sid}.json"
    if senior_file.exists():
        archive_dir = SENIORS_DIR / "_archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive_path = archive_dir / f"{sid}.json"
        # If a prior archive exists (multiple promote/retire cycles for
        # same sid -- unusual but possible), suffix with timestamp to
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



# Re-exports -- cmd_consult lives in buddy_handoff_consult, all other
# cmd_* handlers in buddy_handoff_commands. Imported AFTER helpers so
# the commands module can import-back without hitting partially-loaded
# state.
from buddy_handoff_consult import cmd_consult  # noqa: F401, E402
from buddy_handoff_commands import (  # noqa: F401, E402
    cmd_status, cmd_retire, cmd_ensure_primary, cmd_archive,
    cmd_promote, cmd_auto_retire_check,
)





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
    p_consult.add_argument("--sid", default="",
                           help="senior sid (omit to auto-route by expertise match)")
    p_consult.add_argument("--question", required=True)
    p_consult.add_argument("--engine", default="claude-resume",
                           choices=["claude-resume", "synthesis"],
                           help="claude-resume: subprocess (~30-300s, full session resume); "
                                "synthesis: single API call (~5s, persona-bodied, no transcript accumulation)")
    p_consult.add_argument("--senior-consult", action="store_true",
                           help="prefix prompt with [HME-SENIOR-CONSULT] so the proxy skips MODE=4 swap")
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
