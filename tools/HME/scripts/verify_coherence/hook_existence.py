"""Hook command existence verifier.

Confirms every hook command path declared in ~/.claude/settings.json
resolves to an existing, executable file. Catches the failure class
where a typo in settings.json silently disables the hook — Claude Code
doesn't surface "script not found"; bash errors, hook never runs,
operator never knows.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class HookCommandExistenceVerifier(Verifier):
    """Every hook command path declared in ~/.claude/settings.json
    must resolve to an existing, executable file. Typos in the hook path
    make Claude Code silently invoke a nonexistent script — bash errors,
    Claude Code ignores the error, and the hook quietly does nothing.

    Specifically tracks the `bash <path> <args>` pattern used throughout
    the Polychron hook configuration. Non-bash hooks are reported as
    SKIP so this verifier doesn't flag unrelated tools."""
    name = "hook-command-existence"
    category = "state"
    weight = 1.5

    def run(self) -> VerdictResult:
        settings_path = os.path.expanduser("~/.claude/settings.json")
        if not os.path.isfile(settings_path):
            return _result(SKIP, 1.0, "no ~/.claude/settings.json")
        try:
            with open(settings_path) as f:
                settings = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return _result(ERROR, 0.0, f"settings.json unreadable: {e}")

        # Explicit key check — fail-fast if the schema diverges rather
        # than silently defaulting to an empty dict.
        hooks = settings.get("hooks")
        if hooks is None:
            return _result(SKIP, 1.0, "no 'hooks' key in settings.json")
        if not hooks:
            return _result(SKIP, 1.0, "no hooks declared in settings.json")
        if not isinstance(hooks, dict):
            return _result(ERROR, 0.0,
                           f"settings.json 'hooks' is {type(hooks).__name__}, expected dict")

        checked = 0
        missing = []
        not_executable = []
        for event, groups in hooks.items():
            # Claude Code schema: groups is a list. If not, that's a real
            # configuration error, not something to silently paper over.
            if not isinstance(groups, list):
                return _result(ERROR, 0.0,
                               f"settings.json hooks[{event!r}] is {type(groups).__name__}, expected list")
            for group in groups:
                group_hooks = group.get("hooks")
                if group_hooks is None:
                    continue
                if not isinstance(group_hooks, list):
                    return _result(ERROR, 0.0,
                                   f"settings.json hooks[{event!r}][].hooks is {type(group_hooks).__name__}, expected list")
                for h in group_hooks:
                    cmd_raw = h.get("command")
                    if cmd_raw is None:
                        continue
                    cmd = cmd_raw.strip()
                    if not cmd:
                        continue
                    # Match the `bash <script> <args>` pattern.
                    tokens = cmd.split()
                    if len(tokens) < 2 or tokens[0] != "bash":
                        # Non-bash hook — not in scope for this check.
                        continue
                    script = tokens[1]
                    checked += 1
                    if not os.path.isfile(script):
                        missing.append(f"{event}: {script}")
                    elif not os.access(script, os.X_OK):
                        # bash can still invoke it via explicit `bash`, so
                        # non-executable is only a warning.
                        not_executable.append(f"{event}: {script}")

        if checked == 0:
            return _result(SKIP, 1.0, "no bash-invoked hooks to check")
        if missing:
            score = max(0.0, 1.0 - len(missing) / checked)
            return _result(FAIL, score,
                           f"{len(missing)}/{checked} hook script(s) missing",
                           missing + not_executable)
        if not_executable:
            return _result(WARN, 0.9,
                           f"{len(not_executable)}/{checked} hook script(s) not marked executable",
                           not_executable)
        return _result(PASS, 1.0, f"all {checked} bash-hook scripts present")


