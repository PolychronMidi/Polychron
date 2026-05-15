"""Single source of truth for HME service metadata."""
from __future__ import annotations

import os
import sys
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
    if not path.exists():
        path = Path(__file__).resolve().parents[3] / "tools" / "HME" / "config" / "services.json"
    data = load_jsonc(path)
    services = data.get("services", [])
    if not isinstance(services, list):
        raise ValueError(f"{path}: services must be a list")
    return services


def service_map(root: Path | None = None) -> dict[str, dict[str, Any]]:
    return {str(s.get("id")): s for s in load_services(root)}


def service(spec_id: str, root: Path | None = None) -> dict[str, Any]:
    services = service_map(root)
    if spec_id not in services:
        raise KeyError(f"unknown HME service: {spec_id}")
    return services[spec_id]


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
    port = service_port(service, env)
    path = str(service.get("health_path") or "/health")
    if not path.startswith("/"):
        path = "/" + path
    return f"http://{host}:{port}{path}"


def service_port(service: dict[str, Any], env: dict[str, str] | None = None) -> int:
    env = env or os.environ
    raw = env.get(str(service.get("env_port") or ""))
    value = raw if raw not in (None, "") else service.get("default_port")
    try:
        port = int(str(value))
    except Exception as e:
        raise ValueError(f"{service.get('id')}: invalid port {value!r}: {e}") from e
    if port < 1 or port > 65535:
        raise ValueError(f"{service.get('id')}: invalid port {port}")
    return port


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


def _main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] in ("-h", "--help"):
        print("usage: service_registry.py <url|port|host|start|pid-file|log-file|process-patterns> <service-id>", file=sys.stderr)
        return 2
    cmd, sid = argv[0], argv[1]
    spec = service(sid)
    if cmd == "url":
        print(service_url(spec))
    elif cmd == "port":
        print(service_port(spec))
    elif cmd == "host":
        print(spec.get("host", "127.0.0.1"))
    elif cmd == "start":
        print(" ".join(str(x) for x in spec.get("start", [])))
    elif cmd == "pid-file":
        print(spec.get("pid_file", ""))
    elif cmd == "log-file":
        print(spec.get("log_file", ""))
    elif cmd == "process-patterns":
        print("\n".join(str(x) for x in spec.get("process_patterns", [])))
    else:
        print(f"unknown service_registry command: {cmd}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
