#!/usr/bin/env python3
"""MODE=6 Agent reroute per enshrined team_subagent_routing_rules (models.json line 25).

Every Agent call from a team role is intercepted. The caller's role determines
which persistent stage-crew / lead / purple partner receives the task. The hook
pays no attention to subagent_type -- tier is determined by the ORIGINAL
subagent_type's effort tier, not the caller's tier.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

PROJECT = Path(os.environ.get("PROJECT_ROOT") or os.getcwd())
DASH = PROJECT / "runtime" / "hme" / "team-dashboard.json"

# subagent_type -> target tier (effort, not caller tier)
TYPE_TIER: dict[str, str] = {
    "Plan": "E4",
    "Explore": "E3",
    "general-purpose": "E3",
    "claude-code-guide": "E2",
    "statusline-setup": "E1",
}
_NATIVE_AGENT_KEYS = {"description", "prompt", "subagent_type"}

# Who cannot spawn subagents at all
_BLOCKED_CALLERS = frozenset({"crew_e1_0", "crew_e1_1", "crew_e2_0", "crew_e2_1"})


def _load() -> dict:
    try:
        return json.loads(DASH.read_text())
    except (OSError, json.JSONDecodeError):
        return {"agents": {}}


def _pct(agent: dict) -> float:
    """ctx_used_pct as float, -1 if unknown."""
    try:
        return float(agent.get("ctx_used_pct", 0))
    except (TypeError, ValueError):
        return -1.0


def _available(agent: dict) -> bool:
    return agent.get("status") not in {"retired", "failed", "done"}


def _pick(candidates: list[tuple[str, dict]], prefer_lowest_ctx: bool = True) -> Optional[str]:
    """Return role name of best candidate."""
    if not candidates:
        return None
    if prefer_lowest_ctx:
        candidates.sort(key=lambda x: (_pct(x[1]) if _pct(x[1]) >= 0 else 999))
    return candidates[0][0]


def _crew_for_tier(tier: str, data: dict, cap: Optional[str] = None) -> list[tuple[str, dict]]:
    """Return available crew agents at exactly `tier`, capped if needed."""
    agents = data.get("agents") or {}
    prefix = f"crew_e{tier[1]}_"
    candidates: list[tuple[str, dict]] = []
    for role, agent in agents.items():
        if not role.startswith(prefix):
            continue
        if not _available(agent):
            continue
        if cap and agent.get("tier", "") > cap:
            continue
        candidates.append((role, agent))
    return candidates


def _crew_fallback(tier: str, data: dict) -> Optional[str]:
    """Return best crew agent, falling to lower tiers."""
    for t in range(int(tier[1]), 0, -1):
        cs = _crew_for_tier(f"E{t}", data)
        if cs:
            return _pick(cs)
    return None


def _same_team(caller: str, role: str) -> bool:
    return caller.split("_")[0] == role.split("_")[0]


def _opposing_purple(caller: str, data: dict) -> Optional[str]:
    """Return the purple partner of the OPPOSING team."""
    callers = data.get("agents") or {}
    want = "blue_purple" if caller.startswith("red") else "red_purple"
    agent = callers.get(want)
    if agent and _available(agent):
        return want
    return None


def _same_purple(caller: str, data: dict) -> Optional[str]:
    """Return the purple partner of the SAME team."""
    callers = data.get("agents") or {}
    want = "blue_purple" if caller.startswith("blue") else "red_purple"
    agent = callers.get(want)
    if agent and _available(agent):
        return want
    return None


def _e4_stage_crew(data: dict) -> Optional[str]:
    cs = _crew_for_tier("E4", data)
    return _pick(cs) if cs else None


def _team_lead(data: dict, prefer_lowest_ctx: bool = True) -> Optional[str]:
    """Return blue_lead or red_lead, preferring least-used context."""
    callers = data.get("agents") or {}
    candidates: list[tuple[str, dict]] = []
    for role in ("blue_lead", "red_lead"):
        agent = callers.get(role)
        if agent and _available(agent):
            candidates.append((role, agent))
    return _pick(candidates, prefer_lowest_ctx=prefer_lowest_ctx)


def _purple_partner(data: dict, prefer_lowest_ctx: bool = True) -> Optional[str]:
    """Return blue_purple or red_purple, preferring least-used context."""
    callers = data.get("agents") or {}
    candidates: list[tuple[str, dict]] = []
    for role in ("blue_purple", "red_purple"):
        agent = callers.get(role)
        if agent and _available(agent):
            candidates.append((role, agent))
    return _pick(candidates, prefer_lowest_ctx=prefer_lowest_ctx)


# --- Routing dispatchers per caller role ---

def _route_driver(request_tier: str, data: dict) -> Optional[str]:
    if request_tier == "E5":
        target = _team_lead(data, prefer_lowest_ctx=True)
        if target:
            return target
        return _route_driver("E4", data)
    if request_tier == "E4":
        target = _purple_partner(data, prefer_lowest_ctx=True)
        if target:
            return target
        return _e4_stage_crew(data)
    return _crew_fallback(request_tier, data)


def _route_team_lead(caller: str, request_tier: str, data: dict) -> Optional[str]:
    if request_tier in ("E4", "E5"):
        target = _same_purple(caller, data)
        if target:
            return target
        return _e4_stage_crew(data)
    return _crew_fallback(request_tier, data)


def _route_purple(caller: str, request_tier: str, data: dict) -> Optional[str]:
    if request_tier in ("E4", "E5"):
        target = _opposing_purple(caller, data)
        if target:
            return target
        return _e4_stage_crew(data)
    return _crew_fallback(request_tier, data)


def _route_crew(caller: str, request_tier: str, data: dict) -> Optional[str]:
    caller_agent = (data.get("agents") or {}).get(caller, {})
    caller_tier = str(caller_agent.get("tier") or "").upper()
    cap = caller_tier if caller_tier in {"E3", "E4"} else request_tier
    if cap not in {"E3", "E4"}:
        return None
    capped = request_tier if request_tier <= cap else cap
    return _crew_fallback(capped, data)


_ROUTERS: dict[str, callable] = {
    "driver": lambda tier, data: _route_driver(tier, data),
    "blue_lead": lambda tier, data: _route_team_lead("blue_lead", tier, data),
    "red_lead": lambda tier, data: _route_team_lead("red_lead", tier, data),
    "blue_purple": lambda tier, data: _route_purple("blue_purple", tier, data),
    "red_purple": lambda tier, data: _route_purple("red_purple", tier, data),
}


def _is_crew(role: str) -> bool:
    return role.startswith("crew_e")


def _level_tier(value) -> Optional[str]:
    try:
        level = int(value)
    except (TypeError, ValueError):
        return None
    return f"E{level}" if 1 <= level <= 5 else None


def _tool_tier(tool_input: dict) -> str:
    return _level_tier(tool_input.get("level")) or TYPE_TIER.get(
        str(tool_input.get("subagent_type") or "general-purpose"), "E3")


def _native_input(tool_input: dict, target: str) -> dict:
    prompt = str(tool_input.get("prompt") or "")
    desc = str(tool_input.get("description") or prompt.splitlines()[0][:80] or "Agent task")
    return {
        "description": f"{target} routed: {desc}"[:200],
        "prompt": (
            f"MODE=6 team-routed task. You are {target}.\n"
            f"Register/heartbeat via i/team if not present. Do not fork further subagents.\n\n"
            f"Original task:\n{prompt}"
        ),
        "subagent_type": "general-purpose",
    }


def resolve_target(caller: str, subagent_type: str) -> Optional[str]:
    """Return the HME team role name to route to, or None if blocked."""
    return resolve_target_for_tier(caller, TYPE_TIER.get(subagent_type, "E3"))


def resolve_target_for_tier(caller: str, request_tier: str) -> Optional[str]:
    data = _load()
    if caller in _BLOCKED_CALLERS:
        return None  # E1-E2 crew blocked from Agent tool
    router = _ROUTERS.get(caller)
    if router:
        return router(request_tier, data)
    if _is_crew(caller):
        return _route_crew(caller, request_tier, data)
    return _crew_fallback(request_tier, data)


# --- CLI / hook entry point ---

def main() -> int:
    payload = json.load(sys.stdin)
    if os.environ.get("OVERDRIVE_MODE") != "6":
        return 0
    if payload.get("tool_name") != "Agent":
        return 0
    tool_input = payload.get("tool_input") or {}
    caller = str(payload.get("_hme_team_role") or os.environ.get("HME_TEAM_ROLE") or "").strip().lower()
    sub_type = str(tool_input.get("subagent_type") or "general-purpose")
    target = resolve_target(caller, sub_type)
    if target is None and caller in _BLOCKED_CALLERS:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Agent tool blocked for {caller}: "
                f"E1-E2 stage crew may not spawn subagents per team_subagent_routing_rules"
            ),
        }}))
        return 0
    if target is None:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": (
                f"No available {sub_type} target for {caller or 'unknown'} "
                f"(no eligible agents registered). Agent call will proceed natively."
            ),
        }}))
        return 0
    desc = str(tool_input.get("description") or "Agent task")
    prompt = str(tool_input.get("prompt") or "")
    updated = dict(tool_input)
    updated["description"] = f"{target} routed: {desc}"[:200]
    updated["prompt"] = (
        f"MODE=6 team-routed task. You are {target}.\n"
        f"Register/heartbeat via i/team if not present. Do not fork further subagents.\n\n"
        f"Original task:\n{prompt}"
    )
    updated["subagent_type"] = "general-purpose"
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": updated,
    }}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
