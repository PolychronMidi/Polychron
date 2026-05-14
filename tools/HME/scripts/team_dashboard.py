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
import argparse, json, os, re, sqlite3, sys
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
SESSION_ROOT = Path.home() / ".claude" / "projects" / "-home-jah-Polychron"

ROLE_NEEDLES = {
    "driver": ("MODE=6 team fanout active", "MODE6 Driver"),
    "blue_lead": ("Blue Lead", "blue_lead"),
    "blue_purple": ("Blue Purple", "blue_purple"),
    "red_lead": ("Red Lead", "red_lead"),
    "red_purple": ("Red Purple", "red_purple"),
    "crew_e4_0": ("crew_e4_0",),
    "crew_e4_1": ("crew_e4_1",),
    "crew_e3_0": ("crew_e3_0",),
    "crew_e3_1": ("crew_e3_1",),
    "crew_e2_0": ("crew_e2_0",),
    "crew_e2_1": ("crew_e2_1",),
    "crew_e1_0": ("crew_e1_0",),
    "crew_e1_1": ("crew_e1_1",),
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

def _is_mode6() -> bool:
    return os.environ.get("OVERDRIVE_MODE") == "6"


def _session_id_from_artifact(relpath: str) -> str:
    try:
        p = Path.home() / ".omniroute" / "call_logs" / relpath
        metadata = json.loads(p.read_text()).get("requestBody", {}).get("metadata", {})
        user_id = metadata.get("user_id")
        return json.loads(user_id).get("session_id", "") if isinstance(user_id, str) else ""
    except (OSError, json.JSONDecodeError, TypeError):
        return ""


def _role_from_artifact(relpath: str) -> str:
    try:
        p = Path.home() / ".omniroute" / "call_logs" / relpath
        body = json.loads(p.read_text()).get("requestBody", {})
        text = json.dumps(body)[:20000]
    except (OSError, json.JSONDecodeError, TypeError):
        return ""
    for role, needles in ROLE_NEEDLES.items():
        if any(n in text for n in needles):
            return role
    return ""


def _model_ctx_window(model: str, fallback: int) -> int:
    if OMNI_DB.is_file():
        try:
            con = sqlite3.connect(str(OMNI_DB))
            row = con.execute(
                "select context_length from model_capabilities where model_id = ? limit 1",
                (model,),
            ).fetchone()
            if row and row[0]:
                return int(row[0])
        except (sqlite3.Error, ValueError, TypeError):
            pass  # silent-ok: fall through to API/config limits
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:20128/v1/models", timeout=1) as r:
            for item in json.loads(r.read().decode()).get("data", []):
                if item.get("id") == model or item.get("id", "").endswith("/" + model):
                    limit = item.get("context_length") or item.get("max_input_tokens")
                    if limit:
                        return int(limit)
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        pass  # silent-ok: OmniRoute may be down; use declared fallback
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
            "and artifact_relpath is not null order by timestamp desc limit 300"
        ).fetchall()
    except sqlite3.Error:
        return None
    for row in rows:
        rel = row["artifact_relpath"] or ""
        if sid and len(sid) >= 12 and _session_id_from_artifact(rel) == sid:
            window = _model_ctx_window(row["requested_model"] or row["model"] or "", fallback_window)
            pct = int(min(100, max(0, round((row["tokens_in"] or 0) / max(1, window) * 100))))
            return {"pct": pct, "window": window, "timestamp": row["timestamp"]}
        if forked_at and row["timestamp"] < forked_at:
            break
        if _role_from_artifact(rel) == role:
            window = _model_ctx_window(row["requested_model"] or row["model"] or "", fallback_window)
            pct = int(min(100, max(0, round((row["tokens_in"] or 0) / max(1, window) * 100))))
            return {"pct": pct, "window": window, "timestamp": row["timestamp"]}
    return None


def _subagent_ctx(role: str, fallback_window: int) -> dict | None:
    root = SESSION_ROOT / "7992e911-8138-4ca3-9b34-6b6c69dc03d6" / "subagents"
    if not root.is_dir():
        return None
    newest = None
    for path in root.glob("*.jsonl"):
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        if not any(n in text[:5000] for n in ROLE_NEEDLES.get(role, ())):
            continue
        usage = None
        ts = ""
        for line in text.splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = ev.get("message") if isinstance(ev.get("message"), dict) else {}
            if isinstance(msg.get("usage"), dict):
                usage = msg["usage"]
                ts = ev.get("timestamp", "")
        if not usage:
            continue
        tokens = sum(int(usage.get(k) or 0) for k in (
            "input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        pct = int(min(100, max(0, round(tokens / max(1, fallback_window) * 100))))
        item = {"pct": pct, "window": fallback_window, "timestamp": ts}
        if newest is None or item["timestamp"] > newest["timestamp"]:
            newest = item
    return newest


def _ctx_pct(sid: str, tier: str, status: str = "registered", forked_at: str | None = None, role: str = "") -> int:
    fallback_window = DEFAULT_CTX.get(tier, 0)
    if _is_mode6():
        ctx = _subagent_ctx(role, fallback_window) or _omniroute_ctx(role, sid, fallback_window, forked_at)
        return ctx["pct"] if ctx else 0
    try:
        from buddy_dispatch_status import _buddy_context_used  # noqa: E402
        ctx = _buddy_context_used(sid)
        if ctx and "used_pct" in ctx:
            return min(100, max(0, int(ctx["used_pct"])))
    except (ImportError, ValueError, TypeError):
        pass  # silent-ok: legacy buddy ctx may be unavailable
    return 0


def _ctx_source(sid: str, role: str = "", forked_at: str | None = None) -> str:
    if _is_mode6():
        if _subagent_ctx(role, DEFAULT_CTX.get(ROLES.get(role, {}).get("tier", "E3"), 0)):
            return "transcript"
        if _omniroute_ctx(role, sid, DEFAULT_CTX.get(ROLES.get(role, {}).get("tier", "E3"), 0), forked_at):
            return "omniroute"
        return "unknown"
    return "buddy" if sid and sid not in ("tbd", "driver-session") else "unknown"


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
        "ctx_used_pct": _ctx_pct(args.sid, meta["tier"], status="registered"),
        "ctx_source": _ctx_source(args.sid),
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
        if (a.get("ctx_used_pct") or 0) == 0:
            a["ctx_used_pct"] = _ctx_pct(a.get("sid", ""), a.get("tier", "E3"), status=a.get("status", "registered"))
        a["ctx_source"] = _ctx_source(a.get("sid", ""))
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
