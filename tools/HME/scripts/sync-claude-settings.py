#!/usr/bin/env python3
"""Sync live Claude Code settings from tools/HME/hooks/hooks.json."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

from claude_settings import (  # noqa: E402
    HOOKS_JSON,
    PROJECT_ROOT,
    SETTINGS_PATH,
    compare_managed,
    expected_settings,
    load_json,
    managed_settings,
    path_and_legacy_violations,
)


def _load_settings(path: Path) -> dict:
    if not path.exists():
        return {}
    data = load_json(path)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    return data


def _json_payload(path: Path, drift: list[str], changed: bool = False) -> str:
    return json.dumps({
        "settings_path": str(path),
        "drift_count": len(drift),
        "drift": drift,
        "changed": changed,
    }, indent=2)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify live settings match hooks.json without writing")
    ap.add_argument("--json", action="store_true", help="emit machine-readable output")
    ap.add_argument("--settings", default=str(SETTINGS_PATH), help="settings.json path")
    ap.add_argument("--project-root", default=str(PROJECT_ROOT), help="project root")
    ap.add_argument("--hooks-json", default=str(HOOKS_JSON), help="hooks.json source")
    ap.add_argument("--no-backup", action="store_true", help="write without a backup")
    args = ap.parse_args()

    settings_path = Path(args.settings).expanduser()
    project_root = Path(args.project_root).resolve()
    hooks_json = Path(args.hooks_json).resolve()

    try:
        live = _load_settings(settings_path)
        expected = expected_settings(project_root=project_root, hooks_json=hooks_json)
    except Exception as e:
        if args.json:
            print(json.dumps({
                "settings_path": str(settings_path),
                "drift_count": 1,
                "drift": [str(e)],
                "changed": False,
            }, indent=2))
        else:
            print(f"[no] {e}")
        return 1

    drift = compare_managed(live, expected)
    drift.extend(path_and_legacy_violations(expected))
    if args.check:
        if args.json:
            print(_json_payload(settings_path, drift))
        elif drift:
            print(f"[no] {len(drift)} managed Claude settings drift(s):")
            for item in drift:
                print(f"  {item}")
        else:
            print(f"[ok] {settings_path}: managed hooks match {hooks_json}")
        return 0 if not drift else 1

    updated = managed_settings(live, expected)
    changed = updated != live
    if changed:
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        if settings_path.exists() and not args.no_backup:
            backup = settings_path.with_name(
                f"{settings_path.name}.bak-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
            )
            backup.write_text(settings_path.read_text(encoding="utf-8"), encoding="utf-8")
        settings_path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(_json_payload(settings_path, [], changed=changed))
    else:
        verb = "updated" if changed else "already current"
        print(f"[ok] {settings_path}: {verb} from {hooks_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
