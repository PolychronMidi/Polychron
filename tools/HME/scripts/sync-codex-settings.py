#!/usr/bin/env python3
"""Sync live Codex CLI hooks and provider config from HME registries."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
sys.path.insert(0, str(ROOT / "tools" / "HME" / "proxy"))

from codex_settings import (  # noqa: E402
    CONFIG_PATH,
    HOOKS_JSON,
    LIVE_HOOKS_JSON,
    MODEL_CATALOG_JSON,
    PROJECT_ROOT,
    compare_model_catalog,
    compare_config,
    compare_hooks,
    expected_config_text,
    expected_hooks,
    load_json,
    path_violations,
    runtime_notes,
    write_model_catalog,
)


def _service_port() -> int:
    import subprocess

    script = (
        "const {servicePort}=require('./tools/HME/proxy/service_registry');"
        "process.stdout.write(String(servicePort('codex_proxy')));"
    )
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "failed to resolve codex_proxy service port")
    return int(proc.stdout.strip())


def _load_live_hooks(path: Path) -> dict:
    if not path.exists():
        return {}
    data = load_json(path)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    return data


def _json_payload(config_path: Path, hooks_path: Path, drift: list[str], changed: bool = False) -> str:
    return json.dumps({
        "config_path": str(config_path),
        "hooks_path": str(hooks_path),
        "model_catalog_path": str(MODEL_CATALOG_JSON),
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
    ap.add_argument("--check", action="store_true", help="verify live Codex config without writing")
    ap.add_argument("--json", action="store_true", help="emit machine-readable output")
    ap.add_argument("--config", default=str(CONFIG_PATH), help="Codex config.toml path")
    ap.add_argument("--hooks", default=str(LIVE_HOOKS_JSON), help="Codex hooks.json path")
    ap.add_argument("--project-root", default=str(PROJECT_ROOT), help="project root")
    ap.add_argument("--hooks-json", default=str(HOOKS_JSON), help="HME Codex hooks source")
    ap.add_argument("--no-backup", action="store_true", help="write without backups")
    args = ap.parse_args()

    config_path = Path(args.config).expanduser()
    hooks_path = Path(args.hooks).expanduser()
    project_root = Path(args.project_root).resolve()
    hooks_json = Path(args.hooks_json).resolve()
    try:
        port = _service_port()
        expected_hook_doc = expected_hooks(project_root=project_root, hooks_json=hooks_json)
        live_hook_doc = _load_live_hooks(hooks_path)
        live_config = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
        expected_config = expected_config_text(live_config, port=port)
    except Exception as e:
        drift = [str(e)]
        if args.json:
            print(_json_payload(config_path, hooks_path, drift))
        else:
            print(f"[no] {e}")
        return 1

    drift = []
    drift.extend(compare_hooks(live_hook_doc, expected_hook_doc))
    drift.extend(path_violations(expected_hook_doc))
    drift.extend(compare_model_catalog())
    drift.extend(compare_config(live_config, port=port))
    if args.check:
        if args.json:
            print(_json_payload(config_path, hooks_path, drift))
        elif drift:
            print(f"[no] {len(drift)} managed Codex settings drift(s):")
            for item in drift:
                print(f"  {item}")
        else:
            print(f"[ok] {config_path} and {hooks_path}: managed Codex hooks/provider match HME registries")
            for note in runtime_notes():
                print(f"[note] {note}")
        return 0 if not drift else 1

    changed_hooks = _write_with_backup(
        hooks_path,
        json.dumps(expected_hook_doc, indent=2) + "\n",
        no_backup=args.no_backup,
    )
    changed_config = _write_with_backup(config_path, expected_config, no_backup=args.no_backup)
    changed_catalog, catalog_stats = write_model_catalog()
    changed = changed_hooks or changed_config or changed_catalog

    if args.json:
        print(_json_payload(config_path, hooks_path, [], changed=changed))
    else:
        verb = "updated" if changed else "already current"
        print(f"[ok] Codex settings {verb}: {config_path}, {hooks_path}")
        print(
            "[ok] Codex model catalog "
            f"{'updated' if changed_catalog else 'already current'}: {MODEL_CATALOG_JSON} "
            f"({catalog_stats['models']} model(s), context={catalog_stats['context_window']})"
        )
        for note in runtime_notes():
            print(f"[note] {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
