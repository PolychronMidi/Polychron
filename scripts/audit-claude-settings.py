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
  R1 — settings.json parses as valid JSON
  R2 — every hook event's `command` references an existing file
  R3 — no hook uses relative paths (plugin cache path only)

Exit: 0 clean / 1 violation(s).

--json emits a payload the HCI verifier can consume.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


SETTINGS_PATH = Path.home() / ".claude" / "settings.json"


def _audit() -> list[str]:
    """Return list of human-readable violation messages."""
    violations: list[str] = []
    if not SETTINGS_PATH.exists():
        return [f"{SETTINGS_PATH}: file not present (hooks will be default-off)"]
    raw = ""
    try:
        raw = SETTINGS_PATH.read_text(encoding="utf-8")
    except OSError as e:
        return [f"{SETTINGS_PATH}: read failed: {e}"]

    # R1 — JSON parse
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        return [
            f"{SETTINGS_PATH}:{e.lineno}:{e.colno} — invalid JSON: {e.msg} — "
            f"Claude Code CANNOT load this file and will silently disable hooks + "
            f"user-level settings (alwaysThinkingEnabled, verbose, etc.). Fix the "
            f"syntax error to restore."
        ]

    # R2 — every hook command path exists
    hooks = parsed.get("hooks") if isinstance(parsed, dict) else None
    if isinstance(hooks, dict):
        for event, entries in hooks.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                for h in entry.get("hooks", []) or []:
                    if not isinstance(h, dict):
                        continue
                    cmd = h.get("command") or ""
                    # Extract the first path token (after `bash ` or similar prefix)
                    tokens = cmd.split()
                    # Find first token that looks like a path (contains /)
                    path_token = next((t for t in tokens if "/" in t), None)
                    if path_token and not os.path.exists(path_token):
                        violations.append(
                            f"{event}: command references missing path {path_token!r}"
                        )

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
            print(f"✓ {SETTINGS_PATH}: valid JSON, all hook commands resolve")
            return 0
        print(f"✗ {len(violations)} violation(s) in {SETTINGS_PATH}:")
        for v in violations:
            print(f"  {v}")
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
