#!/usr/bin/env python3
"""Audit OpenCode config for HME-owned provider ingress materialization."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
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
)


def _service_port() -> int:
    script = "const {servicePort}=require('./tools/HME/proxy/service_registry'); process.stdout.write(String(servicePort('proxy')));"
    proc = subprocess.run(["node", "-e", script], cwd=ROOT, text=True, capture_output=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "failed to resolve HME proxy service port")
    return int(proc.stdout.strip())


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--config", default=str(OPENCODE_CONFIG_PATH))
    ap.add_argument("--project-root", default=str(PROJECT_ROOT))
    args = ap.parse_args()
    path = Path(args.config).expanduser()
    violations: list[str] = []
    try:
        port = _service_port()
        live = _load(path)
        violations.extend(compare_config(live, port, Path(args.project_root).resolve()))
        violations.extend(path_violations(managed_config(live, port, Path(args.project_root).resolve()), port))
    except Exception as e:
        violations.append(str(e))
    if args.json:
        print(json.dumps({"config_path": str(path), "violation_count": len(violations), "violations": violations, "notes": runtime_notes()}, indent=2))
    elif violations:
        print(f"[no] {len(violations)} OpenCode settings violation(s):")
        for item in violations:
            print(f"  {item}")
    else:
        print(f"[ok] {path}: OpenCode provider materialization is HME-owned")
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
