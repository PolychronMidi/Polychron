"""Mistral La Plateforme synthesis tier — free Experiment tier cascade.

1B tokens/month across all models. 6-tier cascade best-first.
    T1: magistral-medium-latest    T2: mistral-large-latest
    T3: devstral-medium-latest     T4: codestral-latest
    T5: mistral-medium-latest      T6: magistral-small-latest

Config: MISTRAL_API_KEY, MISTRAL_DAILY_LIMIT_*, MISTRAL_RPM_LIMIT_*
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider

_provider = OpenAIProvider(
    name="Mistral",
    env_key="MISTRAL_API_KEY",
    base_url="https://api.mistral.ai/v1/chat/completions",
    tiers=[
        ("T1", ENV.optional("MISTRAL_MODEL_T1", "magistral-medium-latest")),
        ("T2", ENV.optional("MISTRAL_MODEL_T2", "mistral-large-latest")),
        ("T3", ENV.optional("MISTRAL_MODEL_T3", "devstral-medium-latest")),
        ("T4", ENV.optional("MISTRAL_MODEL_T4", "codestral-latest")),
        ("T5", ENV.optional("MISTRAL_MODEL_T5", "mistral-medium-latest")),
        ("T6", ENV.optional("MISTRAL_MODEL_T6", "magistral-small-latest")),
    ],
    timeout=60,
    default_daily=200_000,
    default_rpm=6,
)

cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
