#!/usr/bin/env python3
"""Team IPC dashboard for MODE=6 agent health."""
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
OMNI_DB = Path(os.environ.get("OMNIROUTE_DB", Path.home() / ".omniroute" / "storage.sqlite"))
_MODEL_WINDOWS: dict[str, int] | None = None
def _jsonc(text: str) -> str:
 out = []; quote = ""; esc = False; i = 0
 while i < len(text):
  c = text[i]; n = text[i + 1:i + 2]
  if quote:
   out.append(c)
   if esc: esc = False
   elif c == "\\": esc = True
   elif c == quote: quote = ""
  elif c in "\"'":
   quote = c; out.append(c)
  elif c == "#" or (c == "/" and n == "/"):
   while i < len(text) and text[i] != "\n": i += 1
   out.append("\n")
  else:
   out.append(c)
  i += 1
 return "".join(out)
def _strip_json_comments(text: str) -> str:
 out=[]; q=""; esc=False; i=0
 while i < len(text):
  c=text[i]; n=text[i:i+2]
  if q:
   out.append(c); was=esc; esc=(c == "\\" and not esc)
   if c == q and not was: q=""
  elif c in "\"'": q=c; out.append(c)
  elif c == "#" or n == "//":
   i=text.find("\n", i)
   if i < 0: break
   out.append("\n")
  else: out.append(c)
  i += 1
 return "".join(out)

def _model_ctx_window(model: str, tier: str) -> int:
 if not model:
  raise RuntimeError(f"omniroute row missing model for tier={tier}")
 path = PROJECT / "config" / "models.json"
 try:
  tiers = json.loads("\n".join(l for l in path.read_text().splitlines() if not l.lstrip().startswith(("#", "//")))).get("tiers", {})
 except (OSError, json.JSONDecodeError) as exc:
  raise RuntimeError(f"model config unavailable: {path}") from exc
 for data in tiers.values():
  for m in data.get("models", []):
   mid = m.get("id"); keys = (mid, f"{m.get('provider')}/{mid}" if m.get("provider") else "")
   if model in keys and (m.get("context_length") or m.get("max_context")):
    return int(m.get("context_length") or m.get("max_context"))
 raise RuntimeError(f"context window unknown for model={model} tier={tier}")


def _row_ctx(row: sqlite3.Row, tier: str, session_id: str) -> dict:
 model = row["requested_model"] or row["model"] or ""
 window = _model_ctx_window(model, tier)
 used = float(row["tokens_in"] or 0)
 pct = round(min(100.0, max(0.0, used / max(1, window) * 100)), 1)
 return {"pct": pct, "window": window, "timestamp": row["timestamp"], "sid": session_id}


def _omniroute_ctx(role: str, sid: str, tier: str, forked_at: str | None = None) -> dict | None:
 if not OMNI_DB.is_file():
  raise RuntimeError(f"omniroute db missing: {OMNI_DB}")
 try:
  con = sqlite3.connect(str(OMNI_DB))
  con.row_factory = sqlite3.Row
  rows = con.execute(
   "select timestamp,tokens_in,model,requested_model,artifact_relpath "
   "from call_logs where path = '/v1/messages' and status = 200 "
   "and artifact_relpath is not null order by timestamp desc limit 3000"
  ).fetchall()
 except sqlite3.Error as exc:
  raise RuntimeError("omniroute context query failed") from exc
 current_sid = _current_session_id()
 for row in rows:
  body = _artifact_body(row["artifact_relpath"] or "")
  if not _role_matches(role, body, current_sid):
   continue
  session_id = _metadata_session_id(body)
  if not session_id:
   raise RuntimeError(f"omniroute artifact missing session_id for {role}")
  if _looks_real_sid(sid) and sid != session_id:
   raise RuntimeError(f"stored sid mismatch for {role}: {sid} != {session_id}")
  return _row_ctx(row, tier, session_id)
 return None


def _ctx_info(role: str, sid: str, tier: str, forked_at: str | None = None) -> dict:
 if os.environ.get("OVERDRIVE_MODE") == "6":
  ctx = _omniroute_ctx(role, sid, tier, forked_at)
  if not ctx:
   raise RuntimeError(f"omniroute context unavailable for {role} sid={sid}")
  return {"pct": ctx["pct"], "window": ctx["window"], "sid": ctx["sid"]}
 try:
  from buddy_dispatch_status import _buddy_context_used # noqa: E402
 except ImportError as exc:
  raise RuntimeError("buddy context provider unavailable") from exc
 ctx = _buddy_context_used(sid)
 if not ctx or "used_pct" not in ctx or "ctx_window" not in ctx:
  raise RuntimeError(f"buddy context unavailable for {role} sid={sid}")
 window = int(ctx["ctx_window"])
 if window <= 0: raise RuntimeError(f"buddy context window invalid for {role} sid={sid}")
 pct = round(min(100.0, max(0.0, float(ctx["used_pct"]))), 1)
 return {"pct": pct, "window": window, "sid": sid}
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
        "sid": info["sid"],
        "ctx_used_pct": info["pct"],
        "ctx_available": info["window"],
        "last_active": _now(),
        "status": "registered",
        "task": args.task or "",
        "forked_at": _now(),
    }
    _save(data)
    print(f"team_dashboard: {role} registered (sid={info['sid']})")
def cmd_update(args):
    data = _load()
    role = args.role
    if role not in data.get("agents", {}):
        print(f"role '{role}' not registered; use register first", file=sys.stderr)
        sys.exit(1)
    agent = data["agents"][role]
    if args.ctx_pct is not None:
        agent["ctx_used_pct"] = float(args.ctx_pct)
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
        a["ctx_available"] = info["window"]
        a["sid"] = info["sid"]
    _save(data)
def cmd_unregister(args):
    data = _load(); data.get("agents", {}).pop(args.role, None)
    _save(data)
    print(f"team_dashboard: {args.role} unregistered")
def _bar(pct: float, width: int = 10) -> str:
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
    print(f"{'role':<14} {'team':<8} {'tier':<4} {'ctx%':>6}  {'bar':<10} {'status':<12}  {'last_active':<8}  task")
    print("-" * 95)
    order = ["driver", "blue_lead", "blue_purple", "red_lead", "red_purple"]
    order += sorted([k for k in agents if k not in order])
    for role in order:
        a = agents.get(role)
        if not a:
            continue
        pct = float(a.get("ctx_used_pct", 0) or 0)
        la = a.get("last_active", "")[11:19] if a.get("last_active") else "?"
        task = (a.get("task") or "")[:40]
        print(f"{role:<14} {a.get('team','?'):<8} {a.get('tier','?'):<4} {pct:>5.1f}%  {_bar(pct):<10} {a.get('status','?'):<12}  {la:<8}  {task}")
def cmd_summary(args):
    data = _load()
    agents = data.get("agents", {})
    active = sum(1 for a in agents.values() if a.get("status") not in ("idle", "retired", "done"))
    high_ctx = sum(1 for a in agents.values() if float(a.get("ctx_used_pct", 0)) >= 85)
    idle_s = 0
    stale = 0
    unknown_ctx = 0
    now = datetime.now(timezone.utc)
    for a in agents.values():
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
    sp.add_argument("--ctx-pct", type=float, default=None)
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
