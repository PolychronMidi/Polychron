#!/usr/bin/env python3
"""Explicit, bounded handoff from team routing to peer-channel delivery."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
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
    return (
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
    env = os.environ.copy()
    env.update(child_env)
    env["HME_ASK_PEER_PROJECT_ROOT"] = str(root)
    try:
        proc = subprocess.run(
            [str(SCRIPT_DIR / "ask-peer.sh"), target, _message_with_leash(target, leash, message, child_env)],
            cwd=str(root), env=env, text=True, capture_output=True, timeout=leash["max_duration"], check=False,
        )
    except subprocess.TimeoutExpired as e:
        # A slow peer must not crash the guard with an unhandled traceback; the
        # leash already killed the child at max_duration. Report it structured.
        partial = (e.stdout or "")
        partial = partial.decode("utf-8", "ignore") if isinstance(partial, bytes) else partial
        return 124, partial, f"peer timed out after {leash['max_duration']}s (leash max_duration)"
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    p = argparse.ArgumentParser(description="Leashed team route -> ask-peer handoff")
    p.add_argument("--caller", default=os.environ.get("HME_TEAM_ROLE", "driver"))
    p.add_argument("--tier", choices=sorted(TIER_ORDER), required=True)
    p.add_argument("--depth", type=int, default=None, help="current caller depth; next dispatch increments it")
    p.add_argument("--max-depth", type=int, default=int(os.environ.get("HME_TEAM_MAX_DEPTH", "2")))
    p.add_argument("--budget", type=int, default=int(os.environ.get("HME_TEAM_PEER_BUDGET", "3")))
    p.add_argument("--turn-id", default=os.environ.get("HME_DRIVER_TURN_ID") or os.environ.get("HME_TEAM_TURN_ID") or "")
    p.add_argument("--scope", default="")
    p.add_argument("--artifact", default="")
    p.add_argument("--max-duration", type=int, default=0)
    p.add_argument("--max-tools", type=int, default=0)
    p.add_argument("--duration-cap", type=int, default=int(os.environ.get("HME_TEAM_DURATION_CAP", "1200")))
    p.add_argument("--tool-cap", type=int, default=int(os.environ.get("HME_TEAM_TOOL_CAP", "20")))
    p.add_argument("--max-live", type=int, default=int(os.environ.get("HME_TEAM_MAX_LIVE_TURNS", "8")))
    p.add_argument("--send", action="store_true", help="explicitly call ask-peer.sh after checks pass")
    p.add_argument("--message", default="")
    args = p.parse_args()

    root = PROJECT
    caller = args.caller.strip().lower()
    if not caller:
        return _deny("missing_caller", "caller role is required")

    # F-C: a non-driver caller must carry guard provenance (the token the guard
    # itself sets on children). Optional strict mode rejects a spoofed
    if (os.environ.get("HME_TEAM_STRICT_IDENTITY") == "1"
            and caller != "driver" and os.environ.get("HME_TEAM_DISPATCH_GUARD_OK") != "1"):
        return _deny("identity", f"non-driver caller {caller} lacks guard provenance token")

    leash = _validate_leash(args)
    if isinstance(leash, str):
        return _deny("leash", leash)

    # crew gate before depth so an E1-E2 crew is denied as crew_spawn, not depth.
    effective_tier, crew_error = _effective_tier(caller, args.tier)
    if crew_error:
        return _deny("crew_spawn", crew_error, caller=caller)

    depth = _infer_depth(caller, args.depth)
    if depth is None:  # F-C: fail closed when depth is unknown for a non-driver
        return _deny("depth_unknown", f"depth unknown for non-driver caller {caller}; refusing (fail-closed)", caller=caller)
    next_depth = depth + 1
    if next_depth > args.max_depth:
        return _deny("spawn_depth", f"dispatch depth {next_depth} exceeds cap {args.max_depth}", depth=depth, max_depth=args.max_depth)

    target = resolve_target_for_tier(caller, effective_tier or args.tier)
    if not target:
        return _deny("no_target", f"no available target for {caller} at {effective_tier or args.tier}")
    if target == caller:
        return _deny("self_dispatch", f"router selected caller itself ({caller}); refusing peer loop")

    roles = _roles(root)
    if target not in roles:
        return _deny("unregistered_target", f"target {target} is not in teams/roles.json", target=target)

    # F-A: validate the message BEFORE reserving, so a malformed --send can't
    # consume budget at all.
    if args.send and not args.message.strip():
        return _deny("missing_message", "--send requires --message")

    ok, budget_info, bcode = _reserve_budget(root, args.turn_id, args.budget, caller, args.max_live)
    if not ok:
        return _deny(bcode or "budget", f"dispatch denied ({bcode or 'budget'})", budget=budget_info)

    child_env = {
        "HME_TEAM_ROLE": target,
        "HME_TEAM_CALLER": caller,
        "HME_TEAM_DEPTH": str(next_depth),
        "HME_TEAM_MAX_DEPTH": str(args.max_depth),
        "HME_TEAM_TURN_ROOT": str(budget_info.get("turn_id") or ""),
        "HME_TEAM_DISPATCH_GUARD_OK": "1",
        # Pin the root driver session so every routed peer forks from the
        # driver (inherits full context) rather than minting a blank session.
        "HME_DRIVER_SESSION_ID": os.environ.get("HME_DRIVER_SESSION_ID") or _driver_sid(root),
    }

    out: dict[str, Any] = {
        "allowed": True,
        "caller": caller,
        "target": target,
        "request_tier": args.tier,
        "effective_tier": effective_tier or args.tier,
        "depth": {"current": depth, "next": next_depth, "max": args.max_depth},
        "budget": budget_info,
        "leash": leash,
        "sent": False,
    }
    if args.send:
        code, stdout, stderr = _send(root, target, leash, args.message, child_env)
        if code != 0:
            # F-A: the gated dispatch failed -> refund the reserved unit so a
            # timeout/error never permanently burns the per-turn cap.
            _refund_budget(root, budget_info.get("turn_id"))
            budget_info = {**budget_info, "refunded": True}
            out["budget"] = budget_info
        out.update({"sent": code == 0, "reply": stdout.strip(), "send_stderr": stderr.strip(), "send_exit": code})
    return _out(out)


if __name__ == "__main__":
    raise SystemExit(main())
