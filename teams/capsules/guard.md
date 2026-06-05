# Context Capsule: review team_dispatch_guard.py

## artifact
tools/HME/scripts/team_dispatch_guard.py -- the leashed dispatch guard between
the team router and ask-peer.sh. Enforces depth cap, per-turn budget (flock
reserve+refund), crew gate, leash, global concurrency bound, killpg-on-timeout.

## goal
Find DECISION-CHANGING security/correctness flaws that survive the current
hardening. Only issues that change what we should ship. Cite the function.

## constraints
Usage model today: single-driver, pull-only, sequential dispatch (NOT concurrent
fan-out). Peers run with tools disallowed and --setting-sources user. The guard
is the ONLY path from router to peer.

## rubric
Classify each finding P0 (ship-blocker) / P1 (should-fix) / P2 (nice). For each:
name the function, the exact failure, and the one-line fix. Reject vague style notes.

## coverage
included: the full guard source below (reserve/refund/flock, _send/killpg,
_infer_depth, _effective_tier, _load_budget, main flow).
excluded: ask-peer.sh, team_agent_router.py (assume correct for this review).

## evidence
```python
#!/usr/bin/env python3
"""Explicit, bounded handoff from team routing to peer-channel delivery."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT = Path(os.environ.get("PROJECT_ROOT") or os.getcwd())
BUDGET_REL = Path("tools/HME/runtime/team-dispatch-budget.json")
ROLES_REL = Path("teams/roles.json")
TIER_ORDER = {f"E{i}": i for i in range(1, 6)}
CREW_RE = re.compile(r"^crew_e([1-5])_\d+$")

sys.path.insert(0, str(SCRIPT_DIR))
from team_agent_router import resolve_target_for_tier  # noqa: E402


def _out(obj: dict[str, Any]) -> int:
    print(json.dumps(obj, sort_keys=True))
    return 0


def _deny(code: str, reason: str, **extra: Any) -> int:
    data = {"allowed": False, "code": code, "reason": reason}
    data.update(extra)
    return _out(data)


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return default


def _write_json_atomic(path: Path, data: Any) -> None:
    # F-B: durable atomic write (fsync the data + the rename target's dir) so a
    # crash mid-write can't leave corrupt JSON that later fails open.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def _roles(root: Path) -> dict[str, Any]:
    data = _load_json(root / ROLES_REL, {"roles": {}})
    roles = data.get("roles") if isinstance(data, dict) else {}
    return roles if isinstance(roles, dict) else {}


# Context Capsule contract -- designed by the mesh's own multi-step red/blue
# dialogue: the mechanism that lets multiple grounded independent peers beat a
CAPSULE_REQUIRED = ("artifact", "goal", "rubric")
CAPSULE_OPTIONAL = ("constraints", "evidence", "coverage")
_CAPSULE_HEAD_RE = re.compile(r"^#{1,3}\s+([a-z_]+)\b", re.MULTILINE)


def _load_capsule(path: Path, cap: int) -> tuple[str, list[str]]:
    text = path.read_text(encoding="utf-8", errors="ignore")[:cap]
    sections = {m.group(1).lower() for m in _CAPSULE_HEAD_RE.finditer(text)}
    missing = [s for s in CAPSULE_REQUIRED if s not in sections]
    return text, missing


def _capsule_message(capsule: str, message: str) -> str:
    return (
        "CONTEXT CAPSULE -- ground EVERY claim in a capsule section; if the "
        "capsule lacks evidence for a claim, write 'GAP: <what is missing>' or "
        "decline. Do NOT invent beyond the capsule.\n\n"
        f"{capsule}\n\n---\nTASK (cite capsule sections in your answer):\n{message}"
    )


def _driver_sid(root: Path) -> str:
    """Root driver session id (peers fork it) from the transcript marker."""
    try:
        marker = (root / "tmp" / "hme-transcript-path.txt").read_text().strip()
        return Path(marker).stem if marker else ""
    except OSError:
        return ""


def _infer_depth(caller: str, explicit: int | None) -> int | None:
    # F-C: fail CLOSED. Trust only an explicit --depth or a propagated
    # HME_TEAM_DEPTH; the driver is depth 0 by definition. A non-driver with no
    if explicit is not None:
        return explicit if explicit >= 0 else None
    env = os.environ.get("HME_TEAM_DEPTH", "")
    if env.isdigit():
        return int(env)
    return 0 if caller == "driver" else None


def _crew_tier(role: str) -> str | None:
    m = CREW_RE.match(role)
    return f"E{m.group(1)}" if m else None


def _effective_tier(caller: str, request_tier: str) -> tuple[str | None, str | None]:
    if request_tier not in TIER_ORDER:  # defensive: never index TIER_ORDER with junk
        return None, f"invalid request tier {request_tier!r}"
    crew_tier = _crew_tier(caller)
    if not crew_tier:
        return request_tier, None
    if crew_tier in {"E1", "E2"}:
        return None, "E1-E2 stage crew may not dispatch peers"
    if crew_tier not in {"E3", "E4"}:
        return None, f"unsupported crew tier for {caller}: {crew_tier}"
    if TIER_ORDER[request_tier] > TIER_ORDER[crew_tier]:
        return crew_tier, None
    return request_tier, None


def _validate_leash(args: argparse.Namespace) -> dict[str, Any] | str:
    if not args.scope.strip():
        return "missing --scope"
    if not args.artifact.strip():
        return "missing --artifact"
    if args.max_duration <= 0:
        return "--max-duration must be positive seconds"
    if args.max_tools <= 0:
        return "--max-tools must be positive"
    if args.max_duration > args.duration_cap:
        return f"--max-duration exceeds cap {args.duration_cap}s"
    if args.max_tools > args.tool_cap:
        return f"--max-tools exceeds cap {args.tool_cap}"
    return {
        "scope": args.scope.strip(),
        "artifact": args.artifact.strip(),
        "max_duration": args.max_duration,
        "max_tools": args.max_tools,
    }


def _turn_key(raw: str, caller: str) -> tuple[str | None, bool]:
    if raw:
        return raw, False
    seeded = os.environ.get("HME_TEAM_TURN_ROOT") or ""
    if seeded:
        return seeded, False
    if caller == "driver":
        return f"driver:{os.getppid()}:{int(time.time() // 3600)}", True
    return None, True


def _load_budget(path: Path) -> tuple[dict[str, Any], bool]:
    # F-D: distinguish first-run (missing -> fresh, ok) from corruption
    # (exists but unparseable/wrong-shape -> NOT ok -> caller fails closed,
    if not path.exists():
        return {"turns": {}}, True
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"turns": {}}, False
    if not isinstance(data, dict) or not isinstance(data.get("turns"), dict):
        return {"turns": {}}, False
    return data, True


def _prune_turns(turns: dict[str, Any], now: float) -> None:
    for stale_key in list(turns.keys()):
        try:
            if now - float(turns[stale_key].get("ts", 0)) > 24 * 3600:
                turns.pop(stale_key, None)
        except (AttributeError, TypeError, ValueError):
            turns.pop(stale_key, None)


def _budget_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = open(path.with_name(path.name + ".lock"), "w")  # noqa: SIM115 (held by caller)
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def _reserve_budget(root: Path, turn_id: str, budget: int, caller: str,
                    max_live: int) -> tuple[bool, dict[str, Any], str | None]:
    # F-A/F-B/F-D: atomic (flock) reserve. Commits one unit on success; the
    # caller refunds if the dispatch it gated then fails (reserve-then-refund),
    turn_key, implicit = _turn_key(turn_id, caller)
    if not turn_key:
        return False, {"turn_id": "", "limit": budget, "used": 0, "unscoped": True}, "unscoped"
    path = root / BUDGET_REL
    lock = _budget_lock(path)
    try:
        data, ok = _load_budget(path)
        if not ok:
            return False, {"turn_id": turn_key, "limit": budget, "corrupt": True}, "corrupt_state"
        turns = data["turns"]
        now = time.time()
        _prune_turns(turns, now)
        if turn_key not in turns and len(turns) >= max_live:
            return (False, {"turn_id": turn_key, "limit": budget, "live_turns": len(turns),
                            "max_live": max_live}, "max_live_turns")
        row = turns.setdefault(turn_key, {"count": 0, "ts": now})
        used = int(row.get("count") or 0)
        if used >= budget:
            return False, {"turn_id": turn_key, "limit": budget, "used": used, "implicit": implicit}, "budget"
        row["count"] = used + 1
        row["ts"] = now
        _write_json_atomic(path, data)
        return True, {"turn_id": turn_key, "limit": budget, "used": used + 1, "implicit": implicit}, None
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def _refund_budget(root: Path, turn_key: str | None) -> None:
    if not turn_key:
        return
    path = root / BUDGET_REL
    if not path.exists():
        return
    lock = _budget_lock(path)
    try:
        data, ok = _load_budget(path)
        if not ok:
            return
        row = data["turns"].get(turn_key)
        if row:
            row["count"] = max(0, int(row.get("count") or 0) - 1)
            _write_json_atomic(path, data)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def _message_with_leash(target: str, leash: dict[str, Any], message: str, child_env: dict[str, str]) -> str:
    caller = child_env.get("HME_TEAM_CALLER", "driver")
    return (
        # Role-isolation framing: a peer FORKED from the driver inherits the
        # driver's full context AND its narration. Without this it tends to
        f"You are {target}, a DISTINCT team peer (not the driver). {caller} is asking you.\n"
        f"Answer ONLY in the {target} role; do NOT continue the driver's narration or echo this handoff.\n"
        f"Leashed peer handoff for {target}.\n"
        f"scope: {leash['scope']}\n"
        f"artifact: {leash['artifact']}\n"
        f"max_duration_seconds: {leash['max_duration']}\n"
        f"max_tools: {leash['max_tools']}\n"
        f"dispatch_depth: {child_env['HME_TEAM_DEPTH']} / {child_env['HME_TEAM_MAX_DEPTH']}\n"
        f"turn_budget_id: {child_env['HME_TEAM_TURN_ROOT']}\n\n"
        f"Task:\n{message}"
    )


def _send(root: Path, target: str, leash: dict[str, Any], message: str,
          child_env: dict[str, str]) -> tuple[int, str, str]:
```
