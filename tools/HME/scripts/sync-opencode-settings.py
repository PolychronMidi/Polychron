#!/usr/bin/env python3
"""Sync OpenCode config to use HME as OpenAI-compatible provider ingress."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

from opencode_settings import (  # noqa: E402
    OPENCODE_CONFIG_PATH,
    PROJECT_ROOT,
    compare_config,
    managed_config,
    path_violations,
    runtime_notes,
    strip_jsonc,
)


def _service_port() -> int:
    script = "const {servicePort}=require('./tools/HME/proxy/service_registry'); process.stdout.write(String(servicePort('proxy')));"
    proc = subprocess.run(["node", "-e", script], cwd=ROOT, text=True, capture_output=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "failed to resolve HME proxy service port")
    return int(proc.stdout.strip())


def _load_jsonc(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(strip_jsonc(path.read_text(encoding="utf-8")))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    return data


def _payload(path: Path, drift: list[str], changed: bool = False) -> str:
    return json.dumps({
        "config_path": str(path),
        "drift_count": len(drift),
        "drift": drift,
        "changed": changed,
        "notes": runtime_notes(),
    }, indent=2)


def _write_with_backup(path: Path, text: str, *, no_backup: bool) -> bool:
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    if current == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not no_backup:
        backup = path.with_name(f"{path.name}.bak-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}")
        backup.write_text(current, encoding="utf-8")
    path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="verify live OpenCode config without writing")
    ap.add_argument("--json", action="store_true", help="emit machine-readable output")
    ap.add_argument("--config", default=str(OPENCODE_CONFIG_PATH), help="OpenCode opencode.jsonc path")
    ap.add_argument("--project-root", default=str(PROJECT_ROOT), help="project root")
    ap.add_argument("--no-backup", action="store_true", help="write without backups")
    args = ap.parse_args()

    config_path = Path(args.config).expanduser()
    project_root = Path(args.project_root).resolve()
    try:
        port = _service_port()
        live = _load_jsonc(config_path)
        expected = managed_config(live, port, project_root)
    except Exception as e:
        drift = [str(e)]
        if args.json:
            print(_payload(config_path, drift))
        else:
            print(f"[no] {e}")
        return 1

    drift = []
    drift.extend(compare_config(live, port, project_root))
    drift.extend(path_violations(expected, port))
    if args.check:
        if args.json:
            print(_payload(config_path, drift))
        elif drift:
            print(f"[no] {len(drift)} managed OpenCode setting drift(s):")
            for item in drift:
                print(f"  {item}")
        else:
            print(f"[ok] {config_path}: OpenCode provider points at HME ingress")
            for note in runtime_notes():
                print(f"[note] {note}")
        return 0 if not drift else 1

    changed = _write_with_backup(config_path, json.dumps(expected, indent=2) + "\n", no_backup=args.no_backup)
    if args.json:
        print(_payload(config_path, [], changed=changed))
    else:
        print(f"[ok] {config_path}: {'updated' if changed else 'already current'}")
        for note in runtime_notes():
            print(f"[note] {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
