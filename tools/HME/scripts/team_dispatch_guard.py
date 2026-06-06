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
    # F-B + measured-round finding: durable atomic write fsyncs BOTH the data
    # file AND the rename target's directory, so a crash after the rename can't
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)
    try:
        dfd = os.open(str(path.parent), os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass  # silent-ok: pending review  # dir fsync best-effort (some filesystems disallow); data fsync already done


def _roles(root: Path) -> dict[str, Any]:
    data = _load_json(root / ROLES_REL, {"roles": {}})
    roles = data.get("roles") if isinstance(data, dict) else {}
    return roles if isinstance(roles, dict) else {}


def _dashboard_agents(root: Path) -> dict[str, Any]:
    data = _load_json(root / "tools/HME/runtime/team-dashboard.json", {"agents": {}})
    agents = data.get("agents") if isinstance(data, dict) else {}
    return agents if isinstance(agents, dict) else {}


def _dashboard_available(row: Any) -> bool:
    return isinstance(row, dict) and row.get("status") not in {"retired", "failed", "done"}


# Context Capsule contract -- designed by the mesh's own multi-step red/blue
# dialogue: the mechanism that lets multiple grounded independent peers beat a
CAPSULE_REQUIRED = ("artifact", "goal", "rubric")
CAPSULE_OPTIONAL = ("constraints", "evidence", "coverage")
_CAPSULE_HEAD_RE = re.compile(r"^#{1,3}\s+([a-z_]+)\b", re.MULTILINE)


def _load_capsule(path: Path, cap: int) -> tuple[str, list[str]]:
    text = path.read_text(encoding="utf-8", errors="ignore")[:cap]
    # Fence-aware: a `# goal` line inside a ``` code fence is a code comment, not
    # a real section heading, so it must not falsely satisfy a required section.
    sections = {name for _s, _e, name in _capsule_headings(text)}
    missing = [s for s in CAPSULE_REQUIRED if s not in sections]
    return text, missing


def _capsule_headings(text: str) -> list[tuple[int, int, str]]:
    # Heading scan that is FENCE-AWARE: a `#` line inside a ``` code fence is a
    # code comment (e.g. bash/python `# keep whole turns`), NOT a capsule section
    out: list[tuple[int, int, str]] = []
    in_fence = False
    pos = 0
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
        elif not in_fence:
            m = _CAPSULE_HEAD_RE.match(line)
            if m:
                out.append((pos + m.start(), pos + m.end(), m.group(1).lower()))
        pos += len(line)
    return out


def _capsule_section_bodies(text: str) -> dict[str, str]:
    # Split a capsule into {section_name: body_text}, fence-aware, so a
    # coverage<->evidence consistency check can compare what coverage CLAIMS is
    bodies: dict[str, str] = {}
    heads = _capsule_headings(text)
    for i, (_start, end_h, name) in enumerate(heads):
        body_end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        bodies[name] = text[end_h:body_end]
    return bodies


# A "code symbol" claim worth verifying: backtick-quoted token, an identifier
# bearing an underscore (e.g. _reserve_budget), or one written with call parens
_COVERAGE_SYMBOL_RE = re.compile(r"`([^`]+)`|\b([A-Za-z_][A-Za-z0-9_]*(?:\(\))?)")
_CODE_SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _capsule_coverage_gaps(text: str) -> list[str]:
    bodies = _capsule_section_bodies(text)
    coverage = bodies.get("coverage")
    evidence = bodies.get("evidence")
    # Only enforce when BOTH sections exist: coverage makes claims, evidence is
    # where they must be honored. No coverage section -> nothing claimed to check.
    if not coverage or not evidence:
        return []
    # Restrict to the "included:" clause (what coverage asserts IS present); the
    # "excluded:" clause names things deliberately absent and must not be checked.
    inc = coverage
    low = coverage.lower()
    i = low.find("included:")
    if i != -1:
        inc = coverage[i + len("included:"):]
        x = inc.lower().find("excluded:")
        if x != -1:
            inc = inc[:x]
    claimed: list[str] = []
    seen: set[str] = set()
    for m in _COVERAGE_SYMBOL_RE.finditer(inc):
        backticked = m.group(1) is not None
        raw = (m.group(1) or m.group(2) or "").strip()
        parened = raw.endswith("()")
        tok = raw.rstrip("()")
        if not tok or tok in seen:
            continue
        # A symbol worth verifying = looks like code: an underscore-bearing
        # identifier, or one explicitly backtick/paren-quoted. Plain prose words
        is_code = ("_" in tok) or backticked or parened
        if not (_CODE_SYMBOL_RE.match(tok) and is_code):
            continue
        seen.add(tok)
        claimed.append(tok)
    return [s for s in claimed if s not in evidence]


_CAPSULE_LANG = {
    ".py": "python", ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "ts",
    ".sh": "bash", ".bash": "bash", ".json": "json", ".md": "markdown",
}
_CAPSULE_REF_RE = re.compile(r"\.[A-Za-z0-9]+$")


def _capsule_evidence_refs(text: str) -> list[str]:
    """Repo-relative file paths referenced (not embedded) in ## evidence -- the
    mechanism that lets a capsule point at LIVE source so its evidence can never
    drift into a stale frozen copy. Tokens inside ``` fences are ignored (those
    are inlined source, not references)."""
    evidence = _capsule_section_bodies(text).get("evidence")
    if not evidence:
        return []
    refs: list[str] = []
    seen: set[str] = set()
    in_fence = False
    for line in evidence.splitlines():
        s = line.strip()
        if s.startswith("```") or s.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence or not s:
            continue
        tok = s.lstrip("-*").strip().strip("`")
        if "/" in tok and " " not in tok and _CAPSULE_REF_RE.search(tok) and tok not in seen:
            seen.add(tok)
            refs.append(tok)
    return refs


def _resolve_capsule(text: str, root: Path, cap: int) -> str:
    """Inline the LIVE content of every ## evidence file reference so the peer is
    grounded on CURRENT source, never a frozen snapshot. A capsule that still
    embeds source (no file refs) is returned unchanged -- backward compatible."""
    refs = _capsule_evidence_refs(text)
    if not refs:
        return text
    blocks: list[str] = []
    used = 0
    for ref in refs:
        path = root / ref
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            blocks.append(f"\n{ref} (live)\nMISSING: referenced source not found at dispatch.\n")
            continue
        budget = cap - used
        if budget <= 0:
            blocks.append(f"\n{ref} (live)\n(... omitted: context cap reached ...)\n")
            continue
        body = content[:budget]
        used += len(body)
        lang = _CAPSULE_LANG.get(path.suffix.lower(), "")
        note = "" if len(body) == len(content) else "\n... truncated to context cap ..."
        blocks.append(f"\n{ref} (live)\n```{lang}\n{body}{note}\n```\n")
    return text + "\n" + "".join(blocks)


def _capsule_message(capsule: str, message: str) -> str:
    return (
        "CONTEXT CAPSULE -- ground EVERY claim in a capsule section; if the "
        "capsule lacks evidence for a claim, write 'GAP: <what is missing>' or "
        "decline. Do NOT invent beyond the capsule.\n\n"
        f"{capsule}\n\n---\nTASK (cite capsule sections in your answer):\n{message}"
    )


# Opt-in calibrated claim-audit addendum (Audit Protocol grammar). Appended to a
# high-impact review task via --claim-audit so routine reviews stay lightweight.
CLAIM_AUDIT_ADDENDUM = (
    "\n\n---\nCLAIM-AUDIT DISCIPLINE (calibrated, anti-inflation). For EACH "
    "decision-changing finding report: claim (one sentence); where (artifact + "
    "function/block); failure mode; precondition; supporting evidence (cite "
    "source lines / tests / logs / verifier output); contradictory evidence "
    "(cite any plausible existing guard/test/code-path you checked and why it "
    "does or does NOT cover this, OR state 'none found after checking <paths>'. "
    "Absence of a plausible counter-check does NOT lower confidence by itself -- "
    "only an UNCHECKED plausible counter-path does. A real defect on an unguarded "
    "surface stays a real defect); one-line fix; severity (P0/P1/P2); "
    "thoroughness (read-only | +adjacent-tests/config | +runtime-repro/invariant); "
    "decision-impact (load-bearing | substantive | peripheral); confidence "
    "(low/med/high).\nFINDING-DEATH IS SUCCESS: if after completing the requested "
    "checks you find no decision-changing issue, state 'no decision-changing issue "
    "found' WITH evidence -- never invent or inflate to seem useful, and never use "
    "this to avoid deep verification or to drop a legitimate finding.\n"
    "ANTI-INFLATION: when unsure between two severities choose the LOWER, UNLESS "
    "there is executable evidence or a fail-open safety consequence (then keep the "
    "higher / fail closed).\nAUDIT-UNCERTAIN: if you materially disagree with a "
    "prior peer beyond one severity tier on a load-bearing claim, label it "
    "'AUDIT-UNCERTAIN: recommend human review' instead of forcing agreement."
)


def _with_claim_audit(message: str, enabled: bool) -> str:
    return message + CLAIM_AUDIT_ADDENDUM if enabled else message


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
    # Measured-round finding: scope/artifact are interpolated into the
    # line-oriented leash header in _message_with_leash; a CR/LF/control char
    for name, val in (("scope", args.scope), ("artifact", args.artifact)):
        if any(ord(c) < 0x20 for c in val):
            return f"--{name} contains control characters (header-injection guard)"
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


def _valid_turn_row(row: Any) -> bool:
    # Measured-round finding: a parseable-but-semantically-corrupt row (negative
    # count, non-int count, non-numeric ts, non-dict) under-enforces the budget
    if not isinstance(row, dict):
        return False
    count = row.get("count")
    ts = row.get("ts")
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        return False
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return False
    return True


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
        # fail CLOSED on any surviving semantically-corrupt row (negative/non-int
        # count etc.) rather than under-enforcing or crashing in int() later.
        if any(not _valid_turn_row(r) for r in turns.values()):
            return False, {"turn_id": turn_key, "limit": budget, "corrupt": True}, "corrupt_state"
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
        # measured-round finding (blue_purple): the same row-shape risk exists on
        # the refund path; a malformed row must not crash refund. Validate first.
        if _valid_turn_row(row):
            row["count"] = max(0, row["count"] - 1)
            _write_json_atomic(path, data)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def _message_with_leash(target: str, leash: dict[str, Any], message: str, child_env: dict[str, str]) -> str:
    caller = child_env.get("HME_TEAM_CALLER", "driver")
    return (
        # Role framing: a peer FORKED from the driver inherits full context and
        # tools; the prompt must steer it into the requested team role without
        # nuking that context.
        f"You are {target}, a forked team peer with the driver's full inherited context. {caller} is asking you.\n"
        f"Answer ONLY in the {target} role; do NOT continue the driver's narration or echo this handoff.\n"
        f"You are a REVIEWER: report each finding as text (cite the section + one-line fix); verify read-only with tools. Do NOT request write/tool permission or wait for approval -- just deliver findings.\n"
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
    # Self-evolve finding (red_purple): subprocess timeout kills only ask-peer.sh;
    # the `claude` grandchild orphans and keeps spending. Run the child in its own
    env = os.environ.copy()
    env.update(child_env)
    env["HME_ASK_PEER_PROJECT_ROOT"] = str(root)
    proc = subprocess.Popen(
        [str(SCRIPT_DIR / "ask-peer.sh"), target, _message_with_leash(target, leash, message, child_env)],
        cwd=str(root), env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=leash["max_duration"])
        return proc.returncode, stdout, stderr
    except subprocess.TimeoutExpired:
        _kill_group(proc, signal.SIGTERM)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            _kill_group(proc, signal.SIGKILL)
            stdout, stderr = (proc.stdout.read() if proc.stdout else ""), ""
        return 124, stdout or "", f"peer group killed after {leash['max_duration']}s (leash max_duration)"


def _kill_group(proc: "subprocess.Popen[str]", sig: int) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), sig)
    except (ProcessLookupError, PermissionError):
        try:
            proc.send_signal(sig)
        except ProcessLookupError:
            pass  # silent-ok: pending review


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
    p.add_argument("--context-file", default="", help="grounding context (artifact/prior findings) prepended to the task; supplements a forked peer's inherited context")
    p.add_argument("--context-cap", type=int, default=int(os.environ.get("HME_TEAM_CONTEXT_CAP", "24000")))
    p.add_argument("--capsule", default="", help="Context Capsule file (markdown with required ## artifact/## goal/## rubric sections). Peers must cite capsule sections, flag GAPs, or decline -- the mechanism that lets grounded independent peers beat one high-effort reviewer.")
    p.add_argument("--claim-audit", action="store_true", help="append the calibrated claim-audit addendum (structured finding record + mandatory contradictory-evidence + anti-inflation + finding-death + audit-uncertain). Opt-in for high-impact reviews; routine reviews stay lightweight.")
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
        message = args.message
        if args.capsule:
            try:
                capsule, missing = _load_capsule(Path(args.capsule), args.context_cap)
            except OSError as e:
                return _deny("capsule_read", f"could not read --capsule: {e}")
            if missing:
                return _deny("capsule_invalid", f"capsule missing required sections: {', '.join(missing)} (need ## " + ", ## ".join(CAPSULE_REQUIRED) + ")")
            # Inline the LIVE source for every ## evidence file reference so the
            # peer is grounded on current code, never a frozen copy that drifts.
            capsule = _resolve_capsule(capsule, root, args.context_cap)
            # Measured-round lesson (iter 4): a capsule's ## coverage claimed code
            # the ## evidence lacked -> peers grounded on a gap. Now the check runs
            gaps = _capsule_coverage_gaps(capsule)
            if gaps:
                return _deny("capsule_coverage_gap",
                             "coverage claims symbols missing from live ## evidence source: " + ", ".join(gaps[:12]),
                             missing_evidence=gaps[:12])
            message = _capsule_message(capsule, args.message)
        elif args.context_file:
            try:
                ctx = Path(args.context_file).read_text(encoding="utf-8", errors="ignore")[: args.context_cap]
                message = f"GROUND YOUR ANSWER IN THIS CONTEXT (do not invent beyond it):\n{ctx}\n\n---\n{args.message}"
            except OSError as e:
                return _deny("context_file", f"could not read --context-file: {e}")
        message = _with_claim_audit(message, args.claim_audit)
        code, stdout, stderr = _send(root, target, leash, message, child_env)
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
