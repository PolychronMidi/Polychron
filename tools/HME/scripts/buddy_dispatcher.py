#!/usr/bin/env python3
"""Co-buddy fanout dispatcher -- drains tmp/hme-buddy-queue/pending/ and
routes each task to the appropriate co-buddy based on the
`effective = max(item_tier, buddy_floor)` rule.

Architecture (from doc/templates/SPEC.md Phase 1):
- Queue dir: tmp/hme-buddy-queue/{pending,processing,done,failed}/
- Each task is a JSON file dropped into pending/ by a producer
  (i/todo ingest_from_spec, NEXUS auto-review, OVERDRIVE cascade, etc.)
- Atomic claim semantics: dispatcher renames pending/<task> ->
  processing/<buddy-N>/<task>; first-mv-wins. Crashes leave a half-
  claimed file in processing/ that the next iter's drafts sweep
  consumes (Phase 2.1).
- Sentinel: buddy emits `[no-work] <reason>` on stdout when its task
  completes AND the queue is drained. Dispatcher reads stdout until
  sentinel as positive idle declaration (closes the "response read
  prematurely" failure mode the user flagged).
- Per-run manifest: tmp/hme-buddy-fanout/<run-id>/manifest.json with
  `iterations`, `loop.terminated_by`, per-buddy `pid/sid/task_count/
  tier_distribution`. Snapshot-write per task with `in_progress: true`
  so a watcher can read partial state without false-positive findings.

Task file shape (JSON):
  {
    "id": str,                 # unique task id (caller-assigned)
    "tier": "E1"|"E2"|"E3"|"E4"|"E5",  # legacy easy/medium/hard accepted, translated
    "text": str,               # task description
    "source": str,             # who queued it (e.g. "i/todo", "auto_review")
    "ts": float,               # epoch seconds when queued
    "context": {...}           # opaque per-source payload
  }

Usage:
  buddy_dispatcher.py drain      # drain queue once, exit when empty
  buddy_dispatcher.py drain --loop  # keep running, sleep between drains
  buddy_dispatcher.py enqueue --tier=E3 --text="..." --source=manual

The dispatcher is invoked from posttooluse hooks / NEXUS / overdrive when
they need work farmed out. Single-process; multiple producers can drop
files concurrently (filesystem-IPC philosophy).
"""
from __future__ import annotations

# When invoked as a script (`python3 buddy_dispatcher.py <cmd>`), the
# module name is "__main__" -- sibling modules importing
# `from buddy_dispatcher import X` would otherwise re-execute the file
# and hit a circular import. Register self under the canonical name so
# they find the in-progress module instead.
import sys as _sys
if __name__ == "__main__" and "buddy_dispatcher" not in _sys.modules:
    _sys.modules["buddy_dispatcher"] = _sys.modules[__name__]

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Project paths -- derived from PROJECT_ROOT or relative to this script.
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
QUEUE_ROOT = PROJECT_ROOT / "tmp" / "hme-buddy-queue"
QUEUE_PENDING = QUEUE_ROOT / "pending"
QUEUE_PROCESSING = QUEUE_ROOT / "processing"
QUEUE_DONE = QUEUE_ROOT / "done"
QUEUE_FAILED = QUEUE_ROOT / "failed"
FANOUT_ROOT = PROJECT_ROOT / "tmp" / "hme-buddy-fanout"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"

# Floor-based escalation -- E1..E5 ordinal scale; max-rule for dispatch.
# See doc/BUDDY_SYSTEM.md tier section. Legacy easy/medium/hard translate.
TIER_ORDER = {"E1": 0, "E2": 1, "E3": 2, "E4": 3, "E5": 4}
TIER_NAMES = ("E1", "E2", "E3", "E4", "E5")
_LEGACY_TIER_MAP = {"easy": "E2", "medium": "E3", "hard": "E4"}


def _translate_legacy_tier(tier: str) -> str:
    """Coerce legacy easy/medium/hard or unknown values to E1..E5. Unknown -> E3."""
    if not tier:
        return "E3"
    t = str(tier).strip()
    if t.upper() in TIER_NAMES:
        return t.upper()
    return _LEGACY_TIER_MAP.get(t.lower(), "E3")


# Effort axis stays low/medium/high (Anthropic native subagent effort levels).
EFFORT_ORDER = {"low": 0, "medium": 1, "high": 2}
EFFORT_NAMES = ("low", "medium", "high")
# E1-E2 -> low (cheap); E3 -> medium; E4-E5 -> high.
TIER_TO_EFFORT = {"E1": "low", "E2": "low", "E3": "medium", "E4": "high", "E5": "high"}
# Per-tier dispatch timeout (seconds). Single source of truth; lifecycle reads here.
TIER_TO_TIMEOUT_S = {"E1": 60, "E2": 60, "E3": 300, "E4": 600, "E5": 900}

# Sentinel emitted by buddies when idle. The dispatcher reads stdout
# until this line appears OR a hard timeout fires.
NO_WORK_SENTINEL = "[no-work]"

# Phase 2 paths.
GUIDANCE_FILE = PROJECT_ROOT / "tmp" / "hme-operator-guidance.md"

# Chain YAML lookup paths (project-local first, then HME-shipped).
CHAIN_DIRS = [
    PROJECT_ROOT / "chains",
    PROJECT_ROOT / "tools" / "HME" / "chains",
]

# Rate-limit detection patterns (lifted from skill-set Phase 13). When
# a buddy subprocess exits with stderr matching one of these, the task
# isn't a real failure -- it's quota exhaustion that resets in the future.
# Pause-and-resume re-dispatches the same task after the reset window.
RATE_LIMIT_TEXT_RE = re.compile(
    r"rate.?limit|"
    r"you'?ve hit your\s+\w+\s+rate limit|"
    r"5-?hour\s+(rate\s+)?limit|"
    r"out of (extra )?usage|"
    r"quota\s+exceeded|"
    r"too many requests",
    re.IGNORECASE,
)
# Field-name aliases for rate-limit signals -- Anthropic's harness has
# drifted across versions (resetsAt / reset_time / resetTime / resets_at;
# retryAfterSeconds / retry_after_seconds / retryAfter). Defensive
# extraction tries each in priority order. Lifted from skill-set
# Phase 13 live-failure follow-ups (their structured-event schema
# changed twice in production).
_RATE_LIMIT_RESET_FIELDS = ("resetsAt", "reset_time", "resetTime", "resets_at", "reset")
_RATE_LIMIT_RETRY_FIELDS = ("retryAfterSeconds", "retry_after_seconds", "retryAfter", "retry_after")

# Build a regex alternation from the alias lists so the text-parser
# catches each form. Without this, the aliases above were dead constants;
# this wires them into the actual detection path. Pattern shape:
# `<fieldname>` followed by optional quote/bracket then ":" or "=" then
# numeric value (epoch seconds OR retry-after-seconds).
_RATE_LIMIT_RESET_FIELD_ALT = "|".join(re.escape(f) for f in _RATE_LIMIT_RESET_FIELDS)
_RATE_LIMIT_RETRY_FIELD_ALT = "|".join(re.escape(f) for f in _RATE_LIMIT_RETRY_FIELDS)
RATE_LIMIT_RESET_RE = re.compile(
    r"resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s+\(([^)]+)\))?|"
    r"resets?\s+in\s+(\d+)\s+(?:hour|hr|minute|min)s?|"
    rf"(?:{_RATE_LIMIT_RESET_FIELD_ALT})[\"']?\s*[:=]\s*[\"']?(\d+)|"
    rf"(?:{_RATE_LIMIT_RETRY_FIELD_ALT})[\"']?\s*[:=]\s*[\"']?(\d+)",
    re.IGNORECASE,
)
RATE_LIMIT_JITTER_RANGE = (15, 60)              # extra seconds after parsed reset
RATE_LIMIT_FALLBACK_BACKOFF_SECONDS = 300       # initial backoff when no reset_time

# Per-task pause/retry caps (env-tunable; defaults match skill-set).
_RATE_LIMIT_MODE = os.environ.get("HME_BUDDY_ON_RATE_LIMIT", "pause")  # fail|pause|pause-with-cap
_MAX_RATE_LIMIT_PAUSE_SECONDS = int(os.environ.get("HME_BUDDY_MAX_PAUSE_SEC", str(8 * 3600)))
_MAX_PAUSES_PER_TASK = int(os.environ.get("HME_BUDDY_MAX_PAUSES_PER_TASK", "3"))

# Dispatch mode -- decouples the dispatcher from the buddy fanout's
# `claude --resume <sid>` worker so the queue + orphan-sweep + verdict
# infrastructure stays useful even when BUDDY_SYSTEM=0.
#
# DESIGN INVARIANT: no path here uses raw Anthropic API. claude-resume
# spawns the Claude Code CLI binary (consumes Max subscription quota,
# same channel as interactive sessions); synthesis routes through HME's
# cascade providers (NVIDIA/Cerebras/Groq/Gemini per synthesis_config.py).
#
#   claude-resume  default when BUDDY_SYSTEM=1; spawns the `claude` CLI
#                  per task against the buddy's persistent session
#                  (model+effort routing, etc.). Original behavior.
#   synthesis      routes each task through synthesis_reasoning.call() --
#                  HME's local/cascade reasoning path. No Anthropic
#                  involvement at all. Effective when Max session quota
#                  is exhausted but cascade providers are still healthy.
#   disabled       no dispatcher activity; enqueue sentinel skips, drain
#                  refuses. Default when BUDDY_SYSTEM=0 + no override.
#                  Equivalent to pre-integration behavior.
#
# Resolution: HME_DISPATCH_MODE env wins; otherwise BUDDY_SYSTEM=1 ->
# claude-resume, BUDDY_SYSTEM=0 -> disabled. OVERDRIVE_MODE=5 overrides:
# all dispatch MUST be Anthropic-free (synthesis-only or disabled).
_BUDDY_SYSTEM_FLAG = os.environ.get("BUDDY_SYSTEM", "0").strip()
_DISPATCH_MODE = os.environ.get("HME_DISPATCH_MODE", "").strip().lower()
_OD_MODE = os.environ.get("OVERDRIVE_MODE", "0").strip()
if not _DISPATCH_MODE:
    if _OD_MODE == "5":
        _DISPATCH_MODE = "synthesis"
    elif _BUDDY_SYSTEM_FLAG == "1":
        _DISPATCH_MODE = "claude-resume"
    else:
        _DISPATCH_MODE = "disabled"
if _DISPATCH_MODE not in ("claude-resume", "synthesis", "disabled"):
    _DISPATCH_MODE = "disabled"
# OVERDRIVE_MODE=5 hard-lock: claude-resume is NEVER allowed (Anthropic quota).
if _OD_MODE == "5" and _DISPATCH_MODE == "claude-resume":
    _DISPATCH_MODE = "synthesis"

# HME_DISPATCH_SYNTHESIS_TIERS: tiers (E1..E5) routed through synthesis_reasoning (free cascade) instead of buddies.
# Canonical use: E1,E2 (cheap tasks skip the buddy quota). Empty = no override.
def _parse_tier_set(raw: str) -> set:
    """Accepts E1..E5 or legacy easy/medium/hard (translated). Empty strings dropped."""
    out = set()
    for t in (raw or "").split(","):
        t = t.strip()
        if not t:
            continue
        translated = _translate_legacy_tier(t)
        if translated in TIER_NAMES:
            out.add(translated)
    return out

_SYNTHESIS_TIERS = _parse_tier_set(os.environ.get("HME_DISPATCH_SYNTHESIS_TIERS", ""))
# HME_DISPATCH_MODE=synthesis explicit: all tiers route through synthesis (E1..E5).
if _DISPATCH_MODE == "synthesis":
    _SYNTHESIS_TIERS = set(TIER_NAMES)


def _ensure_dirs() -> None:
    for p in (QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_DONE, QUEUE_FAILED, FANOUT_ROOT):
        p.mkdir(parents=True, exist_ok=True)


def _atomic_write(target: Path, content: str) -> None:
    """Atomic file write via same-directory temp + os.replace. Same
    filesystem keeps rename atomic per POSIX; PID suffix avoids
    collision with concurrent writers. Drop-in upgrade for any state
    file write where partial-write corruption would be a real failure
    mode (manifests, verdict files, watermarks). Skill-set's
    apply-skill-patch.py uses this pattern for SKILL.md replacement;
    same shape applies to JSON state files here."""
    tmp = target.parent / f"{target.name}.tmp-{os.getpid()}"
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(str(tmp), str(target))


# ANSI escape sequence stripper -- claude-cli emits color codes when its
# stdout is a TTY *or* when its parent doesn't pass through a non-TTY
# signal cleanly. Captured stdout/stderr land in JSON manifests +
# verdict markdown; ANSI codes there are noise that makes diff/grep
# fragile. Strip at sink time (per skill-set skill-chain.py:543-567
# tee-with-strip pattern) so the on-disk artifact is clean.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")


def _strip_ansi(text: str) -> str:
    if not text:
        return text
    return _ANSI_RE.sub("", text)


def _is_pid_alive(pid: int) -> bool:
    """Liveness probe via os.kill(pid, 0) -- distinguishes stale PID
    files from live processes. PermissionError = alive but other-user;
    ProcessLookupError = dead. Lifted from skill-set drive-chain.py;
    drop-in upgrade for any PID-file consumer."""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True  # exists, just not ours
    except ProcessLookupError:
        return False
    except OSError:
        return False


def _log_error(msg: str) -> None:
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] [buddy_dispatcher] {msg}\n")



def cmd_clean(args: argparse.Namespace) -> int:
    """Clean stale fanout artifacts. Removes done/ entries older than
    --age-hours (default 168 = 7 days) and finalizes any orphan runs
    in fanout/<run-id>/ with in_progress=true that haven't been
    touched in >24h. Mirrors skill-set's bin/clean-skill-runs.py."""
    _ensure_dirs()
    age_seconds = float(args.age_hours) * 3600
    now = time.time()
    cleaned = {"done": 0, "failed": 0, "fanout_runs_finalized": 0}
    for d, key in ((QUEUE_DONE, "done"), (QUEUE_FAILED, "failed")):
        if not d.exists():
            continue
        for f in d.glob("*.json"):
            if (now - f.stat().st_mtime) > age_seconds:
                try:
                    f.unlink()
                    cleaned[key] += 1
                except OSError:
                    pass  # silent-ok: best-effort fs op
    if FANOUT_ROOT.exists():
        for run_dir in FANOUT_ROOT.iterdir():
            if not run_dir.is_dir():
                continue
            manifest_path = run_dir / "manifest.json"
            if not manifest_path.exists():
                continue
            try:
                m = json.loads(manifest_path.read_text())
            except Exception:
                continue
            if m.get("in_progress") and (now - manifest_path.stat().st_mtime) > 86400:
                m["in_progress"] = False
                m["loop"]["terminated_by"] = m.get("loop", {}).get("terminated_by", "abandoned")
                manifest_path.write_text(json.dumps(m, indent=2))
                cleaned["fanout_runs_finalized"] += 1
    print(f"clean: removed {cleaned['done']} done + {cleaned['failed']} failed task files older than {args.age_hours}h")
    print(f"clean: finalized {cleaned['fanout_runs_finalized']} abandoned fanout runs")
    return 0


def cmd_enqueue(args: argparse.Namespace) -> int:
    """Drop a task file into pending/. Caller assigns id; if missing,
    we generate one. Used by producers (NEXUS auto-review, OVERDRIVE,
    i/todo ingest_from_spec, etc.) to queue work for the fanout."""
    _ensure_dirs()
    task = {
        "id": args.id or uuid.uuid4().hex[:12],
        "tier": _translate_legacy_tier(args.tier),
        "text": args.text,
        "source": args.source,
        "ts": time.time(),
        "context": json.loads(args.context) if args.context else {},
    }
    target = QUEUE_PENDING / f"{task['id']}.json"
    target.write_text(json.dumps(task, indent=2))
    print(f"enqueued {target.relative_to(PROJECT_ROOT)} (tier={task['tier']}, source={task['source']})")
    return 0



# Ensure sibling modules are importable when buddy_dispatcher is loaded
# via spec_from_file_location (test harness doesn't auto-add script dir).
import sys, os  # noqa: E402
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Re-exports: buddy_handoff.py and tests import these symbols from
# `buddy_dispatcher` directly. Keep that surface stable after the split.
from buddy_dispatch_routing import (  # noqa: F401, E402
    _list_buddies, _effective_tier, _effective_effort, _pick_buddy_for_task,
)
from buddy_dispatch_drain import (  # noqa: F401, E402
    _GUIDANCE_MAX_BYTES, _read_guidance, _fast_path_clean, cmd_drain,
)
from buddy_dispatch_lifecycle import (  # noqa: F401, E402
    _write_manifest, _claim_task, _dispatch_to_buddy,
    _archive_task, _sweep_orphans, _write_verdict,
)
from buddy_dispatch_ratelimit import _detect_rate_limit  # noqa: F401, E402
from buddy_dispatch_chain import (  # noqa: F401, E402
    _load_chain_yaml, _parse_minimal_yaml, _validate_chain,
    cmd_chain, _run_skill, _compute_pause_seconds,
)
from buddy_dispatch_status import (  # noqa: F401, E402
    _transcript_path_for_sid, _buddy_context_used,
    _discover_buddy_sessions, cmd_status,
)

def main() -> int:
    parser = argparse.ArgumentParser(description="Co-buddy fanout dispatcher")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_drain = sub.add_parser("drain", help="drain pending/ once")
    p_drain.add_argument("--loop", action="store_true", help="keep draining; sleep between passes")
    p_drain.add_argument("--loop-delay", type=float, default=5.0, help="seconds between loop passes")
    p_drain.set_defaults(func=cmd_drain)
    p_enq = sub.add_parser("enqueue", help="drop a task into pending/")
    p_enq.add_argument("--tier", default="E3",
                       choices=tuple(TIER_NAMES) + tuple(_LEGACY_TIER_MAP.keys()))
    p_enq.add_argument("--text", required=True)
    p_enq.add_argument("--source", default="manual")
    p_enq.add_argument("--id", default="")
    p_enq.add_argument("--context", default="", help="JSON-encoded payload")
    p_enq.set_defaults(func=cmd_enqueue)
    p_stat = sub.add_parser("status", help="show queue + buddy state")
    # nargs='?' so `i/dispatch status json=true` and bare `--json` both work
    # (the i/dispatch wrapper rewrites k=v to --k=v).
    p_stat.add_argument("--json", nargs="?", const=True, default=False,
                        help="also write tmp/hme-buddy-session-log.json with per-buddy sid+ctx%%")
    p_stat.set_defaults(func=cmd_status)
    p_chain = sub.add_parser("chain", help="run a chain YAML (ordered skill sequence)")
    p_chain.add_argument("chain_name", help="chain name (matches <name>.yaml in chains/)")
    p_chain.add_argument("--loop", type=int, default=None, help="iteration count override (chain YAML default applies otherwise)")
    p_chain.add_argument("--on-rate-limit", choices=("fail", "pause", "pause-with-cap"), default=None,
                         help="rate-limit handling override (fail|pause|pause-with-cap)")
    p_chain.set_defaults(func=cmd_chain)
    p_clean = sub.add_parser("clean", help="prune stale fanout artifacts (done/failed older than age-hours)")
    p_clean.add_argument("--age-hours", type=float, default=168, help="entries older than this (default 168 = 7d) get pruned")
    p_clean.set_defaults(func=cmd_clean)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
