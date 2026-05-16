#!/usr/bin/env python3
"""Validate live Codex CLI hooks and HME Responses proxy provider config."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

from codex_settings import (  # noqa: E402
    CONFIG_PATH,
    HOOKS_JSON,
    LIVE_HOOKS_JSON,
    MODEL_CATALOG_JSON,
    PROJECT_ROOT,
    compare_model_catalog,
    compare_config,
    compare_hooks,
    expected_hooks,
    load_json,
    path_violations,
    runtime_notes,
)


def _service_port() -> int:
    script = (
        "const {servicePort}=require('./tools/HME/proxy/service_registry');"
        "process.stdout.write(String(servicePort('codex_proxy')));"
    )
    proc = subprocess.run(["node", "-e", script], cwd=ROOT, text=True, capture_output=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "failed to resolve codex_proxy service port")
    return int(proc.stdout.strip())


def _audit() -> list[str]:
    violations: list[str] = []
    if not LIVE_HOOKS_JSON.exists():
        violations.append(f"{LIVE_HOOKS_JSON}: file not present")
    else:
        try:
            live_hooks = load_json(LIVE_HOOKS_JSON)
            expected = expected_hooks(project_root=PROJECT_ROOT, hooks_json=HOOKS_JSON)
            violations.extend(compare_hooks(live_hooks, expected))
            violations.extend(path_violations(live_hooks))
        except Exception as e:
            violations.append(f"{LIVE_HOOKS_JSON}: {e}")

    if not CONFIG_PATH.exists():
        violations.append(f"{CONFIG_PATH}: file not present")
    else:
        try:
            text = CONFIG_PATH.read_text(encoding="utf-8")
            port = _service_port()
            violations.extend(compare_config(text, port=port))
        except Exception as e:
            violations.append(f"{CONFIG_PATH}: {e}")

    violations.extend(compare_model_catalog())

    return violations


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    violations = _audit()
    if args.json:
        print(json.dumps({
            "config_path": str(CONFIG_PATH),
            "hooks_path": str(LIVE_HOOKS_JSON),
            "model_catalog_path": str(MODEL_CATALOG_JSON),
            "violation_count": len(violations),
            "violations": violations,
            "notes": runtime_notes(),
        }, indent=2))
    else:
        if not violations:
            print(f"[ok] {CONFIG_PATH} and {LIVE_HOOKS_JSON}: HME Codex hooks/provider are installed")
            for note in runtime_notes():
                print(f"[note] {note}")
            return 0
        print(f"[no] {len(violations)} Codex settings violation(s):")
        for v in violations:
            print(f"  {v}")
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
