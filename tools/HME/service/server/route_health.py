"""Routing health for Claude proxy, Codex proxy, and OmniRoute."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hme_env import ENV


def _scripts_dir(root: Path) -> Path:
    return root / "tools" / "HME" / "scripts"


def _with_scripts(root: Path) -> None:
    scripts = str(_scripts_dir(root))
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _service_url(root: Path, service_id: str) -> str:
    _with_scripts(root)
    from service_registry import service, service_url  # noqa: WPS433
    return service_url(service(service_id, root))


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


def _parse_ts(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _age_minutes(value: str | None) -> float:
    ts = _parse_ts(value)
    return max(0.0, (time.time() - ts) / 60.0) if ts else 0.0


def _newer_than_started(root: Path, started_at: str | None, rels: list[str]) -> list[str]:
    started = _parse_ts(started_at)
    if not started:
        return []
    stale = []
    for rel in rels:
        path = root / rel
        try:
            if path.stat().st_mtime > started:
                stale.append(rel)
        except OSError:
            continue
    return stale


def _epoch_errors(root: Path, rel: str, marker: str) -> list[str]:
    path = root / rel
    if not path.exists():
        return []
    lines = path.read_text(errors="replace").splitlines()[-1200:]
    start = 0
    needle = f"=== {marker} start "
    for idx, line in enumerate(lines):
        if needle in line:
            start = idx + 1
    err_re = re.compile(r"\b(ERROR|FAIL|Exception|Traceback|timeout|EADDRINUSE|unhandled)\b", re.I)
    return [line[:180] for line in lines[start:] if err_re.search(line)][-3:]


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
    from omniroute_recent import injection_advisory_counts, recent_requests  # noqa: WPS433
    recent = recent_requests(limit=5, model_contains="codex/")
    latest_age = _age_minutes(recent[0].get("timestamp") if recent else "")
    proxy_stale = _newer_than_started(root, proxy.get("started_at") if proxy else None, [
        "tools/HME/proxy/hme_proxy.js", "tools/HME/proxy/overdrive_route.js",
        "tools/HME/proxy/proxy_route_metrics.js", "tools/HME/proxy/start_marker.js",
    ])
    codex_stale = _newer_than_started(root, codex.get("started_at") if codex else None, [
        "tools/HME/proxy/codex_proxy.js", "tools/HME/proxy/codex_omniroute.js",
        "tools/HME/proxy/codex_session_guard.js", "tools/HME/proxy/model_route_resolver.js",
        "tools/HME/proxy/request_transform_core.js", "tools/HME/proxy/codex_native_tools.js",
        "tools/HME/proxy/start_marker.js",
    ])
    epoch_errors = {
        "proxy": _epoch_errors(root, "log/hme-proxy.out", "hme_proxy"),
        "codex_proxy": _epoch_errors(root, "log/hme-codex-proxy.out", "codex_proxy"),
        "omniroute": _epoch_errors(root, "log/omniroute.out", "omniroute"),
    }
    return {
        "overdrive_mode": ENV.optional("OVERDRIVE_MODE", ""),
        "proxy": proxy, "proxy_error": proxy_err, "proxy_stale_sources": proxy_stale,
        "codex_proxy": codex, "codex_proxy_error": codex_err, "codex_proxy_stale_sources": codex_stale,
        "omniroute": omniroute,
        "codex_sessions": sessions,
        "recent_codex_omniroute": recent,
        "latest_codex_age_min": latest_age,
        "injection_advisory_counts": injection_advisory_counts(root),
        "epoch_errors": epoch_errors,
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
    if snap.get("proxy_stale_sources"):
        n = len(snap["proxy_stale_sources"])
        issues.append(f"proxy stale sources: {n} newer-than-process")
    if snap.get("codex_proxy_stale_sources"):
        n = len(snap["codex_proxy_stale_sources"])
        issues.append(f"codex_proxy stale sources: {n} newer-than-process")
    dups = snap["codex_sessions"].get("duplicates", [])
    if dups:
        issues.append(f"duplicate Codex sessions: {len(dups)}")
    if not snap["recent_codex_omniroute"]:
        issues.append("no recent codex/* OmniRoute artifacts")
    wrappers = [r for r in snap["codex_sessions"].get("rows", []) if r.get("kind") == "wrapper"]
    if wrappers and snap["latest_codex_age_min"] > 10:
        issues.append(f"latest codex/* OmniRoute artifact is stale ({snap['latest_codex_age_min']:.1f}m)")
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
        stale = snap.get(f"{key}_stale_sources") or []
        if stale:
            lines.append(f"    stale_source_warning={len(stale)} newer-than-process")
    lines.append(f"  omniroute: {snap['omniroute']}")
    rows = snap["codex_sessions"].get("rows", [])
    dups = snap["codex_sessions"].get("duplicates", [])
    wrappers = [r for r in rows if r.get("kind") == "wrapper"]
    lines.append(f"  codex_resume_wrappers={len(wrappers)} duplicates={len(dups)}")
    recent = snap["recent_codex_omniroute"]
    if recent:
        row = recent[0]
        lines.append(f"  latest_codex_omni={row.get('timestamp')} {row.get('status')} {row.get('requested_model')} {row.get('source_format')}->{row.get('target_format')} age={snap['latest_codex_age_min']:.1f}m")
    else:
        lines.append("  latest_codex_omni=none")
    adv = snap["injection_advisory_counts"]
    if adv:
        summary = ", ".join(f"{k}:{v}" for k, v in sorted(adv.items()))
        lines.append(f"  injection_advisories={summary} advisory_only")
    epoch_errors = snap["epoch_errors"]
    flat = [(name, item) for name, items in epoch_errors.items() for item in items]
    lines.append(f"  log_epoch_errors={'none' if not flat else len(flat)}")
    for name, item in flat[:3]:
        lines.append(f"    {name}: {item}")
    return "\n".join(lines)


def format_routing_ready(root: Path) -> str:
    ok, issues = routing_ready(root)
    if ok:
        return "## Routing Ready\n\nPASS: OVERDRIVE_MODE=1, proxy, codex_proxy, OmniRoute, Codex artifacts, and duplicate-session checks are clean."
    return "## Routing Ready\n\nFAIL:\n" + "\n".join(f"- {issue}" for issue in issues)
