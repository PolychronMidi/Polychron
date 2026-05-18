#!/usr/bin/env python3
"""Validate config/models.json provider routing claims.

Offline mode enforces pinned OpenRouter-free IDs. --live additionally checks
OpenRouter's current catalog and zero-price status.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
from jsonc import load_jsonc  # noqa: E402

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
PINNED_OPENROUTER_FREE = {
    "arcee-ai/trinity-large-thinking:free",
    "baidu/cobuddy:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    "deepseek/deepseek-v4-flash:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "google/lyria-3-clip-preview",
    "google/lyria-3-pro-preview",
    "liquid/lfm-2.5-1.2b-instruct:free",
    "liquid/lfm-2.5-1.2b-thinking:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "minimax/minimax-m2.5:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "openai/gpt-oss-120b:free",
    "openai/gpt-oss-20b:free",
    "openrouter/free",
    "openrouter/owl-alpha",
    "poolside/laguna-m.1:free",
    "poolside/laguna-xs.2:free",
    "qwen/qwen3-coder:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "z-ai/glm-4.5-air:free",
}


def load_registry(path: Path) -> dict[str, Any]:
    data = load_jsonc(path)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be an object")
    return data


def iter_models(cfg: dict[str, Any]):
    for tier_name, tier in (cfg.get("tiers") or {}).items():
        for model in (tier or {}).get("models") or []:
            if isinstance(model, dict):
                yield str(tier_name), model


def provider_name(model: dict[str, Any]) -> str:
    return str(model.get("provider") or "").replace("_", "-")


def upstream_model(model: dict[str, Any]) -> str:
    raw = str(model.get("api_model") or model.get("id") or "").strip()
    if raw.endswith("-go") and not model.get("api_model"):
        raw = raw[:-3]
    return raw


def live_free_ids(url: str) -> set[str]:
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.load(resp)
    out: set[str] = set()
    for model in data.get("data") or []:
        pricing = model.get("pricing") or {}
        if pricing.get("prompt") == "0" and pricing.get("completion") == "0":
            mid = model.get("id")
            if isinstance(mid, str) and mid:
                out.add(mid)
    return out


def validate(cfg: dict[str, Any], *, free_ids: set[str]) -> list[str]:
    issues: list[str] = []
    openrouter_seen: dict[str, str] = {}
    for tier, model in iter_models(cfg):
        mid = str(model.get("id") or "")
        label = f"{tier}:{mid or '<missing-id>'}"
        provider = provider_name(model)
        upstream = upstream_model(model)
        if not mid:
            issues.append(f"{label}: missing id")
        if provider != "openrouter":
            continue
        if not upstream:
            issues.append(f"{label}: openrouter model missing api_model/id")
            continue
        if "/" not in upstream:
            issues.append(f"{label}: openrouter upstream must be canonical, got {upstream!r}")
        prior = openrouter_seen.get(upstream)
        if prior:
            issues.append(f"{label}: duplicates openrouter upstream {upstream} already at {prior}")
        openrouter_seen[upstream] = label
        if model.get("cost") == "free":
            if model.get("cost_amt") not in (0, 0.0):
                issues.append(f"{label}: free openrouter cost_amt must be 0")
            if upstream not in free_ids:
                issues.append(f"{label}: {upstream} is not in the pinned OpenRouter free catalog")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", default=str(ROOT / "config" / "models.json"))
    ap.add_argument("--live", action="store_true", help="validate against OpenRouter live catalog")
    ap.add_argument("--url", default=OPENROUTER_MODELS_URL)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    cfg = load_registry(Path(args.models))
    free_ids = live_free_ids(args.url) if args.live else PINNED_OPENROUTER_FREE
    issues = validate(cfg, free_ids=free_ids)
    if args.json:
        print(json.dumps({"issue_count": len(issues), "issues": issues}, indent=2))
    elif issues:
        print(f"model_registry_issues={len(issues)}")
        for issue in issues:
            print(f"  {issue}")
    else:
        source = "live OpenRouter catalog" if args.live else "pinned OpenRouter free catalog"
        print(f"model_registry=ok ({source})")
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
