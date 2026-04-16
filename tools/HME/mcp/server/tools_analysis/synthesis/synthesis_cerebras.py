"""Cerebras synthesis tier — Wafer-Scale Engine inference.

Free tier: 30 RPM, 1000 RPD, 1M tokens/day.
    T1: qwen-3-235b-a22b-instruct-2507 — 235B MoE, strongest on Cerebras
    T2: llama3.1-8b                      — fast 8B fallback

Config: CEREBRAS_API_KEY, CEREBRAS_RPM_LIMIT_*, CEREBRAS_DAILY_LIMIT_*
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider

_provider = OpenAIProvider(
    name="Cerebras",
    env_key="CEREBRAS_API_KEY",
    base_url="https://api.cerebras.ai/v1/chat/completions",
    tiers=[
        ("T1", ENV.optional("CEREBRAS_MODEL_T1", "qwen-3-235b-a22b-instruct-2507")),
        ("T2", ENV.optional("CEREBRAS_MODEL_T2", "llama3.1-8b")),
    ],
    timeout=60,
    default_daily=1_000_000,
    default_rpm=30,
)

cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
