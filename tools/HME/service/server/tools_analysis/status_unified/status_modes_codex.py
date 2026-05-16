"""Codex proxy visibility status modes."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from server import context as ctx


def _iter_events(path: str, limit: int = 200) -> list[dict]:
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()[-limit:]
    except OSError:
        return []
    events: list[dict] = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events


def _fmt_delta(before: dict, after: dict) -> str:
    b = int(before.get("body_bytes", 0) or 0)
    a = int(after.get("body_bytes", 0) or 0)
    sign = "+" if a - b >= 0 else ""
    return f"{b}->{a} ({sign}{a - b})"


def _mode_codex_proxy() -> str:
    path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "runtime", "codex-proxy-events.jsonl")
    requests = [e for e in _iter_events(path) if e.get("kind") == "request"][-20:]
    out = ["# Codex proxy payload visibility", ""]
    if not requests:
        out.append("No Codex proxy request events yet.")
        out.append(f"Log: {path}")
        return "\n".join(out)
    out.append("last 20 requests (no raw prompt text):")
    out.append("  ts                  model       bytes(delta)        instr  text   tools cleanup")
    for event in requests:
        payload_log = event.get("payload_log") or {}
        before = payload_log.get("before") or event.get("before") or {}
        after = payload_log.get("after") or event.get("after") or {}
        cleanup = event.get("cleanup") or {}
        cats = cleanup.get("categories") or {}
        cleanup_bits = ",".join(f"{k}={v}" for k, v in sorted(cats.items()) if v) or "none"
        out.append(
            f"  {str(event.get('ts', '?'))[:19]:19} "
            f"{str(after.get('model') or before.get('model') or '?')[:10]:10} "
            f"{_fmt_delta(before, after):18} "
            f"{int(after.get('instruction_bytes', 0) or 0):6} "
            f"{int(after.get('text_bytes', 0) or 0):6} "
            f"{int(after.get('tool_count', 0) or 0):5} "
            f"{cleanup_bits}"
        )
    total_removed = sum(int((e.get("cleanup") or {}).get("removed_bytes", 0) or 0) for e in requests)
    transformed = sum(1 for e in requests if e.get("transformed"))
    out.append("")
    out.append(f"transformed={transformed}/{len(requests)}  removed_bytes={total_removed}")
    out.append(f"Log: {path}")
    return "\n".join(out)




def _service_port(service_id: str, default: int) -> int:
    path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "config", "services.json")
    try:
        with open(path, encoding="utf-8") as f:
            services = (json.load(f).get("services") or [])
        for spec in services:
            if spec.get("id") != service_id:
                continue
            env_port = os.environ.get(str(spec.get("env_port") or ""))  # env-ok: optional service port override
            return int(env_port or spec.get("default_port") or default)
    except Exception as _exc:
        return default
    return default


def _json_url(url: str, *, timeout: float = 2.0, data: dict | None = None,
              headers: dict | None = None) -> tuple[object | None, str]:
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "null"), ""
    except (OSError, urllib.error.URLError, ValueError) as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _health(service_id: str, default_port: int, path: str = "/health") -> tuple[dict | None, str]:
    port = _service_port(service_id, default_port)
    return _json_url(f"http://127.0.0.1:{port}{path}", timeout=2.0)


def _latest_codex_pair(events: list[dict]) -> tuple[dict | None, dict | None]:
    req = next((e for e in reversed(events) if e.get("kind") == "request"), None)
    resp = next((e for e in reversed(events) if e.get("kind") == "response"), None)
    return req, resp


def _native_read_edit_line(req: dict | None) -> str:
    after = (req or {}).get("after") or {}
    tools = set(after.get("tool_names") or [])
    if not tools:
        return "codex native Read/Edit: unknown (no tool_names in latest request)"
    read_ok = "Read" in tools
    edit_ok = "Edit" in tools or "MultiEdit" in tools
    if read_ok and edit_ok:
        return "codex native Read/Edit: present"
    missing = []
    if not read_ok:
        missing.append("Read")
    if not edit_ok:
        missing.append("Edit/MultiEdit")
    return f"codex native Read/Edit: absent ({', '.join(missing)} missing); bridge fallback active"


def _omniroute_logs(limit: int = 40) -> tuple[list[dict], str]:
    port = _service_port("omniroute", 20128)
    password = (os.environ.get("OMNIROUTE_PASSWORD") or os.environ.get("INITIAL_PASSWORD") or "polychron")  # env-ok: optional local dashboard auth
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    try:
        login = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/auth/login",
            data=json.dumps({"password": password}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with opener.open(login, timeout=2.0) as resp:
            if resp.status >= 400:
                return [], f"login HTTP {resp.status}"
        with opener.open(f"http://127.0.0.1:{port}/api/usage/call-logs?limit={limit}", timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
        return data if isinstance(data, list) else [], ""
    except (OSError, urllib.error.URLError, ValueError) as exc:
        return [], f"{type(exc).__name__}: {exc}"



def _probe_claude_route() -> tuple[str, str]:
    if os.environ.get("HME_CODEX_ROUTE_SMOKE_ACTIVE") == "0":  # env-ok: interactive smoke toggle
        return "skipped", "disabled by HME_CODEX_ROUTE_SMOKE_ACTIVE=0"
    port = _service_port("omniroute", 20128)
    model = os.environ.get("HME_CODEX_ROUTE_SMOKE_MODEL", "cx/gpt-5.5-low")  # env-ok: interactive smoke model
    body = {
        "model": model,
        "max_tokens": 1,
        "stream": False,
        "messages": [{"role": "user", "content": "Reply OK."}],
    }
    data, err = _json_url(f"http://127.0.0.1:{port}/v1/messages", timeout=20.0, data=body)
    if err:
        return "error", err
    if isinstance(data, dict) and data.get("type") == "message":
        return "ok", model
    return "warn", "unexpected response shape"

def _fmt_health(name: str, data: dict | None, err: str) -> str:
    if not isinstance(data, dict):
        return f"{name}: DOWN ({err or 'no response'})"
    status = data.get("status") or data.get("ok") or "?"
    bits = [f"{name}: {status}"]
    if data.get("git_sha"):
        bits.append(f"sha={data.get('git_sha')}")
    if data.get("started_at"):
        bits.append(f"started={data.get('started_at')}")
    if data.get("upstream"):
        bits.append(f"upstream={data.get('upstream')}")
    return " ".join(bits)


def _fmt_call(call: dict | None) -> str:
    if not call:
        return "missing"
    return (
        f"path={call.get('path')} requested={call.get('requestedModel')} "
        f"source={call.get('sourceFormat')} target={call.get('targetFormat')} "
        f"status={call.get('status')}"
    )


def _mode_codex_route() -> str:
    events_path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "runtime", "codex-proxy-events.jsonl")
    events = _iter_events(events_path, limit=80)
    req, resp = _latest_codex_pair(events)
    proxy, proxy_err = _health("proxy", 9099)
    codex, codex_err = _health("codex_proxy", 9102)
    probe_status, probe_detail = _probe_claude_route()
    logs, logs_err = _omniroute_logs()
    codex_calls = [c for c in logs if c.get("provider") == "codex" or "codex/" in str(c.get("requestedModel"))]
    direct = next((c for c in codex_calls if c.get("path") == "/v1/responses"), None)
    claude = next((c for c in codex_calls if c.get("path") == "/v1/messages"), None)
    direct_ok = bool(direct and direct.get("sourceFormat") == "openai-responses"
                     and direct.get("targetFormat") == "openai-responses"
                     and 200 <= int(direct.get("status") or 0) < 300)
    claude_ok = bool(claude and claude.get("sourceFormat") == "claude"
                     and claude.get("targetFormat") == "openai-responses"
                     and 200 <= int(claude.get("status") or 0) < 300)
    out = ["# Codex route smoke", ""]
    out.append(_fmt_health("proxy", proxy, proxy_err))
    out.append(_fmt_health("codex_proxy", codex, codex_err))
    if req:
        out.append(
            "codex_proxy latest request: "
            f"route={req.get('route')} upstream={req.get('upstream')} "
            f"model={(req.get('after') or {}).get('model') or req.get('model')}"
        )
    else:
        out.append("codex_proxy latest request: missing")
    if resp:
        out.append(
            "codex_proxy latest response: "
            f"route={resp.get('route')} status={resp.get('status')} model={resp.get('model')}"
        )
    else:
        out.append("codex_proxy latest response: missing")
    out.append(_native_read_edit_line(req))
    out.append(f"omniroute claude probe: {probe_status} ({probe_detail})")
    out.append("omniroute visibility: api=/api/usage/call-logs db=unused")
    out.append("omniroute direct: " + _fmt_call(direct))
    out.append("omniroute claude: " + _fmt_call(claude))
    if logs_err:
        out.append(f"omniroute logs: unavailable ({logs_err})")
    verdict = "PASS" if direct_ok and (claude_ok or probe_status == "skipped") else "WARN"
    if claude is None:
        out.append("note: no recent Claude /v1/messages -> Codex call in OmniRoute logs")
    out.append("")
    out.append(f"verdict={verdict}")
    return "\n".join(out)



def _mode_hook_decisions() -> str:
    path = os.path.join(ctx.PROJECT_ROOT, "runtime", "hme", "hook-decisions.jsonl")
    events = _iter_events(path, limit=80)
    out = ["# Hook decision compact", ""]
    relevant = [e for e in events if e.get("decision") != "allow" or e.get("reason_hash")]
    if not relevant:
        out.append("No hook deny/feedback decisions recorded yet.")
        out.append(f"Log: {path}")
        return "\n".join(out)
    last = relevant[-1]
    out.append("last deny/feedback decision:")
    out.append(
        f"  ts={last.get('ts')} host={last.get('host')} event={last.get('event')} "
        f"tool={last.get('tool')} decision={last.get('decision')}"
    )
    out.append(
        f"  reason_hash={last.get('reason_hash')} "
        f"surfaced_channels={','.join(last.get('surfaced_channels') or []) or 'none'} "
        f"duplicate_systemMessage_stripped={last.get('duplicate_systemMessage_stripped')}"
    )
    out.append("")
    out.append(f"Log: {path}")
    return "\n".join(out)
