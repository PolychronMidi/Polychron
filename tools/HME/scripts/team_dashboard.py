#!/usr/bin/env python3
"""Team IPC dashboard for MODE=6 agent health."""
from __future__ import annotations
import argparse, json, os, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path
PROJECT = Path(os.environ.get("PROJECT_ROOT", os.environ.get("CLAUDE_PROJECT_DIR", "")))
DASHBOARD = PROJECT / "runtime" / "hme" / "team-dashboard.json"
ROLES = {
 "driver": {"team": "command", "tier": "E5"}, "blue_lead": {"team": "blue", "tier": "E5"}, "blue_purple": {"team": "blue", "tier": "E4"},
 "red_lead": {"team": "red", "tier": "E5"}, "red_purple": {"team": "red", "tier": "E4"},
 **{f"crew_e{tier}_{idx}": {"team": "crew", "tier": f"E{tier}"} for tier in range(4, 0, -1) for idx in range(2)},
}
ROLE_NEEDLES = {
    "blue_lead": ("You are Blue Lead",), "blue_purple": ("You are Blue Purple",),
    "red_lead": ("You are Red Lead",), "red_purple": ("You are Red Purple",),
    **{f"crew_e{tier}_{idx}": (f"crew_e{tier}_{idx}",) for tier in range(4, 0, -1) for idx in range(2)},
}
OMNI_DB = Path(os.environ.get("OMNIROUTE_DB", Path.home() / ".omniroute" / "storage.sqlite"))
TRANSCRIPTS = Path.home() / ".claude" / "projects" / "-home-jah-Polychron"
_MODEL_CFG: dict | None = None
_MODEL_WINDOWS: dict[str, int] | None = None
def _jsonc_load(text: str) -> dict:
 out = []
 i = 0
 in_str = esc = False
 while i < len(text):
  c = text[i]
  n = text[i + 1] if i + 1 < len(text) else ""
  if in_str:
   out.append(c)
   if esc: esc = False
   elif c == "\\": esc = True
   elif c == '"': in_str = False
   i += 1; continue
  if c == '"':
   in_str = True; out.append(c); i += 1; continue
  if c == "/" and n == "/":
   j = text.find("\n", i)
   if j < 0: break
   out.append("\n"); i = j + 1; continue
  if c == "/" and n == "*":
   j = text.find("*/", i + 2)
   if j < 0: raise RuntimeError("unterminated block comment in model config")
   out.append("\n" * text[i:j + 2].count("\n")); i = j + 2; continue
  out.append(c); i += 1
 return json.loads("".join(out))
def _model_cfg() -> dict:
 global _MODEL_CFG
 if _MODEL_CFG is None:
  path = PROJECT / "config" / "models.json"
  try: _MODEL_CFG = _jsonc_load(path.read_text())
  except OSError as exc: raise RuntimeError(f"model config unavailable: {path}") from exc
  except (json.JSONDecodeError, RuntimeError) as exc: raise RuntimeError(f"model config invalid: {path}") from exc
 return _MODEL_CFG

def _model_windows() -> dict[str, int]:
 global _MODEL_WINDOWS
 if _MODEL_WINDOWS is None:
  keys = ("max_context", "context_length", "context_window", "ctx_window")
  def scan(node, name=""):
   if isinstance(node, dict):
    mid = node.get("id") or node.get("model") or node.get("name") or name
    win = next((node.get(k) for k in keys if node.get(k)), None)
    if win: windows[str(mid)] = int(win)
    for key, value in node.items(): scan(value, str(key))
   elif isinstance(node, list):
    for value in node: scan(value)
  windows = {}; scan(_model_cfg())
  if not windows: raise RuntimeError(f"model config has no context_length/max_context: {PROJECT / 'config' / 'models.json'}")
  _MODEL_WINDOWS = windows
 return _MODEL_WINDOWS
def _model_ctx_window(model: str, tier: str) -> int:
 if not model: raise RuntimeError(f"omniroute row missing model for tier={tier}")
 name = model.split("/", 1)[1] if model.startswith("codex/") else model
 windows = _model_windows()
 for key in (model, name):
  if key in windows: return windows[key]
 raise RuntimeError(f"context window unknown for model={model} tier={tier}")
def _role_model(role: str, tier: str, observed: str) -> str:
 cfg = _model_cfg(); spec = cfg.get("team_role_models", {}).get(_role_key(role)) or {}
 rtier = tier if spec.get("tier") == "role" else spec.get("tier", tier)
 models = cfg.get("tiers", {}).get(rtier, {}).get("models", [])
 if spec.get("source") == "manually_toprank":
  for mid in cfg.get("manually_toprank", {}).get(rtier, []):
   if any(m.get("id") == mid for m in models): return mid
 order = cfg.get("ranking_rules", {}).get("cost_order", ["free", "subscription", "usage"])
 ranked = sorted(models, key=lambda m: (order.index(m.get("cost")) if m.get("cost") in order else len(order), -float(m.get("tier_score", 0))))
 if not ranked: raise RuntimeError(f"no configured role model for {role} tier={tier}")
 return ranked[0].get("id") or observed

def _row_ctx(role: str, row: sqlite3.Row, tier: str, session_id: str) -> dict:
 model = _role_model(role, tier, row["requested_model"] or row["model"] or "")
 window = _model_ctx_window(model, tier)
 used = float(row["tokens_in"] or 0)
 pct = round(min(100.0, max(0.0, used / max(1, window) * 100)), 1)
 return {"pct": pct, "window": window, "timestamp": row["timestamp"], "sid": session_id, "model": model}
def _metadata_session_id(body: dict) -> str:
 meta = body.get("metadata") if isinstance(body, dict) else {}
 user_id = meta.get("user_id") if isinstance(meta, dict) else None
 try: return json.loads(user_id).get("session_id", "") if isinstance(user_id, str) else ""
 except (json.JSONDecodeError, TypeError): return ""
def _user_text(body: dict) -> str:
 chunks = []
 for msg in body.get("messages", []):
  if msg.get("role") != "user":
   continue
  parts = msg.get("content")
  if isinstance(parts, str):
   chunks.append(parts)
  elif isinstance(parts, list):
   chunks.extend(str(b.get("text") or b.get("content") or "") for b in parts if isinstance(b, dict))
 return "\n".join(chunks)
def _looks_real_sid(sid: str) -> bool:
 return len(sid) == 36 and sid.count("-") == 4 and all(c in "0123456789abcdef-" for c in sid.lower())
def _role_identity(role: str) -> str:
 root = TRANSCRIPTS / "7992e911-8138-4ca3-9b34-6b6c69dc03d6" / "subagents"
 newest = ("", "")
 for p in root.glob("agent-*.jsonl"):
  try:
   first = json.loads(p.read_text(errors="ignore").splitlines()[0])
  except (OSError, IndexError, json.JSONDecodeError):
   continue
  if _role_names({"messages": [first.get("message", {})]}) == [role]:
   newest = max(newest, (first.get("timestamp", ""), first.get("agentId", "")))
 if not newest[1]: raise RuntimeError(f"subagent identity unavailable for {role}")
 return newest[1]
def _role_key(role: str) -> str:
 if role in ("blue_lead", "red_lead"): return "team_lead"
 if role in ("blue_purple", "red_purple"): return "team_purple"
 if role.startswith("crew_"): return "stage_crew"
 return role

def _role_names(body: dict) -> list[str]:
 if any(m.get("_omniroute_truncated_array") for m in body.get("messages", []) if isinstance(m, dict)):
  return []
 text = _user_text(body)
 if "Filesystem IPC only" not in text or "MODE=6" not in text:
  return []
 return [r for r, needles in ROLE_NEEDLES.items() if any(n in text for n in needles)]
def _role_matches(role: str, body: dict, current_sid: str) -> bool:
 if role == "driver":
  return _metadata_session_id(body) == current_sid
 return _role_names(body) == [role]
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
  if role != "driver":
   session_id = _role_identity(role)
  elif _looks_real_sid(sid) and sid != session_id:
   raise RuntimeError(f"stored sid mismatch for {role}: {sid} != {session_id}")
  return _row_ctx(role, row, tier, session_id)
 return None
def _artifact_body(relpath: str) -> dict:
 p = Path.home() / ".omniroute" / "call_logs" / relpath
 try:
  return json.loads(p.read_text()).get("requestBody", {})
 except (OSError, json.JSONDecodeError, TypeError):
  return {}
def _current_session_id() -> str:
 path = PROJECT / "tmp" / "hme-transcript-path.txt"
 try:
  value = path.read_text().strip()
 except OSError as exc:
  raise RuntimeError(f"current session path unavailable: {path}") from exc
 if not value:
  raise RuntimeError(f"current session path empty: {path}")
 return Path(value).stem
def _ctx_info(role: str, sid: str, tier: str, forked_at: str | None = None) -> dict:
 if os.environ.get("OVERDRIVE_MODE") == "6":
  ctx = _omniroute_ctx(role, sid, tier, forked_at)
  if not ctx:
   raise RuntimeError(f"omniroute context unavailable for {role} sid={sid}")
  return {"pct": ctx["pct"], "window": ctx["window"], "sid": ctx["sid"], "model": ctx["model"]}
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
def _now() -> str:
 return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def _empty_dashboard() -> dict:
 mode = os.environ.get("OVERDRIVE_MODE")
 data = {"updated_at": _now(), "agents": {}}
 if mode:
  try: data["mode"] = int(mode)
  except ValueError: data["mode"] = mode
 return data
def _normalize(data: dict) -> dict:
 data.setdefault("agents", {})
 if "mode" not in data:
  mode = os.environ.get("OVERDRIVE_MODE")
  if mode:
   try:
    data["mode"] = int(mode)
   except ValueError:
    data["mode"] = mode
 data.pop("stage_crew", None)
 return data
def _load() -> dict:
 if DASHBOARD.is_file():
  try: return _normalize(json.loads(DASHBOARD.read_text()))
  except (json.JSONDecodeError, OSError): pass
 return _empty_dashboard()
def _save(data: dict) -> None:
 data = _normalize(data)
 data["updated_at"] = _now()
 DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
 tmp = Path(str(DASHBOARD) + f".{os.getpid()}.tmp")
 tmp.write_text(json.dumps(data, indent=2))
 tmp.rename(DASHBOARD)
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
        "model": info.get("model", ""),
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
        a["model"] = info.get("model", "")
        a["sid"] = info["sid"]
    _save(data)
def cmd_unregister(args):
    data = _load(); data.get("agents", {}).pop(args.role, None)
    _save(data)
    print(f"team_dashboard: {args.role} unregistered")
def _bar(pct: float, width: int = 10) -> str:
    filled = round(float(pct) / 100 * width)
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
    for name in ("role", "sid", "tier"): sp.add_argument(name)
    sp.add_argument("--task", default="")
    sp.set_defaults(func=cmd_register)
    sp = sub.add_parser("update", help="update agent fields")
    sp.add_argument("role")
    sp.add_argument("--ctx-pct", type=float, default=None)
    sp.add_argument("--status", default=""); sp.add_argument("--task", default=None)
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
