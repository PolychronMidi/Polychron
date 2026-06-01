#!/usr/bin/env python3
"""Validate config/models.json provider routing claims.

Offline mode enforces pinned free catalogs. --live additionally checks current
OpenRouter and models.dev zero-price status.
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
MODELS_DEV_URL = "https://models.dev/api.json"
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
PINNED_KILO_GATEWAY_FREE = {
    "deepseek/deepseek-v4-flash:free",
    "google/lyria-3-clip-preview",
    "google/lyria-3-pro-preview",
    "kilo-auto/free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter/auto",
    "openrouter/free",
    "openrouter/owl-alpha",
    "openrouter/pareto-code",
    "stepfun/step-3.5-flash:free",
    "x-ai/grok-code-fast-1:optimized:free",
}
PINNED_AIHUBMIX_FREE = {
    "coding-glm-5.1-free",
    "coding-minimax-m2.7-free",
    "xiaomi-mimo-v2.5-free",
    "xiaomi-mimo-v2.5-pro-free",
}
PINNED_FREE_BY_PROVIDER = {
    "openrouter": PINNED_OPENROUTER_FREE,
    "kilo-gateway": PINNED_KILO_GATEWAY_FREE,
    "aihubmix": PINNED_AIHUBMIX_FREE,
}
LABEL_BY_PROVIDER = {
    "openrouter": "OpenRouter",
    "kilo-gateway": "Kilo Gateway",
    "aihubmix": "AIHubMix",
}
MODELS_DEV_PROVIDER_BY_REGISTRY = {
    "kilo-gateway": "kilo",
    "aihubmix": "aihubmix",
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


def catalog_provider(provider: str) -> str:
    return "kilo-gateway" if provider in {"kilo", "kilo-gateway"} else provider


def upstream_model(model: dict[str, Any]) -> str:
    raw = str(model.get("api_model") or model.get("id") or "").strip()
    if raw.endswith("-go") and not model.get("api_model"):
        raw = raw[:-3]
    return raw


def http_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "Polychron-HME/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if not isinstance(data, dict):
        raise ValueError(f"{url}: expected JSON object")
    return data


def live_openrouter_free_ids(url: str) -> set[str]:
    data = http_json(url)
    out: set[str] = set()
    for model in data.get("data") or []:
        pricing = model.get("pricing") or {}
        if pricing.get("prompt") == "0" and pricing.get("completion") == "0":
            mid = model.get("id")
            if isinstance(mid, str) and mid:
                out.add(mid)
    return out


def is_zero_cost(value: Any) -> bool:
    try:
        return float(value) == 0.0
    except (TypeError, ValueError):
        return False


def live_models_dev_free_ids(url: str, provider: str) -> set[str]:
    data = http_json(url)
    provider_data = data.get(provider) or {}
    out: set[str] = set()
    for mid, model in (provider_data.get("models") or {}).items():
        cost = model.get("cost") or {}
        if is_zero_cost(cost.get("input")) and is_zero_cost(cost.get("output")):
            if isinstance(mid, str) and mid:
                out.add(mid)
    return out


def live_free_catalogs(openrouter_url: str, models_dev_url: str) -> dict[str, set[str]]:
    catalogs = {"openrouter": live_openrouter_free_ids(openrouter_url)}
    for registry_provider, models_dev_provider in MODELS_DEV_PROVIDER_BY_REGISTRY.items():
        catalogs[registry_provider] = live_models_dev_free_ids(models_dev_url, models_dev_provider)
    return catalogs


def validate_provider_capabilities(cfg: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    caps = cfg.get("provider_capabilities")
    if not isinstance(caps, dict):
        return ["provider_capabilities: missing capability matrix"]
    for provider in PINNED_FREE_BY_PROVIDER:
        if not isinstance(caps.get(provider), dict):
            issues.append(f"provider_capabilities.{provider}: missing provider entry")
    for provider in ("kilo-gateway", "aihubmix"):
        cap = caps.get(provider) if isinstance(caps.get(provider), dict) else {}
        overrides = cap.get("request_overrides") if isinstance(cap, dict) else None
        if not isinstance(overrides, dict) or overrides.get("non_stream") is not True:
            issues.append(f"provider_capabilities.{provider}: request_overrides.non_stream must be true")
    return issues


def validate(cfg: dict[str, Any], *, free_by_provider: dict[str, set[str]]) -> list[str]:
    issues: list[str] = validate_provider_capabilities(cfg)
    seen: dict[tuple[str, str], str] = {}
    for tier, model in iter_models(cfg):
        mid = str(model.get("id") or "")
        label = f"{tier}:{mid or '<missing-id>'}"
        provider = catalog_provider(provider_name(model))
        upstream = upstream_model(model)
        if not mid:
            issues.append(f"{label}: missing id")
        if provider not in PINNED_FREE_BY_PROVIDER:
            continue
        provider_label = LABEL_BY_PROVIDER[provider]
        if not upstream:
            issues.append(f"{label}: {provider_label} model missing api_model/id")
            continue
        if provider == "openrouter" and "/" not in upstream:
            issues.append(f"{label}: OpenRouter upstream must be canonical, got {upstream!r}")
        key = (provider, upstream)
        prior = seen.get(key)
        if prior:
            issues.append(f"{label}: duplicates {provider_label} upstream {upstream} already at {prior}")
        seen[key] = label
        if model.get("cost") == "free":
            if model.get("cost_amt") not in (0, 0.0):
                issues.append(f"{label}: free {provider_label} cost_amt must be 0")
            if upstream not in free_by_provider.get(provider, set()):
                issues.append(f"{label}: {upstream} is not in the pinned {provider_label} free catalog")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", default=str(ROOT / "config" / "models.json"))
    ap.add_argument("--live", action="store_true", help="validate against live provider catalogs")
    ap.add_argument("--url", default=OPENROUTER_MODELS_URL, help="OpenRouter models URL")
    ap.add_argument("--models-dev-url", default=MODELS_DEV_URL)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    cfg = load_registry(Path(args.models))
    free_by_provider = live_free_catalogs(args.url, args.models_dev_url) if args.live else PINNED_FREE_BY_PROVIDER
    issues = validate(cfg, free_by_provider=free_by_provider)
    if args.json:
        print(json.dumps({"issue_count": len(issues), "issues": issues}, indent=2))
    elif issues:
        print(f"model_registry_issues={len(issues)}")
        for issue in issues:
            print(f"  {issue}")
    else:
        source = "live provider catalogs" if args.live else "pinned provider catalogs"
        print(f"model_registry=ok ({source})")
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
