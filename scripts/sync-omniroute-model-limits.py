#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path


def _fetch_catalog(port: str) -> dict:
    url = f"http://127.0.0.1:{port}/v1/models"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


def _catalog_index(catalog: dict) -> dict:
    out = {}
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


def _candidates(model: dict) -> list[str]:
    mid = model.get("id", "")
    provider = model.get("provider", "")
    raw = mid[:-3] if mid.endswith("-go") else mid
    raws = [raw] + MODEL_ALIASES.get(raw, [])
    providers = [provider] + PROVIDER_ALIASES.get(provider, [])
    vals = [mid]
    for item in raws:
        vals.append(item)
        for prov in providers:
            if prov:
                vals.append(f"{prov}/{item}")
    return vals


def sync(path: Path, catalog: dict, dry_run: bool) -> int:
    cfg = json.loads(path.read_text())
    idx = _catalog_index(catalog)
    changed = 0
    for tier in (cfg.get("tiers") or {}).values():
        for model in tier.get("models") or []:
            hit = next((idx[c] for c in _candidates(model) if c in idx), None)
            if not hit:
                continue
            mapping = {
                "context_length": hit.get("context_length"),
                "max_output_tokens": hit.get("max_output_tokens"),
            }
            for key, val in mapping.items():
                if not isinstance(val, int) or val <= 0:
                    continue
                if model.get(key) == val:
                    continue
                model[key] = val
                changed += 1
    if changed and not dry_run:
        path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="config/models.json")
    ap.add_argument("--port", default=os.environ.get("HME_OMNIROUTE_PORT", "20128"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = Path(args.models)
    catalog = _fetch_catalog(args.port)
    changed = sync(path, catalog, args.dry_run)
    print(f"models_limit_fields_changed={changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
