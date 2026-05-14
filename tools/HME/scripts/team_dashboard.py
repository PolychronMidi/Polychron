#!/usr/bin/env python3
"""Team IPC dashboard -- single JSON file for multi-agent coordination health.

Read by any agent/script for system visibility. Written by lifecycle hooks
when agents fork, complete, or update context usage.

Schema:
  updated_at: ISO timestamp of last write
  agents: { role_name -> { role, team, tier, sid, ctx_used_pct, ctx_available,
             last_active, status, task, forked_at } }

Usage:
  team_dashboard.py                              # print dashboard
  team_dashboard.py --json                       # raw JSON
  team_dashboard.py register <role> <sid> <tier> # add/update agent slot
  team_dashboard.py update <role> ctx_pct=<n> status=<s> task=<t>
  team_dashboard.py heartbeat <role>             # bump last_active
  team_dashboard.py unregister <role>            # remove from active
  team_dashboard.py summary                      # terse health one-liner
"""
from __future__ import annotations
import argparse, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(os.environ.get("PROJECT_ROOT", os.environ.get("CLAUDE_PROJECT_DIR", "")))
DASHBOARD = PROJECT / "runtime" / "hme" / "team-dashboard.json"

ROLES = {
    "driver":       {"team": "command",  "tier": "E5"},
    "blue_lead":    {"team": "blue",     "tier": "E5"},
    "blue_purple":  {"team": "blue",     "tier": "E4"},
    "red_lead":     {"team": "red",      "tier": "E5"},
    "red_purple":   {"team": "red",      "tier": "E4"},
    "crew_e4_0":    {"team": "crew",     "tier": "E4"},
    "crew_e4_1":    {"team": "crew",     "tier": "E4"},
    "crew_e3_0":    {"team": "crew",     "tier": "E3"},
    "crew_e3_1":    {"team": "crew",     "tier": "E3"},
    "crew_e2_0":    {"team": "crew",     "tier": "E2"},
    "crew_e2_1":    {"team": "crew",     "tier": "E2"},
    "crew_e1_0":    {"team": "crew",     "tier": "E1"},
    "crew_e1_1":    {"team": "crew",     "tier": "E1"},
}

DEFAULT_CTX = {"E5": 200000, "E4": 128000, "E3": 64000, "E2": 32000, "E1": 16000}

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def _load() -> dict:
    if DASHBOARD.is_file():
        try:
            return json.loads(DASHBOARD.read_text())
        except (json.JSONDecodeError, OSError):
            pass  # silent-ok: malformed/missing dashboard resets to empty
    return {"updated_at": _now(), "agents": {}}

def _save(data: dict) -> None:
    data["updated_at"] = _now()
    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(DASHBOARD) + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.rename(DASHBOARD)

def _ctx_pct(sid: str, tier: str) -> int:
    try:
        from buddy_dispatch_status import _buddy_context_used  # noqa: E402
        ctx = _buddy_context_used(sid)
        if ctx and "used_pct" in ctx:
            return min(100, max(0, int(ctx["used_pct"])))
    except (ImportError, ValueError, TypeError):
        pass  # silent-ok: buddy infrastructure may not be loaded
    return 0

def cmd_register(args):
    data = _load()
    role = args.role
    if role not in ROLES:
        print(f"unknown role '{role}'; known: {', '.join(sorted(ROLES))}", file=sys.stderr)
        sys.exit(1)
    meta = ROLES[role]
    data["agents"][role] = {
        "role": role,
        "team": meta["team"],
        "tier": meta["tier"],
        "sid": args.sid,
        "ctx_used_pct": _ctx_pct(args.sid, meta["tier"]),
        "ctx_available": DEFAULT_CTX.get(meta["tier"], 0),
        "last_active": _now(),
        "status": "registered",
        "task": args.task or "",
        "forked_at": _now(),
    }
    _save(data)
    print(f"team_dashboard: {role} registered (sid={args.sid})")

def cmd_update(args):
    data = _load()
    role = args.role
    if role not in data.get("agents", {}):
        print(f"role '{role}' not registered; use register first", file=sys.stderr)
        sys.exit(1)
    agent = data["agents"][role]
    if args.ctx_pct is not None:
        agent["ctx_used_pct"] = int(args.ctx_pct)
    if args.status:
        agent["status"] = args.status
    if args.task is not None:
        agent["task"] = args.task
    agent["last_active"] = _now()
    _save(data)

def cmd_heartbeat(args):
    data = _load()
    role = args.role
    if role in data.get("agents", {}):
        a = data["agents"][role]
        a["last_active"] = _now()
        a["ctx_used_pct"] = _ctx_pct(a.get("sid", ""), a.get("tier", "E3"))
    _save(data)

def cmd_unregister(args):
    data = _load()
    if args.role in data.get("agents", {}):
        del data["agents"][args.role]
    _save(data)
    print(f"team_dashboard: {args.role} unregistered")

def _bar(pct: int, width: int = 10) -> str:
    filled = round(pct / 100 * width)
    return "#" * filled + "-" * (width - filled)

def cmd_show(args):
    data = _load()
    if getattr(args, "json_output", False):
        print(json.dumps(data, indent=2))
        return
    agents = data.get("agents", {})
    if not agents:
        print("team-dashboard: no agents registered")
        return
    print(f"team-dashboard  updated={data.get('updated_at','?')}  agents={len(agents)}")
    print(f"{'role':<14} {'team':<8} {'tier':<4} {'ctx%':>4}  {'bar':<10} {'status':<12}  {'last_active':<8}  task")
    print("-" * 95)
    order = ["driver", "blue_lead", "blue_purple", "red_lead", "red_purple"]
    order += sorted([k for k in agents if k not in order])
    for role in order:
        a = agents.get(role)
        if not a:
            continue
        pct = a.get("ctx_used_pct", 0)
        la = a.get("last_active", "")[11:19] if a.get("last_active") else "?"
        task = (a.get("task") or "")[:40]
        print(f"{role:<14} {a.get('team','?'):<8} {a.get('tier','?'):<4} {pct:>3}%  {_bar(pct):<10} {a.get('status','?'):<12}  {la:<8}  {task}")

def cmd_summary(args):
    data = _load()
    agents = data.get("agents", {})
    active = sum(1 for a in agents.values() if a.get("status") not in ("idle", "retired"))
    high_ctx = sum(1 for a in agents.values() if a.get("ctx_used_pct", 0) >= 85)
    idle_s = 0
    now = datetime.now(timezone.utc)
    for a in agents.values():
        la = a.get("last_active", "")
        try:
            dt = datetime.fromisoformat(la.replace("Z", "+00:00"))
            idle_s = max(idle_s, (now - dt).total_seconds())
        except (ValueError, TypeError):
            pass  # silent-ok: unparseable timestamp, skip
    print(f"team={len(agents)} active={active} high_ctx={high_ctx} max_idle_s={int(idle_s)}")

def main() -> int:
    p = argparse.ArgumentParser(description="Team IPC coordination dashboard")
    sub = p.add_subparsers(dest="cmd")
    sp = sub.add_parser("show", help="print dashboard")
    sp.add_argument("--json", dest="json_output", action="store_true")
    sp.set_defaults(func=cmd_show)
    sp = sub.add_parser("register", help="add agent slot")
    sp.add_argument("role")
    sp.add_argument("sid")
    sp.add_argument("tier")
    sp.add_argument("--task", default="")
    sp.set_defaults(func=cmd_register)
    sp = sub.add_parser("update", help="update agent fields")
    sp.add_argument("role")
    sp.add_argument("--ctx-pct", type=int, default=None)
    sp.add_argument("--status", default="")
    sp.add_argument("--task", default=None)
    sp.set_defaults(func=cmd_update)
    sp = sub.add_parser("heartbeat", help="bump last_active")
    sp.add_argument("role")
    sp.set_defaults(func=cmd_heartbeat)
    sp = sub.add_parser("unregister", help="remove agent slot")
    sp.add_argument("role")
    sp.set_defaults(func=cmd_unregister)
    sub.add_parser("summary", help="terse health one-liner").set_defaults(func=cmd_summary)
    args = p.parse_args()
    if not args.cmd:
        args.cmd = "show"
        args.json_output = False
        args.func = cmd_show
    return args.func(args) or 0

if __name__ == "__main__":
    sys.exit(main())
