"""OpenRouter synthesis tier — free :free-suffix models via OpenAI-compatible endpoint.

OpenRouter aggregates providers; ":free" models are rate-limited by RPD
(200 requests/day shared across all tiers), not by tokens.

    T1: deepseek/deepseek-r1:free           — DeepSeek R1 (free)
    T2: meta-llama/llama-3.3-70b-instruct:free — Meta 70B (free)

Config: OPENROUTER_API_KEY, OPENROUTER_RPD_LIMIT
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider

_provider = OpenAIProvider(
    name="OpenRouter",
    env_key="OPENROUTER_API_KEY",
    base_url="https://openrouter.ai/api/v1/chat/completions",
    tiers=[
        ("T1", ENV.optional("OPENROUTER_MODEL_T1", "deepseek/deepseek-r1:free")),
        ("T2", ENV.optional("OPENROUTER_MODEL_T2", "meta-llama/llama-3.3-70b-instruct:free")),
    ],
    timeout=60,
    default_rpd=ENV.optional_int("OPENROUTER_RPD_LIMIT", 200),
    default_rpm=10,
    uses_rpd=True,
)

cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
