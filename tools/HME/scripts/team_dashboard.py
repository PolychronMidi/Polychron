#!/usr/bin/env python3
"""Team IPC dashboard -- single JSON file for multi-agent coordination health.

Read by any agent/script for system visibility. Written by lifecycle hooks
when agents fork, complete, or update context usage.

Schema:
  updated_at: ISO timestamp of last write
  mode: optional OVERDRIVE_MODE snapshot
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
import argparse, json, os, sqlite3, sys
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
OMNI_DB = Path(os.environ.get("OMNIROUTE_DB", Path.home() / ".omniroute" / "storage.sqlite"))

ROLE_NEEDLES = {
    "blue_lead": ("You are Blue Lead", "Blue Lead"),
    "blue_purple": ("You are Blue Purple", "Blue Purple"),
    "red_lead": ("You are Red Lead", "Red Lead"),
    "red_purple": ("You are Red Purple", "Red Purple"),
    "crew_e4_0": ("crew_e4_0",), "crew_e4_1": ("crew_e4_1",),
    "crew_e3_0": ("crew_e3_0",), "crew_e3_1": ("crew_e3_1",),
    "crew_e2_0": ("crew_e2_0",), "crew_e2_1": ("crew_e2_1",),
    "crew_e1_0": ("crew_e1_0",), "crew_e1_1": ("crew_e1_1",),
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty_dashboard() -> dict:
    mode = os.environ.get("OVERDRIVE_MODE")
    data = {"updated_at": _now(), "agents": {}}
    if mode:
        try:
            data["mode"] = int(mode)
        except ValueError:
            data["mode"] = mode
    return data


def _is_mode6() -> bool:
    return os.environ.get("OVERDRIVE_MODE") == "6"


def _normalize(data: dict) -> dict:
    data.setdefault("agents", {})
    mode = os.environ.get("OVERDRIVE_MODE")
    if mode and "mode" not in data:
        try:
            data["mode"] = int(mode)
        except ValueError:
            data["mode"] = mode
    data.pop("stage_crew", None)
    return data


def _load() -> dict:
    if DASHBOARD.is_file():
        try:
            return _normalize(json.loads(DASHBOARD.read_text()))
        except (json.JSONDecodeError, OSError):
            pass  # silent-ok: malformed/missing dashboard resets to empty
    return _empty_dashboard()


def _save(data: dict) -> None:
    data = _normalize(data)
    data["updated_at"] = _now()
    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(DASHBOARD) + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.rename(DASHBOARD)


def _artifact_body(relpath: str) -> dict:
    p = Path.home() / ".omniroute" / "call_logs" / relpath
    try:
        return json.loads(p.read_text()).get("requestBody", {})
    except (OSError, json.JSONDecodeError, TypeError):
        return {}


def _metadata_session_id(body: dict) -> str:
    meta = body.get("metadata") if isinstance(body, dict) else {}
    user_id = meta.get("user_id") if isinstance(meta, dict) else None
    try:
        return json.loads(user_id).get("session_id", "") if isinstance(user_id, str) else ""
    except (json.JSONDecodeError, TypeError):
        return ""


def _current_session_id() -> str:
    try:
        return Path((PROJECT / "tmp" / "hme-transcript-path.txt").read_text().strip()).stem
    except OSError:
        return ""


def _first_user_text(body: dict) -> str:
    for msg in body.get("messages", []):
        if msg.get("role") != "user":
            continue
        parts = msg.get("content")
        if isinstance(parts, str):
            return parts
        if isinstance(parts, list):
            return "\n".join(str(b.get("text") or b.get("content") or "") for b in parts if isinstance(b, dict))
    return ""


def _role_matches(role: str, body: dict, current_sid: str) -> bool:
    if role == "driver":
        return _metadata_session_id(body) == current_sid
    if any(m.get("_omniroute_truncated_array") for m in body.get("messages", []) if isinstance(m, dict)):
        return False
    text = _first_user_text(body)
    if "Filesystem IPC only" not in text or "MODE=6" not in text:
        return False
    matches = [r for r, needles in ROLE_NEEDLES.items() if any(n in text for n in needles)]
    return matches == [role]


def _model_ctx_window(model: str, fallback: int) -> int:
    if model.startswith("codex/") or model.startswith("cx/") or model.startswith("gpt-5.5"):
        return 1050000
    return fallback


def _omniroute_ctx(role: str, sid: str, fallback_window: int, forked_at: str | None = None) -> dict | None:
    if not OMNI_DB.is_file():
        return None
    try:
        con = sqlite3.connect(str(OMNI_DB))
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "select timestamp,tokens_in,model,requested_model,artifact_relpath "
            "from call_logs where path = '/v1/messages' and status = 200 "
            "and artifact_relpath is not null order by timestamp desc limit 400"
        ).fetchall()
    except sqlite3.Error:
        return None
    current_sid = _current_session_id()
    for row in rows:
        if forked_at and row["timestamp"] < forked_at:
            break
        body = _artifact_body(row["artifact_relpath"] or "")
        by_sid = sid and len(sid) >= 12 and _metadata_session_id(body) == sid
        if not by_sid and not _role_matches(role, body, current_sid):
            continue
        model = row["requested_model"] or row["model"] or ""
        window = _model_ctx_window(model, fallback_window)
        pct = int(min(100, max(0, round((row["tokens_in"] or 0) / max(1, window) * 100))))
        return {"pct": pct, "window": window, "timestamp": row["timestamp"]}
    return None


def _ctx_info(role: str, sid: str, tier: str, forked_at: str | None = None) -> dict:
    fallback = DEFAULT_CTX.get(tier, 0)
    if _is_mode6():
        ctx = _omniroute_ctx(role, sid, fallback, forked_at)
        if ctx:
            return {"pct": ctx["pct"], "window": ctx["window"], "source": "omniroute"}
        return {"pct": 0, "window": fallback, "source": "unknown"}
    try:
        from buddy_dispatch_status import _buddy_context_used  # noqa: E402
        ctx = _buddy_context_used(sid)
        if ctx and "used_pct" in ctx:
            pct = min(100, max(0, int(ctx["used_pct"])))
            return {"pct": pct, "window": int(ctx.get("ctx_window") or fallback), "source": "buddy"}
    except (ImportError, ValueError, TypeError):
        pass  # silent-ok: legacy buddy ctx may be unavailable
    return {"pct": 0, "window": fallback, "source": "unknown"}

def cmd_register(args):
    data = _load()
    role = args.role
    if role not in ROLES:
        print(f"unknown role '{role}'; known: {', '.join(sorted(ROLES))}", file=sys.stderr)
        sys.exit(1)
    meta = ROLES[role]
    info = _ctx_info(role, args.sid, meta["tier"])
    data["agents"][role] = {
        "role": role,
        "team": meta["team"],
        "tier": meta["tier"],
        "sid": args.sid,
        "ctx_used_pct": info["pct"],
        "ctx_source": info["source"],
        "ctx_available": info["window"],
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
        info = _ctx_info(role, a.get("sid", ""), a.get("tier", "E3"), a.get("forked_at"))
        a["ctx_used_pct"] = info["pct"]
        a["ctx_source"] = info["source"]
        a["ctx_available"] = info["window"]
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
    print(f"team-dashboard  updated={data.get('updated_at','?')}  mode={data.get('mode','?')}  agents={len(agents)}")
    print(f"{'role':<14} {'team':<8} {'tier':<4} {'ctx%':>4}  {'bar':<10} {'ctx_src':<8} {'status':<12}  {'last_active':<8}  task")
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
        src = a.get("ctx_source") or "unknown"
        print(f"{role:<14} {a.get('team','?'):<8} {a.get('tier','?'):<4} {pct:>3}%  {_bar(pct):<10} {src:<8} {a.get('status','?'):<12}  {la:<8}  {task}")

def cmd_summary(args):
    data = _load()
    agents = data.get("agents", {})
    active = sum(1 for a in agents.values() if a.get("status") not in ("idle", "retired", "done"))
    high_ctx = sum(1 for a in agents.values() if a.get("ctx_used_pct", 0) >= 85)
    idle_s = 0
    stale = 0
    unknown_ctx = 0
    now = datetime.now(timezone.utc)
    for a in agents.values():
        if (a.get("ctx_source") or "unknown") == "unknown":
            unknown_ctx += 1
        la = a.get("last_active", "")
        try:
            dt = datetime.fromisoformat(la.replace("Z", "+00:00"))
            idle = (now - dt).total_seconds()
            idle_s = max(idle_s, idle)
            if idle > 900 and a.get("status") not in ("idle", "retired", "done"):
                stale += 1
        except (ValueError, TypeError):
            stale += 1
    print(f"team={len(agents)} active={active} high_ctx={high_ctx} stale={stale} unknown_ctx={unknown_ctx} max_idle_s={int(idle_s)}")

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
