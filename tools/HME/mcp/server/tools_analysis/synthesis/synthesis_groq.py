"""Groq synthesis tier — free-tier cascade via Groq's OpenAI-compatible endpoint.

Groq's custom silicon runs large open-weight models at extreme speed. Free tier
is throttled by RPM / RPD (requests per minute / day), NOT by token count.

Free tier cascade (best-first):
    T1: openai/gpt-oss-120b             — 120B OpenAI-open, strongest reasoning
    T2: moonshotai/kimi-k2-instruct-0905 — Moonshot K2, 262k context
    T3: llama-3.3-70b-versatile          — Meta 70B general fallback

Config: GROQ_API_KEY, GROQ_RPM_LIMIT_*, GROQ_RPD_LIMIT_*
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider

_provider = OpenAIProvider(
    name="Groq",
    env_key="GROQ_API_KEY",
    base_url="https://api.groq.com/openai/v1/chat/completions",
    tiers=[
        ("T1", ENV.optional("GROQ_MODEL_T1", "openai/gpt-oss-120b")),
        ("T2", ENV.optional("GROQ_MODEL_T2", "moonshotai/kimi-k2-instruct-0905")),
        ("T3", ENV.optional("GROQ_MODEL_T3", "llama-3.3-70b-versatile")),
    ],
    timeout=60,
    default_rpm=30,
    default_rpd=1000,
    uses_rpd=True,
)

# Module-level API (backward compat)
cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
