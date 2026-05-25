"""OpenCode settings materialization for HME provider ingress and hooks."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from claude_settings import HOOKS_JSON, PROJECT_ROOT

OPENCODE_CONFIG_PATH = Path(os.environ.get("OPENCODE_CONFIG") or Path.home() / ".config" / "opencode" / "opencode.jsonc")
PROVIDER_ID = "hme"
PROVIDER_NAME = "HME OpenAI-Compatible Proxy"
PROJECT_ROOT_VAR = "${HME_PROJECT_ROOT}"
PLUGIN_REL = Path("tools/HME/opencode/plugin/hme_hooks.js")


def plugin_spec(project_root: Path = PROJECT_ROOT) -> str:
    return (project_root / PLUGIN_REL).resolve().as_uri()


def strip_jsonc(text: str) -> str:
    out: list[str] = []
    i = 0
    quoted = False
    escaped = False
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if quoted:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                quoted = False
            i += 1
            continue
        if ch == '"':
            quoted = True
            out.append(ch)
            i += 1
            continue
        if ch == '/' and nxt == '/':
            while i < len(text) and text[i] not in '\r\n':
                i += 1
            continue
        if ch == '/' and nxt == '*':
            i += 2
            while i + 1 < len(text) and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def load_json(path: Path) -> Any:
    return json.loads(strip_jsonc(path.read_text(encoding="utf-8")))


def hme_base_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/v1"


def _model_rows(project_root: Path = PROJECT_ROOT) -> list[dict[str, Any]]:
    cfg = load_json(project_root / "config" / "models.json")
    skipped = set((cfg.get("providers_to_skip") or {}).get("providers") or [])
    rows: list[dict[str, Any]] = []
    for tier, spec in (cfg.get("tiers") or {}).items():
        for model in spec.get("models") or []:
            provider = str(model.get("provider") or "")
            if provider in skipped:
                continue
            if provider == "anthropic" and ("anthropic" in skipped or "claude" in skipped):
                continue
            if provider == "claude" and ("anthropic" in skipped or "claude" in skipped):
                continue
            model_id = str(model.get("id") or "")
            if not model_id:
                continue
            rows.append({
                "id": model_id,
                "name": model.get("name") or model_id,
                "provider": provider,
                "tier": tier,
                "context_length": model.get("context_length"),
                "max_output_tokens": model.get("max_output_tokens"),
            })
    return rows


def expected_provider(port: int, project_root: Path = PROJECT_ROOT) -> dict[str, Any]:
    models = {}
    for row in _model_rows(project_root):
        entry = {"name": row["name"]}
        if row.get("context_length"):
            entry["context"] = row["context_length"]
        if row.get("max_output_tokens"):
            entry["limit"] = {"output": row["max_output_tokens"]}
        models[row["id"]] = entry
    return {
        "npm": "@ai-sdk/openai-compatible",
        "name": PROVIDER_NAME,
        "options": {
            "baseURL": hme_base_url(port),
            "apiKey": "hme-local",
        },
        "models": models,
    }


def managed_config(base: dict[str, Any], port: int, project_root: Path = PROJECT_ROOT) -> dict[str, Any]:
    out = dict(base)
    out["$schema"] = out.get("$schema") or "https://opencode.ai/config.json"
    provider = dict(out.get("provider") or {})
    provider[PROVIDER_ID] = expected_provider(port, project_root)
    out["provider"] = provider
    plugins = list(out.get("plugin") or [])
    spec = plugin_spec(project_root)
    if spec not in plugins:
        plugins.append(spec)
    out["plugin"] = plugins
    return out


def compare_config(live: dict[str, Any], port: int, project_root: Path = PROJECT_ROOT) -> list[str]:
    expected = managed_config(live, port, project_root)
    live_provider = (live.get("provider") or {}).get(PROVIDER_ID) if isinstance(live.get("provider"), dict) else None
    expected_provider_doc = expected["provider"][PROVIDER_ID]
    if live_provider != expected_provider_doc:
        return [f"{OPENCODE_CONFIG_PATH}: provider.{PROVIDER_ID} differs from HME materialization"]
    return []


def path_violations(doc: dict[str, Any], port: int) -> list[str]:
    provider = (doc.get("provider") or {}).get(PROVIDER_ID) if isinstance(doc.get("provider"), dict) else None
    if not isinstance(provider, dict):
        return [f"provider.{PROVIDER_ID} missing"]
    base_url = ((provider.get("options") or {}).get("baseURL"))
    if base_url != hme_base_url(port):
        return [f"provider.{PROVIDER_ID}.options.baseURL must point at HME proxy ({hme_base_url(port)})"]
    return []


def runtime_notes() -> list[str]:
    return [
        "OpenCode model traffic shares HME's OpenAI-compatible ingress; OpenCode remains a distinct host for config/hooks/capabilities.",
        "Do not point OpenCode directly at external providers or OmniRoute; HME proxy remains the enforcement boundary.",
    ]
