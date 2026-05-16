"""Routing health for Claude proxy, Codex proxy, and OmniRoute."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any


def _scripts_dir(root: Path) -> Path:
    return root / "tools" / "HME" / "scripts"


def _with_scripts(root: Path) -> None:
    scripts = str(_scripts_dir(root))
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _service_url(root: Path, service_id: str) -> str:
    _with_scripts(root)
    from service_registry import service, service_url  # noqa: WPS433
    return service_url(service(service_id, root), os.environ)


def _http_json(url: str, timeout: float = 2.0) -> tuple[dict[str, Any] | None, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            text = response.read().decode(errors="replace")
            return json.loads(text), ""
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _http_ok(url: str, timeout: float = 2.0) -> str:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return f"ok HTTP {response.status}"
    except Exception as exc:
        return f"unreachable {type(exc).__name__}"


def codex_sessions(root: Path) -> dict[str, Any]:
    guard = root / "tools" / "HME" / "proxy" / "codex_session_guard.js"
    try:
        raw = subprocess.check_output(["node", str(guard), "status"], text=True, timeout=3)
        return json.loads(raw)
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "rows": [], "duplicates": []}


def route_snapshot(root: Path) -> dict[str, Any]:
    proxy, proxy_err = _http_json(_service_url(root, "proxy"))
    codex, codex_err = _http_json(_service_url(root, "codex_proxy"))
    omniroute = _http_ok(_service_url(root, "omniroute"))
    sessions = codex_sessions(root)
    _with_scripts(root)
    from omniroute_recent import recent_injection_advisories, recent_requests  # noqa: WPS433
    recent = recent_requests(limit=5, model_contains="codex/")
    advisories = recent_injection_advisories(root)
    return {
        "overdrive_mode": os.environ.get("OVERDRIVE_MODE", ""),
        "proxy": proxy, "proxy_error": proxy_err,
        "codex_proxy": codex, "codex_proxy_error": codex_err,
        "omniroute": omniroute,
        "codex_sessions": sessions,
        "recent_codex_omniroute": recent,
        "injection_advisories": advisories,
    }


def routing_ready(root: Path) -> tuple[bool, list[str]]:
    snap = route_snapshot(root)
    issues: list[str] = []
    if snap["overdrive_mode"] != "1":
        issues.append(f"OVERDRIVE_MODE={snap['overdrive_mode'] or '<unset>'} expected 1")
    if snap["proxy_error"] or not snap["proxy"]:
        issues.append(f"proxy unhealthy: {snap['proxy_error']}")
    if snap["codex_proxy_error"] or not snap["codex_proxy"]:
        issues.append(f"codex_proxy unhealthy: {snap['codex_proxy_error']}")
    if not str(snap["omniroute"]).startswith("ok"):
        issues.append(f"omniroute unhealthy: {snap['omniroute']}")
    dups = snap["codex_sessions"].get("duplicates", [])
    if dups:
        issues.append(f"duplicate Codex sessions: {len(dups)}")
    if not snap["recent_codex_omniroute"]:
        issues.append("no recent codex/* OmniRoute artifacts")
    return not issues, issues


def format_route_health(root: Path) -> str:
    snap = route_snapshot(root)
    lines = ["### Routing"]
    lines.append(f"  OVERDRIVE_MODE={snap['overdrive_mode'] or '<unset>'}")
    for label, key in [("proxy", "proxy"), ("codex_proxy", "codex_proxy")]:
        data = snap[key]
        err = snap[f"{key}_error"]
        if not data:
            lines.append(f"  {label}: {err or 'unreachable'}")
            continue
        metrics = data.get("routes") or data.get("metrics") or {}
        lines.append(
            f"  {label}: ok started={data.get('started_at')} requests={metrics.get('requests', 0)} "
            f"omni={metrics.get('omniroute', 0)} direct={metrics.get('direct', 0)} last={metrics.get('last_route', '')}:{metrics.get('last_model', '')}"
        )
    lines.append(f"  omniroute: {snap['omniroute']}")
    rows = snap["codex_sessions"].get("rows", [])
    dups = snap["codex_sessions"].get("duplicates", [])
    wrappers = [r for r in rows if r.get("kind") == "wrapper"]
    lines.append(f"  codex_resume_wrappers={len(wrappers)} duplicates={len(dups)}")
    recent = snap["recent_codex_omniroute"]
    if recent:
        row = recent[0]
        lines.append(f"  latest_codex_omni={row.get('timestamp')} {row.get('status')} {row.get('requested_model')} {row.get('source_format')}->{row.get('target_format')}")
    else:
        lines.append("  latest_codex_omni=none")
    adv = snap["injection_advisories"]
    if adv:
        lines.append(f"  injection_advisories={len(adv)} advisory_only; latest={adv[-1][:120]}")
    return "\n".join(lines)


def format_routing_ready(root: Path) -> str:
    ok, issues = routing_ready(root)
    if ok:
        return "## Routing Ready\n\nPASS: OVERDRIVE_MODE=1, proxy, codex_proxy, OmniRoute, Codex artifacts, and duplicate-session checks are clean."
    return "## Routing Ready\n\nFAIL:\n" + "\n".join(f"- {issue}" for issue in issues)
