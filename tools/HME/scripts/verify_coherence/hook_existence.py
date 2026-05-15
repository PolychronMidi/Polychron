"""Hook command existence verifier.

Confirms every hook command path declared in ~/.claude/settings.json
resolves to an existing, executable file. Catches the failure class
where a typo in settings.json silently disables the hook -- Claude Code
doesn't surface "script not found"; bash errors, hook never runs,
operator never knows.
"""
from __future__ import annotations

import json
import os
import re
import shlex
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
    make Claude Code silently invoke a nonexistent script -- bash errors,
    Claude Code ignores the error, and the hook quietly does nothing.

    Tracks path references in any hook command shape (`node <path>`,
    `bash <path>`, or an absolute executable path)."""
    name = "hook-command-existence"
    category = "state"
    subtag = "structural-integrity"
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

        # Explicit key check -- fail-fast if the schema diverges rather
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
        relative = []
        not_executable = []

        def command_paths(cmd: str) -> list[str]:
            try:
                tokens = shlex.split(cmd)
            except ValueError:
                tokens = cmd.split()
            return [os.path.expandvars(os.path.expanduser(t)) for t in tokens if "/" in t]

        def check_command(label: str, cmd_raw: str) -> None:
            nonlocal checked
            cmd = cmd_raw.strip()
            if not cmd:
                return
            try:
                tokens = shlex.split(cmd)
            except ValueError:
                tokens = cmd.split()
            paths = command_paths(cmd)
            for script in paths:
                checked += 1
                if not os.path.isabs(script):
                    relative.append(f"{label}: {script}")
                elif not os.path.isfile(script):
                    missing.append(f"{label}: {script}")
            if tokens and "/" in tokens[0]:
                command = os.path.expandvars(os.path.expanduser(tokens[0]))
                if os.path.isfile(command) and not os.access(command, os.X_OK):
                    not_executable.append(f"{label}: {command}")

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
                    check_command(event, cmd_raw)

        status_line = settings.get("statusLine")
        if isinstance(status_line, dict) and status_line.get("command"):
            check_command("statusLine", status_line["command"])

        if checked == 0:
            return _result(SKIP, 1.0, "no hook command path references to check")
        if relative:
            score = max(0.0, 1.0 - len(relative) / checked)
            return _result(FAIL, score,
                           f"{len(relative)}/{checked} hook path(s) are relative",
                           relative + missing + not_executable)
        if missing:
            score = max(0.0, 1.0 - len(missing) / checked)
            return _result(FAIL, score,
                           f"{len(missing)}/{checked} hook path(s) missing",
                           missing + not_executable)
        if not_executable:
            return _result(WARN, 0.9,
                           f"{len(not_executable)}/{checked} hook command(s) not marked executable",
                           not_executable)
        return _result(PASS, 1.0, f"all {checked} hook command path(s) present")

