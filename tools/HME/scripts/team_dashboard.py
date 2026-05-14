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
   elif c == "\": esc = True
   elif c == quote: quote = ""
  elif c in "\"'":
   quote = c; out.append(c)
  elif c == "#" or (c == "/" and n == "/"):
   while i < len(text) and text[i] != "
": i += 1
   out.append("
")
  else:
   out.append(c)
  i += 1
 return "".join(out)
def _model_windows() -> dict[str, int]:
 global _MODEL_WINDOWS
 if _MODEL_WINDOWS is not None: return _MODEL_WINDOWS
 path = PROJECT / "config" / "models.json"
 try:
  cfg = json.loads(_jsonc(path.read_text()))
 except (OSError, json.JSONDecodeError) as exc:
  raise RuntimeError(f"model config unavailable: {path}") from exc
 wins = {}
 for td in cfg.get("tiers", {}).values():
  for m in td.get("models", []):
   if isinstance(m, dict) and m.get("id") and (m.get("max_context") or m.get("context_length")):
    wins[str(m["id"])] = int(m.get("max_context") or m.get("context_length"))
 if not wins: raise RuntimeError(f"model config has no context windows: {path}")
 _MODEL_WINDOWS = wins; return wins
MODEL_WINDOWS: dict[str, int] | None = None
ROLE_NEEDLES = {
    "blue_lead": ("You are Blue Lead",),
    "blue_purple": ("You are Blue Purple",),
    "red_lead": ("You are Red Lead",),
    "red_purple": ("You are Red Purple",),
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
    return _normalize(json.loads(DASHBOARD.read_text())) if DASHBOARD.is_file() else _empty_dashboard()
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
def _role_matches(role: str, body: dict, current_sid: str) -> bool:
    if role == "driver":
        return _metadata_session_id(body) == current_sid
    if any(m.get("_omniroute_truncated_array") for m in body.get("messages", []) if isinstance(m, dict)):
        return False
    text = _user_text(body)
    if "Filesystem IPC only" not in text or "MODE=6" not in text:
        return False
    matches = [r for r, needles in ROLE_NEEDLES.items() if any(n in text for n in needles)]
    return matches == [role]
def _strip_jsonc(text: str) -> str:
    out = []; i = 0; quote = ""; esc = False
    while i < len(text):
        c = text[i]; n = text[i + 1] if i + 1 < len(text) else ""
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
def _model_windows() -> dict[str, int]:
    global MODEL_WINDOWS
    if MODEL_WINDOWS is not None: return MODEL_WINDOWS
    cfg, wins = json.loads(_strip_jsonc((PROJECT / "config" / "models.json").read_text())), {}
    for m in cfg["models"]:
        name = m.get("name") or m.get("id")
        win = m.get("context_window") or m.get("context_length") or m.get("max_context")
        if not name or not win: raise RuntimeError("model config entry missing name/window")
        keys = {name, name.split("/", 1)[-1]}
        if m.get("provider"): keys.add(f"{m['provider']}/{name}")
        wins.update({k: int(win) for k in keys})
    if not wins: raise RuntimeError("model config has no model windows")
    MODEL_WINDOWS = wins; return wins
def _model_ctx_window(model: str, tier: str) -> int:
 key = model.split("/", 1)[-1] if model else ""
 if key in _model_windows(): return _model_windows()[key]
 if model: raise RuntimeError(f"context window unknown for model={model} tier={tier}")
 raise RuntimeError(f"omniroute row missing model for tier={tier}")
def _row_ctx(row: sqlite3.Row, tier: str, session_id: str) -> dict:
    model = row["requested_model"] or row["model"] or ""
    if not model:
        raise RuntimeError(f"omniroute row missing model for tier={tier}")
    window = _model_ctx_window(model, tier)
    pct = round(min(100, max(0, (row["tokens_in"] or 0) / max(1, window) * 100)), 1)
    return {"pct": pct, "window": window, "timestamp": row["timestamp"], "sid": session_id}
def _latest_session_ctx(rows: list[sqlite3.Row], session_id: str, tier: str) -> dict:
    for row in rows:
        body = _artifact_body(row["artifact_relpath"] or "")
        if _metadata_session_id(body) == session_id:
            return _row_ctx(row, tier, session_id)
    raise RuntimeError(f"resolved session has no context rows: {session_id}")
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
    matches = {}
    for row in rows:
        body = _artifact_body(row["artifact_relpath"] or "")
        session_id = _metadata_session_id(body)
        hits = [r for r in ROLES if _role_matches(r, body, current_sid)]
        if not hits: continue
        if not session_id: raise RuntimeError(f"omniroute artifact missing session_id for {role}")
        matches.setdefault(session_id, set()).update(hits)
    unique = sorted(s for s, hits in matches.items() if role in hits)
    if sid.count("-") == 4 and sid not in unique:
        raise RuntimeError(f"stored sid does not match role {role}: {sid}")
    if len(unique) > 1:
        raise RuntimeError(f"ambiguous omniroute sessions for {role}: {', '.join(unique)}")
    if not unique: return None
    peers = sorted(matches[unique[0]] - {role})
    if peers: raise RuntimeError(f"session {unique[0]} matches multiple roles for {role}: {', '.join(peers)}")
    return _latest_session_ctx(rows, unique[0], tier)
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
        pct = a.get("ctx_used_pct", 0)
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
