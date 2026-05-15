"""Single source of truth for HME service metadata."""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
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


def service_pid_label(spec: dict[str, Any]) -> str:
    return str(spec.get("pid_label") or spec.get("id") or "")


def supervised_children(parent_id: str, root: Path | None = None,
                        required_only: bool = False,
                        env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    children = []
    for spec in load_services(root):
        if spec.get("supervised_by") != parent_id:
            continue
        if required_only and not bool(spec.get("required", True)):
            continue
        if not service_enabled(spec, env):
            continue
        children.append(spec)
    return children


def bundle_services(parent_id: str, root: Path | None = None,
                    env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    parent = service(parent_id, root)
    return [parent, *supervised_children(parent_id, root=root, env=env)]


def bundle_process_patterns(parent_id: str, root: Path | None = None) -> list[str]:
    patterns: list[str] = []
    for spec in bundle_services(parent_id, root):
        for pat in spec.get("process_patterns", []) or []:
            if pat and pat not in patterns:
                patterns.append(str(pat))
    return patterns


def bundle_pid_labels(parent_id: str, root: Path | None = None) -> list[str]:
    labels: list[str] = []
    for spec in bundle_services(parent_id, root):
        label = service_pid_label(spec)
        if label and label not in labels:
            labels.append(label)
    return labels


def required_supervised_urls(parent_id: str, root: Path | None = None,
                             env: dict[str, str] | None = None) -> list[tuple[str, str]]:
    urls = []
    for spec in supervised_children(parent_id, root=root, required_only=True, env=env):
        if spec.get("kind") == "http":
            urls.append((str(spec["id"]), service_url(spec, env)))
    return urls


def bundle_health(parent_id: str, root: Path | None = None,
                  env: dict[str, str] | None = None) -> tuple[bool, list[str]]:
    env = env or os.environ
    issues: list[str] = []
    checks: list[tuple[str, str, float]] = []
    parent = service(parent_id, root)
    if parent.get("kind") == "http":
        checks.append((str(parent["id"]), service_url(parent, env),
                       float(parent.get("timeout_sec", 3))))
    for child in supervised_children(parent_id, root=root, required_only=True, env=env):
        if child.get("kind") == "http":
            checks.append((str(child["id"]), service_url(child, env),
                           float(child.get("timeout_sec", 3))))
    for sid, url, timeout in checks:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                if response.status >= 400:
                    issues.append(f"{sid}: HTTP {response.status} at {url}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            issues.append(f"{sid}: {type(e).__name__} at {url}")
    return (not issues, issues)


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
        print("usage: service_registry.py <url|port|host|start|pid-file|pid-label|log-file|process-patterns|supervised-children|required-supervised-urls|bundle-process-patterns|bundle-pid-labels|bundle-health> <service-id>", file=sys.stderr)
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
    elif cmd == "pid-label":
        print(service_pid_label(spec))
    elif cmd == "log-file":
        print(spec.get("log_file", ""))
    elif cmd == "process-patterns":
        print("\n".join(str(x) for x in spec.get("process_patterns", [])))
    elif cmd == "supervised-children":
        print("\n".join(str(x["id"]) for x in supervised_children(sid)))
    elif cmd == "required-supervised-urls":
        print("\n".join(f"{child_id} {url}" for child_id, url in required_supervised_urls(sid)))
    elif cmd == "bundle-process-patterns":
        print("\n".join(bundle_process_patterns(sid)))
    elif cmd == "bundle-pid-labels":
        print("\n".join(bundle_pid_labels(sid)))
    elif cmd == "bundle-health":
        ok, issues = bundle_health(sid)
        if ok:
            print("ok")
        else:
            print("\n".join(issues))
            return 1
    else:
        print(f"unknown service_registry command: {cmd}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
