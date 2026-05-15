"""Single source of truth for HME service metadata."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from jsonc import load_jsonc


PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[3]
)
REGISTRY_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "services.json"


def load_services(root: Path | None = None) -> list[dict[str, Any]]:
    path = (root or PROJECT_ROOT) / "tools" / "HME" / "config" / "services.json"
    data = load_jsonc(path)
    services = data.get("services", [])
    if not isinstance(services, list):
        raise ValueError(f"{path}: services must be a list")
    return services


def service_map(root: Path | None = None) -> dict[str, dict[str, Any]]:
    return {str(s.get("id")): s for s in load_services(root)}


def service_enabled(service: dict[str, Any], env: dict[str, str] | None = None) -> bool:
    rule = service.get("enabled_when")
    if not rule:
        return True
    env = env or os.environ
    unless_env = rule.get("unless_env")
    if unless_env and env.get(str(unless_env)) == str(rule.get("unless_value", "1")):
        return False
    name = rule.get("env")
    allowed = {str(v) for v in rule.get("in", [])}
    return bool(name and env.get(str(name)) in allowed)


def service_url(service: dict[str, Any], env: dict[str, str] | None = None) -> str:
    env = env or os.environ
    host = service.get("host", "127.0.0.1")
    port = env.get(str(service.get("env_port") or ""), service.get("default_port"))
    path = str(service.get("health_path") or "/health")
    if not path.startswith("/"):
        path = "/" + path
    return f"http://{host}:{port}{path}"


def heartbeat_path(service: dict[str, Any], root: Path | None = None) -> Path:
    root = root or PROJECT_ROOT
    rel = service.get("heartbeat_file")
    if not rel:
        raise ValueError(f"{service.get('id')}: missing heartbeat_file")
    return root / str(rel)


def universal_pulse_http_probes(root: Path | None = None) -> list[dict[str, Any]]:
    probes: list[dict[str, Any]] = []
    for service in load_services(root):
        if service.get("kind") != "http":
            continue
        if not service_enabled(service):
            continue
        probes.append({
            "name": service["id"],
            "url": service_url(service),
            "timeout_sec": service.get("timeout_sec", 3),
            "required": bool(service.get("required", True)),
        })
    return probes
