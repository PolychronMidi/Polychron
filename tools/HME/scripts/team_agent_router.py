#!/usr/bin/env python3
"""MODE=6 Agent router -- reroute nested subagent calls to stage-crew tiers."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

PROJECT = Path(os.environ.get("PROJECT_ROOT") or os.getcwd())
DASH = PROJECT / "runtime" / "hme" / "team-dashboard.json"

TYPE_TIER = {
    "Plan": "E4",
    "Explore": "E3",
    "general-purpose": "E3",
    "statusline-setup": "E1",
    "claude-code-guide": "E2",
}

ROLE_RE = re.compile(r"crew_e([1-4])_")


def _load() -> dict:
    try:
        return json.loads(DASH.read_text())
    except (OSError, json.JSONDecodeError):
        return {"agents": {}}


def _tier(role: str, agent: dict) -> str:
    value = str(agent.get("tier") or "").upper()
    if value in {"E1", "E2", "E3", "E4", "E5"}:
        return value
    m = ROLE_RE.match(role)
    return f"E{m.group(1)}" if m else "E3"


def _target_for(request_tier: str, data: dict) -> str:
    agents = data.get("agents") or {}
    wanted = [
        role for role, agent in agents.items()
        if role.startswith("crew_e")
        and _tier(role, agent) == request_tier
        and agent.get("status") not in {"retired", "failed"}
    ]
    if wanted:
        return sorted(wanted)[0]
    return f"crew_{request_tier.lower()}_0"


def main() -> int:
    payload = json.load(sys.stdin)
    if os.environ.get("OVERDRIVE_MODE") != "6":
        return 0
    if payload.get("tool_name") != "Agent":
        return 0
    tool_input = payload.get("tool_input") or {}
    sub_type = str(tool_input.get("subagent_type") or "general-purpose")
    request_tier = TYPE_TIER.get(sub_type, "E3")
    target = _target_for(request_tier, _load())
    prompt = str(tool_input.get("prompt") or "")
    desc = str(tool_input.get("description") or "Agent task")
    updated = dict(tool_input)
    updated["description"] = f"{target} {request_tier} routed: {desc}"[:200]
    updated["prompt"] = (
        f"MODE=6 stage-crew routed task. You are {target} ({request_tier}).\n"
        "Register/heartbeat with i/team if not present. Do not fork further.\n\n"
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
