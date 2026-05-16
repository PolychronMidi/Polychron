#!/usr/bin/env python3
"""~/.claude/settings.json validator.

Bug class this catches: when settings.json is malformed JSON (trailing
comma, unbalanced brace, missing quote), Claude Code silently disables
the entire hook config. NEXUS tracking, auto-completeness injection,
LIFESAVER watermark advance, and every PreToolUse/PostToolUse handler
all stop firing. The symptom ("my reviews and completeness checks
stopped") is far removed from the cause (one trailing comma), so it
takes 40+ minutes of debugging to trace back.

Scope:
  R1 -- settings.json parses as valid JSON
  R2 -- every hook/statusLine command path exists
  R3 -- every hook/statusLine command path is absolute
  R4 -- every lifecycle/tool hook routes through event_kernel/claude_adapter.js
  R5 -- statusLine routes through event_kernel/statusline.js
  R6 -- deleted bridge wrappers are not registered

Exit: 0 clean / 1 violation(s).

--json emits a payload the HCI verifier can consume.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

from claude_settings import (  # noqa: E402
    HOOKS_JSON,
    PROJECT_ROOT,
    SETTINGS_PATH,
    compare_managed,
    expected_settings,
    path_and_legacy_violations,
)


def _audit() -> list[str]:
    """Return list of human-readable violation messages."""
    if not SETTINGS_PATH.exists():
        return [f"{SETTINGS_PATH}: file not present (hooks will be default-off)"]
    raw = ""
    try:
        raw = SETTINGS_PATH.read_text(encoding="utf-8")
    except OSError as e:
        return [f"{SETTINGS_PATH}: read failed: {e}"]

    # R1 -- JSON parse
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        return [
            f"{SETTINGS_PATH}:{e.lineno}:{e.colno} -- invalid JSON: {e.msg} -- "
            f"Claude Code CANNOT load this file and will silently disable hooks + "
            f"user-level settings (alwaysThinkingEnabled, verbose, etc.). Fix the "
            f"syntax error to restore."
        ]

    if not isinstance(parsed, dict):
        return [f"{SETTINGS_PATH}: root must be a JSON object"]

    try:
        expected = expected_settings(project_root=PROJECT_ROOT, hooks_json=HOOKS_JSON)
    except Exception as e:
        return [str(e)]
    violations = compare_managed(parsed, expected)
    violations.extend(path_and_legacy_violations(parsed))
    return violations


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    violations = _audit()
    if args.json:
        print(json.dumps({
            "settings_path": str(SETTINGS_PATH),
            "violation_count": len(violations),
            "violations": violations,
        }, indent=2))
    else:
        if not violations:
            print(f"[ok] {SETTINGS_PATH}: valid JSON, event-kernel hooks installed, all commands resolve")
            return 0
        print(f"[no] {len(violations)} violation(s) in {SETTINGS_PATH}:")
        for v in violations:
            print(f"  {v}")
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
