"""Claude Code settings materialization for HME hooks.

`tools/HME/hooks/hooks.json` is the source of truth. This module is shared by
the sync and audit CLIs so the expected live settings shape is not duplicated.
"""
from __future__ import annotations

import copy
import json
import os
import shlex
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[3]
HOOKS_JSON = PROJECT_ROOT / "tools" / "HME" / "hooks" / "hooks.json"
CODEX_EXTENSIONS_JSON = PROJECT_ROOT / "tools" / "HME" / "hooks" / "codex-extensions.json"
SETTINGS_PATH = Path.home() / ".claude" / "settings.json"
CODEX_SETTINGS_PATH = Path.home() / ".codex" / "hooks.json"
PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"
STATUSLINE_EVENT = "StatusLine"
REQUIRED_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
)
CODEX_MATCHER_STAR_EVENTS = ("PreToolUse", "PostToolUse", "PermissionRequest")
CODEX_ADAPTER_SUBSTITUTION = ("claude_adapter.js", "codex_adapter.js")
LEGACY_COMMAND_FRAGMENTS = (
    "_proxy_bridge.sh",
    "/hooks/statusline.sh",
    "direct_dispatch.sh",
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _expand_command(command: str, project_root: Path) -> str:
    plugin_root = project_root / "tools" / "HME"
    return command.replace(PLUGIN_ROOT_VAR, str(plugin_root))


def _expand_obj(value: Any, project_root: Path) -> Any:
    if isinstance(value, str):
        return _expand_command(value, project_root)
    if isinstance(value, list):
        return [_expand_obj(item, project_root) for item in value]
    if isinstance(value, dict):
        return {key: _expand_obj(item, project_root) for key, item in value.items()}
    return value


def expected_settings(
    project_root: Path = PROJECT_ROOT,
    hooks_json: Path = HOOKS_JSON,
) -> dict[str, Any]:
    manifest = load_json(hooks_json)
    hooks = manifest.get("hooks")
    if not isinstance(hooks, dict):
        raise ValueError(f"{hooks_json}: hooks must be an object")

    missing = [event for event in REQUIRED_EVENTS if event not in hooks]
    if missing:
        raise ValueError(f"{hooks_json}: missing required hook event(s): {', '.join(missing)}")
    if STATUSLINE_EVENT not in hooks:
        raise ValueError(f"{hooks_json}: missing {STATUSLINE_EVENT} hook")

    materialized: dict[str, Any] = {"hooks": {}}
    for event, groups in hooks.items():
        expanded = _expand_obj(copy.deepcopy(groups), project_root)
        if event == STATUSLINE_EVENT:
            materialized["statusLine"] = statusline_from_hook_groups(expanded)
        else:
            materialized["hooks"][event] = expanded
    return materialized


def statusline_from_hook_groups(groups: Any) -> dict[str, str]:
    if not isinstance(groups, list) or not groups:
        raise ValueError("StatusLine hook must contain at least one hook group")
    hook_list = groups[0].get("hooks") if isinstance(groups[0], dict) else None
    if not isinstance(hook_list, list) or not hook_list:
        raise ValueError("StatusLine hook group must contain at least one hook")
    hook = hook_list[0]
    if not isinstance(hook, dict):
        raise ValueError("StatusLine hook must be an object")
    command = hook.get("command")
    hook_type = hook.get("type", "command")
    if not command:
        raise ValueError("StatusLine hook command is missing")
    return {"type": hook_type, "command": command}


def managed_settings(base: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged["hooks"] = expected["hooks"]
    merged["statusLine"] = expected["statusLine"]
    return merged


def _codex_collapse_session_start(groups: list[Any]) -> list[Any]:
    if not isinstance(groups, list) or not groups:
        return groups
    first = copy.deepcopy(groups[0])
    if isinstance(first, dict):
        first.pop("matcher", None)
    return [first]


def _codex_swap_adapter(command: str) -> str:
    old, new = CODEX_ADAPTER_SUBSTITUTION
    return command.replace(old, new)


def _codex_project_event(event: str, groups: Any) -> Any:
    if not isinstance(groups, list):
        return groups
    out: list[Any] = []
    for group in groups:
        if not isinstance(group, dict):
            out.append(group)
            continue
        new_group: dict[str, Any] = {}
        if event in CODEX_MATCHER_STAR_EVENTS or "matcher" in group:
            new_group["matcher"] = "*"
        hooks_list = group.get("hooks", [])
        new_hooks: list[Any] = []
        if isinstance(hooks_list, list):
            for hook in hooks_list:
                if isinstance(hook, dict):
                    nh = dict(hook)
                    if isinstance(nh.get("command"), str):
                        nh["command"] = _codex_swap_adapter(nh["command"])
                    new_hooks.append(nh)
                else:
                    new_hooks.append(hook)
        new_group["hooks"] = new_hooks
        out.append(new_group)
    return out


def codex_expected_settings(
    project_root: Path = PROJECT_ROOT,
    hooks_json: Path = HOOKS_JSON,
    extensions_json: Path = CODEX_EXTENSIONS_JSON,
) -> dict[str, Any]:
    manifest = load_json(hooks_json)
    hooks = manifest.get("hooks")
    if not isinstance(hooks, dict):
        raise ValueError(f"{hooks_json}: hooks must be an object")

    missing = [event for event in REQUIRED_EVENTS if event not in hooks]
    if missing:
        raise ValueError(f"{hooks_json}: missing required hook event(s): {', '.join(missing)}")

    extensions: dict[str, Any] = {}
    if extensions_json.exists():
        ext_manifest = load_json(extensions_json)
        ext_hooks = ext_manifest.get("hooks") if isinstance(ext_manifest, dict) else None
        if ext_hooks is not None and not isinstance(ext_hooks, dict):
            raise ValueError(f"{extensions_json}: hooks must be an object")
        extensions = ext_hooks or {}

    overlap = set(extensions.keys()) & set(hooks.keys())
    if overlap:
        raise ValueError(
            f"{extensions_json}: extension events overlap canonical hooks.json: {sorted(overlap)}"
        )

    materialized: dict[str, Any] = {"hooks": {}}
    for event, groups in hooks.items():
        if event == STATUSLINE_EVENT:
            continue
        expanded = _expand_obj(copy.deepcopy(groups), project_root)
        if event == "SessionStart":
            expanded = _codex_collapse_session_start(expanded)
        materialized["hooks"][event] = _codex_project_event(event, expanded)
    for event, groups in extensions.items():
        expanded = _expand_obj(copy.deepcopy(groups), project_root)
        materialized["hooks"][event] = _codex_project_event(event, expanded)
    return materialized


def codex_managed_settings(base: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged["hooks"] = expected["hooks"]
    return merged


def codex_compare_managed(live: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    live_hooks = live.get("hooks")
    expected_hooks = expected.get("hooks")
    if live_hooks != expected_hooks:
        live_events = set(live_hooks.keys()) if isinstance(live_hooks, dict) else set()
        expected_events = set(expected_hooks.keys()) if isinstance(expected_hooks, dict) else set()
        for event in sorted(expected_events - live_events):
            violations.append(f"{event}: missing managed hook from live codex settings")
        for event in sorted(live_events - expected_events):
            violations.append(
                f"{event}: extra hook in live codex settings; "
                "edit hooks.json or codex-extensions.json instead"
            )
        for event in sorted(live_events & expected_events):
            if live_hooks[event] != expected_hooks[event]:
                violations.append(
                    f"{event}: live codex command differs from projected materialization"
                )
        if not isinstance(live_hooks, dict):
            violations.append(f"hooks: expected object, got {type(live_hooks).__name__}")
    return violations


def compare_managed(live: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    live_hooks = live.get("hooks")
    expected_hooks = expected.get("hooks")
    if live_hooks != expected_hooks:
        live_events = set(live_hooks.keys()) if isinstance(live_hooks, dict) else set()
        expected_events = set(expected_hooks.keys()) if isinstance(expected_hooks, dict) else set()
        for event in sorted(expected_events - live_events):
            violations.append(f"{event}: missing managed hook from live settings")
        for event in sorted(live_events - expected_events):
            violations.append(f"{event}: extra hook in live settings; edit hooks.json instead")
        for event in sorted(live_events & expected_events):
            if live_hooks[event] != expected_hooks[event]:
                violations.append(f"{event}: live command differs from hooks.json materialization")
        if not isinstance(live_hooks, dict):
            violations.append(f"hooks: expected object, got {type(live_hooks).__name__}")
    if live.get("statusLine") != expected.get("statusLine"):
        violations.append("statusLine: live command differs from hooks.json materialization")
    return violations


def command_path_violations(label: str, command: str) -> list[str]:
    violations: list[str] = []
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    for token in tokens:
        if "/" not in token:
            continue
        path = os.path.expandvars(os.path.expanduser(token))
        if not os.path.isabs(path):
            violations.append(f"{label}: command uses non-absolute path {path!r}")
        elif not os.path.exists(path):
            violations.append(f"{label}: command references missing path {path!r}")
    for fragment in LEGACY_COMMAND_FRAGMENTS:
        if fragment in command:
            violations.append(f"{label}: command references retired wrapper fragment {fragment!r}")
    return violations


def iter_managed_commands(settings: dict[str, Any]) -> list[tuple[str, str]]:
    commands: list[tuple[str, str]] = []
    hooks = settings.get("hooks")
    if isinstance(hooks, dict):
        for event, groups in hooks.items():
            if not isinstance(groups, list):
                continue
            for group in groups:
                hook_list = group.get("hooks", []) if isinstance(group, dict) else []
                if not isinstance(hook_list, list):
                    continue
                for hook in hook_list:
                    if isinstance(hook, dict) and hook.get("command"):
                        commands.append((event, str(hook["command"])))
    status = settings.get("statusLine")
    if isinstance(status, dict) and status.get("command"):
        commands.append(("statusLine", str(status["command"])))
    return commands


def path_and_legacy_violations(settings: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    for label, command in iter_managed_commands(settings):
        violations.extend(command_path_violations(label, command))
    return violations
