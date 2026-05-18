#!/usr/bin/env python3
"""Sync per-model token limits in config/models.json from OmniRoute /v1/models.

Synced fields per model (when the catalog provides positive ints):
  - context_length
  - max_input_tokens
  - max_output_tokens

Always retires the deprecated ``max_context`` field if present.

JSONC-aware: the file may contain ``//`` and ``/* */`` comments. Edits are
performed surgically per-model block so all comments outside model bodies are
preserved verbatim.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jsonc import loads_jsonc  # noqa: E402


def _fetch_catalog(port: str) -> dict:
    url = f"http://127.0.0.1:{port}/v1/models"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


def _catalog_index(catalog: dict) -> dict:
    out: dict = {}
    for model in catalog.get("data") or []:
        ids = [model.get("id"), model.get("root"), model.get("parent")]
        owned_by = model.get("owned_by")
        root = model.get("root")
        if owned_by and root:
            ids.append(f"{owned_by}/{root}")
            ids.append(root.split("/")[-1])
        for mid in ids:
            if mid:
                out[mid] = model
    return out


PROVIDER_ALIASES = {
    "nvidia-ngc": ["nvidia"],
    "gemini": ["google"],
}


MODEL_ALIASES = {
    "mimo-v2-pro": ["mimo-v2.5-pro"],
    "mimo-v2-omni": ["mimo-v2.5"],
    "nemotron-3-super": ["nemotron-3-super-120b-a12b"],
    "gemini-3-flash": ["gemini-3.1-flash-image-preview"],
    "llama-3.3-70b-instruct": ["llama-3.3-70b-versatile"],
    "llama-4-maverick": ["llama-4-maverick-17b-128e-instruct"],
    "llama-4-scout-17b-16e-instruct": ["llama-4-maverick-17b-128e-instruct"],
    "qwen3-32b": ["qwen/qwen3-32b"],
    "llama3.1-8b": ["gpt-oss-120b"],
    "nemotron-super-49b": ["nemotron-3-super-120b-a12b"],
}


SYNC_KEYS = ("context_length", "max_input_tokens", "max_output_tokens")
DEFAULT_OUTPUT = 8192
RETIRED_KEYS = ("max_context",)


def _candidates(model: dict) -> list[str]:
    mid = model.get("id", "")
    api_model = model.get("api_model", "")
    provider = model.get("provider", "")
    raw = mid[:-3] if mid.endswith("-go") else mid
    raws = [raw] + MODEL_ALIASES.get(raw, [])
    if api_model and api_model not in raws:
        raws.insert(0, api_model)
    providers = [provider] + PROVIDER_ALIASES.get(provider, [])
    vals = [mid]
    if api_model:
        vals.append(api_model)
    for item in raws:
        vals.append(item)
        for prov in providers:
            if prov:
                vals.append(f"{prov}/{item}")
    return vals


def _desired_limits(model: dict, catalog_hit: dict | None) -> dict[str, int]:
    out: dict[str, int] = {}
    if catalog_hit:
        for key in SYNC_KEYS:
            val = catalog_hit.get(key)
            if isinstance(val, int) and val > 0:
                out[key] = val
    if "max_output_tokens" not in out:
        out["max_output_tokens"] = DEFAULT_OUTPUT
    return out


def _enclosing_object_span(text: str, target: int) -> tuple[int, int] | None:
    """Return ``(open, close)`` for the JSON object containing ``target``."""
    stack: list[int] = []
    in_str = False
    esc = False
    for i in range(target):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append(i)
        elif ch == "}" and stack:
            stack.pop()
    if not stack:
        return None
    start = stack[-1]
    depth = 0
    in_str = False
    esc = False
    for j in range(start, len(text)):
        ch = text[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return (start, j)
    return None


def _find_all_blocks_for_id(text: str, model_id: str) -> list[tuple[int, int]]:
    """Return spans for every block whose ``"id"`` matches ``model_id``."""
    pat = re.compile(rf'"id"\s*:\s*"{re.escape(model_id)}"')
    spans: list[tuple[int, int]] = []
    seen: set[int] = set()
    for m in pat.finditer(text):
        span = _enclosing_object_span(text, m.start())
        if span and span[0] not in seen:
            spans.append(span)
            seen.add(span[0])
    return spans


def _detect_field_indent(block: str) -> str:
    m = re.search(r'^([ \t]+)"[^"]+"\s*:', block, re.MULTILINE)
    return m.group(1) if m else "          "


def _remove_field_line(block: str, key: str) -> str:
    pat = re.compile(
        rf'^[ \t]*"{re.escape(key)}"\s*:\s*[^\n]*?\s*,?[ \t]*\n',
        re.MULTILINE,
    )
    return pat.sub("", block, count=1)


def _set_field(block: str, key: str, val: int) -> tuple[str, bool]:
    val_str = str(val)
    pat = re.compile(
        rf'(?P<head>^(?P<indent>[ \t]*)"{re.escape(key)}"\s*:\s*)'
        rf'(?P<val>[^,\n}}]+?)'
        rf'(?P<gap>[ \t]*)'
        rf'(?P<comma>,?)'
        rf'(?P<tail>[ \t]*)$',
        re.MULTILINE,
    )
    m = pat.search(block)
    if m:
        new_line = f'{m.group("head")}{val_str}{m.group("comma")}{m.group("tail")}'
        if new_line == m.group(0):
            return block, False
        return block[: m.start()] + new_line + block[m.end():], True

    close_idx = block.rfind("}")
    if close_idx < 0:
        return block, False
    indent = _detect_field_indent(block)
    head = block[:close_idx].rstrip()
    if not head.endswith(","):
        head = head + ","
    line_start = block.rfind("\n", 0, close_idx) + 1
    close_indent = block[line_start:close_idx]
    tail = block[close_idx:]
    return f'{head}\n{indent}"{key}": {val_str}\n{close_indent}{tail}', True


def patch_text(
    text: str,
    model_id: str,
    limits: dict[str, int],
    *,
    retire_keys: tuple[str, ...] = RETIRED_KEYS,
) -> tuple[str, list[str]]:
    span = _find_block_for_id(text, model_id)
    if not span:
        return text, []
    start, end = span
    block = text[start : end + 1]
    notes: list[str] = []
    new_block = block
    for retired in retire_keys:
        if re.search(rf'"{re.escape(retired)}"\s*:', new_block):
            new_block = _remove_field_line(new_block, retired)
            notes.append(f"-{retired}")
    for key, val in limits.items():
        new_block, changed = _set_field(new_block, key, val)
        if changed:
            notes.append(f"{key}={val}")
    if new_block == block:
        return text, []
    return text[:start] + new_block + text[end + 1 :], notes


def sync(path: Path, catalog: dict, *, dry_run: bool) -> int:
    text = path.read_text(encoding="utf-8")
    cfg = loads_jsonc(text)
    idx = _catalog_index(catalog)
    changed_models = 0
    for tier_name, tier in (cfg.get("tiers") or {}).items():
        for model in tier.get("models") or []:
            mid = model.get("id")
            if not mid:
                continue
            hit = next((idx[c] for c in _candidates(model) if c in idx), None)
            limits = _desired_limits(model, hit)
            new_text, notes = patch_text(text, mid, limits)
            if not notes:
                continue
            changed_models += 1
            verb = "would change" if dry_run else "changed"
            print(f"{verb} {mid} ({tier_name}): {', '.join(notes)}")
            text = new_text
    if changed_models and not dry_run:
        # Sanity check: re-parse via JSONC before writing.
        loads_jsonc(text)
        path.write_text(text, encoding="utf-8")
    return changed_models


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "HME" / "scripts"))
    from service_registry import service_map, service_port  # noqa: E402

    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="config/models.json")
    ap.add_argument("--port", default=str(service_port(service_map()["omniroute"])))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = Path(args.models)
    catalog = _fetch_catalog(args.port)
    changed = sync(path, catalog, dry_run=args.dry_run)
    print(f"models_limit_fields_changed={changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
