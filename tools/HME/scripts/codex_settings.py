"""Codex CLI settings materialization for HME hooks and Responses proxy."""
from __future__ import annotations

import copy
import json
import os
import re
import shlex
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[3]
CODEX_HOME = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
CONFIG_PATH = CODEX_HOME / "config.toml"
CODEX_MODELS_CACHE_JSON = CODEX_HOME / "models_cache.json"
HOOKS_JSON = PROJECT_ROOT / "tools" / "HME" / "hooks" / "codex_hooks.json"
LIVE_HOOKS_JSON = CODEX_HOME / "hooks.json"
CANONICAL_SYSTEM_PROMPT = PROJECT_ROOT / "doc" / "templates" / "canonical-system-prompt.md"
AGENTS_MD = PROJECT_ROOT / "doc" / "templates" / "AGENTS.md"
MODEL_CATALOG_JSON = PROJECT_ROOT / "runtime" / "hme" / "codex-model-catalog.json"
PROJECT_ROOT_VAR = "${HME_PROJECT_ROOT}"
PROVIDER_ID = "hme_codex"
CODEX_CONTEXT_WINDOW = int(os.environ.get("HME_CODEX_CONTEXT_WINDOW", "900000")) #reduced from 105000 due to context overload
REQUIRED_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
)
HOOK_REVIEW_NOTE = (
    "Codex user hooks from ~/.codex/hooks.json are non-managed hooks; "
    "open /hooks in interactive Codex if Codex reports review is required. "
    "The hme_codex provider proxy is still active for non-interactive traffic."
)
MODEL_CATALOG_NOTE = (
    "HME generates tools/HME/runtime/codex-model-catalog.json from Codex's live "
    "models_cache.json; do not edit ~/.codex/models_cache.json directly."
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _required_text(path: Path, label: str) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ValueError(f"{label} missing or unreadable: {path}: {e}") from e
    if not text.strip():
        raise ValueError(f"{label} is empty: {path}")
    return text


def _json_string(value: str | Path) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _expand_obj(value: Any, project_root: Path) -> Any:
    if isinstance(value, str):
        return value.replace(PROJECT_ROOT_VAR, str(project_root))
    if isinstance(value, list):
        return [_expand_obj(item, project_root) for item in value]
    if isinstance(value, dict):
        return {key: _expand_obj(item, project_root) for key, item in value.items()}
    return value


def expected_hooks(
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
    return {"hooks": _expand_obj(copy.deepcopy(hooks), project_root)}


def codex_proxy_base_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/v1"


def expected_provider_toml(port: int) -> str:
    return "\n".join([
        f"[model_providers.{PROVIDER_ID}]",
        'name = "HME Codex Proxy"',
        f'base_url = "{codex_proxy_base_url(port)}"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
    ])


_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def _section_name(raw: str) -> str:
    return ".".join(part.strip().strip('"').strip("'") for part in raw.split("."))


def _root_section_end(lines: list[str]) -> int:
    for i, line in enumerate(lines):
        if _SECTION_RE.match(line):
            return i
    return len(lines)


def _remove_provider_section(lines: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(lines):
        match = _SECTION_RE.match(lines[i])
        if match and _section_name(match.group(1)) == f"model_providers.{PROVIDER_ID}":
            i += 1
            while i < len(lines) and not _SECTION_RE.match(lines[i]):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return out


def _remove_root_keys(lines: list[str], keys: set[str]) -> list[str]:
    root_end = _root_section_end(lines)
    out: list[str] = []
    for i, line in enumerate(lines):
        if i < root_end and any(re.match(rf"^\s*{re.escape(key)}\s*=", line) for key in keys):
            continue
        out.append(line)
    return out


def _set_root_key(lines: list[str], key: str, value: str) -> list[str]:
    root_end = _root_section_end(lines)
    out: list[str] = []
    replaced = False
    for i, line in enumerate(lines):
        if i < root_end and re.match(rf"^\s*{re.escape(key)}\s*=", line):
            if not replaced:
                out.append(f"{key} = {value}")
                replaced = True
            continue
        out.append(line)
    if not replaced:
        root_end = _root_section_end(out)
        insert_at = root_end
        while insert_at > 0 and out[insert_at - 1].strip() == "":
            insert_at -= 1
        out.insert(insert_at, f"{key} = {value}")
    return out


def _set_section_key(lines: list[str], section: str, key: str, value: str) -> list[str]:
    start = None
    end = None
    for i, line in enumerate(lines):
        match = _SECTION_RE.match(line)
        if not match:
            continue
        name = _section_name(match.group(1))
        if name == section:
            start = i
            end = len(lines)
            for j in range(i + 1, len(lines)):
                if _SECTION_RE.match(lines[j]):
                    end = j
                    break
            break
    if start is None:
        suffix = ["", f"[{section}]", f"{key} = {value}"]
        return lines + suffix
    out: list[str] = []
    replaced = False
    for i, line in enumerate(lines):
        if start < i < end and re.match(rf"^\s*{re.escape(key)}\s*=", line):
            if not replaced:
                out.append(f"{key} = {value}")
                replaced = True
            continue
        out.append(line)
    if not replaced:
        out.insert(end, f"{key} = {value}")
    return out


def expected_config_text(existing: str, *, port: int) -> str:
    lines = existing.splitlines()
    lines = _remove_provider_section(lines)
    lines = _remove_root_keys(lines, {"model_instructions_file", "experimental_instructions_file"})
    lines = _set_root_key(lines, "model_provider", f'"{PROVIDER_ID}"')
    lines = _set_root_key(lines, "model_catalog_json", _json_string(MODEL_CATALOG_JSON))
    lines = _set_root_key(lines, "model_context_window", str(CODEX_CONTEXT_WINDOW))
    lines = _set_section_key(lines, "features", "hooks", "true")
    text = "\n".join(lines).rstrip()
    return f"{text}\n\n{expected_provider_toml(port)}"


def compare_hooks(live: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    return [] if live == expected else ["~/.codex/hooks.json differs from tools/HME/hooks/codex_hooks.json materialization"]


def compare_config(live_text: str, *, port: int) -> list[str]:
    expected = expected_config_text(live_text, port=port)
    return [] if live_text.rstrip() == expected.rstrip() else [
        "~/.codex/config.toml missing HME Codex provider, model catalog, context window, or hooks"
    ]


def expected_model_catalog(
    *,
    source_path: Path = CODEX_MODELS_CACHE_JSON,
    canonical_path: Path = CANONICAL_SYSTEM_PROMPT,
    agents_path: Path = AGENTS_MD,
    context_window: int = CODEX_CONTEXT_WINDOW,
) -> tuple[dict[str, Any], dict[str, int]]:
    try:
        source = load_json(source_path)
    except Exception as e:
        raise ValueError(f"failed to read Codex model cache {source_path}: {e}") from e
    if not isinstance(source, dict):
        raise ValueError(f"{source_path}: root must be an object")
    source_models = source.get("models")
    if not isinstance(source_models, list) or not source_models:
        raise ValueError(f"{source_path}: models must be a non-empty array")
    models = copy.deepcopy(source_models)
    catalog = {"models": models}

    canonical = _required_text(canonical_path, "canonical system prompt")
    agents = _required_text(agents_path, "doc/templates/AGENTS.md")
    stats = {
        "models": len(models),
        "base_instructions": 0,
        "instructions_template": 0,
        "personality_pragmatic": 0,
        "context_window": 0,
        "max_context_window": 0,
    }
    for model in models:
        if not isinstance(model, dict):
            continue
        if "base_instructions" in model:
            model["base_instructions"] = canonical
            stats["base_instructions"] += 1
        messages = model.get("model_messages")
        if isinstance(messages, dict):
            if "instructions_template" in messages:
                messages["instructions_template"] = canonical
                stats["instructions_template"] += 1
            variables = messages.get("instructions_variables")
            if isinstance(variables, dict) and "personality_pragmatic" in variables:
                variables["personality_pragmatic"] = agents
                stats["personality_pragmatic"] += 1
        if "context_window" in model:
            model["context_window"] = context_window
            stats["context_window"] += 1
        if "max_context_window" in model:
            model["max_context_window"] = context_window
            stats["max_context_window"] += 1

    for key in ("base_instructions", "instructions_template", "personality_pragmatic"):
        if stats[key] == 0:
            raise ValueError(f"{source_path}: no {key} fields found to replace")
    return catalog, stats


def expected_model_catalog_text() -> tuple[str, dict[str, int]]:
    catalog, stats = expected_model_catalog()
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    return text, stats


def write_model_catalog(path: Path = MODEL_CATALOG_JSON) -> tuple[bool, dict[str, int]]:
    text, stats = expected_model_catalog_text()
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    if current == text:
        return False, stats
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True, stats


def compare_model_catalog(path: Path = MODEL_CATALOG_JSON) -> list[str]:
    try:
        expected, _stats = expected_model_catalog_text()
    except Exception as e:
        return [str(e)]
    if not path.exists():
        return [f"{path}: generated model catalog missing"]
    try:
        current = path.read_text(encoding="utf-8")
    except OSError as e:
        return [f"{path}: unreadable: {e}"]
    if current.rstrip() != expected.rstrip():
        return [f"{path}: generated model catalog does not match Codex cache + HME replacements"]
    return []


def iter_commands(hooks_doc: dict[str, Any]) -> list[tuple[str, str]]:
    commands: list[tuple[str, str]] = []
    hooks = hooks_doc.get("hooks")
    if not isinstance(hooks, dict):
        return commands
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            hook_list = group.get("hooks", []) if isinstance(group, dict) else []
            if not isinstance(hook_list, list):
                continue
            for hook in hook_list:
                if isinstance(hook, dict) and hook.get("command"):
                    commands.append((str(event), str(hook["command"])))
    return commands


def path_violations(hooks_doc: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    for event, command in iter_commands(hooks_doc):
        try:
            tokens = shlex.split(command)
        except ValueError:
            tokens = command.split()
        for token in tokens:
            if "/" not in token:
                continue
            path = os.path.expandvars(os.path.expanduser(token))
            if not os.path.isabs(path):
                violations.append(f"{event}: command uses non-absolute path {path!r}")
            elif not os.path.exists(path):
                violations.append(f"{event}: command references missing path {path!r}")
        if "claude_adapter.js" in command:
            violations.append(f"{event}: Codex hook points at claude_adapter.js")
    return violations


def runtime_notes() -> list[str]:
    return [HOOK_REVIEW_NOTE, MODEL_CATALOG_NOTE]
