#!/usr/bin/env python3
"""Validate model registry provider claims that cannot be inferred from shape."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
from jsonc import load_jsonc  # noqa: E402

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Pinned from OpenRouter /api/v1/models, 2026-05-18. Use --live to recheck.
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


def iter_models(cfg: dict):
    for tier_name, tier in (cfg.get("tiers") or {}).items():
        for model in tier.get("models") or []:
            if isinstance(model, dict):
                yield tier_name, model


def upstream_id(model: dict) -> str:
    return str(model.get("api_model") or model.get("id") or "").strip()


def fetch_openrouter_free() -> set[str]:
    with urllib.request.urlopen(OPENROUTER_MODELS_URL, timeout=20) as resp:
        payload = json.loads(resp.read())
    free: set[str] = set()
    for item in payload.get("data") or []:
        pricing = item.get("pricing") or {}
        if pricing.get("prompt") == "0" and pricing.get("completion") == "0":
            mid = item.get("id")
            if isinstance(mid, str) and mid:
                free.add(mid)
    return free


def validate(cfg: dict, free_ids: set[str]) -> list[str]:
    issues: list[str] = []
    seen: dict[tuple[str, str, str], str] = {}
    all_ids: dict[str, list[str]] = {}

    for tier, model in iter_models(cfg):
        mid = str(model.get("id") or "").strip()
        provider = str(model.get("provider") or "").strip()
        upstream = upstream_id(model)
        loc = f"{tier}:{mid or '<missing-id>'}"
        if not mid:
            issues.append(f"{loc}: missing id")
            continue
        all_ids.setdefault(mid, []).append(loc)
        key = (tier, provider, upstream)
        if key in seen:
            issues.append(f"{loc}: duplicates upstream route {provider}/{upstream} already at {seen[key]}")
        else:
            seen[key] = loc

        if provider != "openrouter":
            continue
        if not upstream or "/" not in upstream:
            issues.append(f"{loc}: openrouter route must use canonical api_model/id, got {upstream!r}")
        if model.get("cost") == "free":
            if model.get("cost_amt") != 0:
                issues.append(f"{loc}: free OpenRouter model must have cost_amt 0")
            if upstream not in free_ids:
                issues.append(f"{loc}: {upstream!r} is not in the OpenRouter free catalog")

    for mid, locs in all_ids.items():
        if len(locs) > 1:
            joined = ", ".join(locs)
            issues.append(f"duplicate registry id {mid!r}: {joined}")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", default=str(ROOT / "config" / "models.json"))
    ap.add_argument("--live", action="store_true", help="fetch OpenRouter catalog instead of pinned set")
    args = ap.parse_args()

    cfg = load_jsonc(Path(args.models))
    free_ids = fetch_openrouter_free() if args.live else PINNED_OPENROUTER_FREE
    issues = validate(cfg, free_ids)
    if issues:
        print(f"model_registry_issues={len(issues)}")
        for issue in issues:
            print(f"  {issue}")
        return 1
    source = "live" if args.live else "pinned"
    print(f"model_registry=ok openrouter_free_source={source} openrouter_free_count={len(free_ids)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
