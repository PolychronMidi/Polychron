"""NVIDIA NIM synthesis tier — free-tier cascade via integrate.api.nvidia.com.

190+ open-weight models. 8-tier cascade best-first.
    T1: deepseek-v3.2  T2: mistral-large-3-675b  T3: qwen3-coder-480b
    T4: glm5           T5: nemotron-ultra-253b    T6: devstral-2-123b
    T7: qwen3.5-397b   T8: llama-3.3-70b

Config: NVIDIA_API_KEY, NVIDIA_DAILY_LIMIT_*, NVIDIA_RPM_LIMIT_*
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider

_provider = OpenAIProvider(
    name="NVIDIA",
    env_key="NVIDIA_API_KEY",
    base_url="https://integrate.api.nvidia.com/v1/chat/completions",
    tiers=[
        ("T1", ENV.optional("NVIDIA_MODEL_T1", "deepseek-ai/deepseek-v3.2")),
        ("T2", ENV.optional("NVIDIA_MODEL_T2", "mistralai/mistral-large-3-675b-instruct-2512")),
        ("T3", ENV.optional("NVIDIA_MODEL_T3", "qwen/qwen3-coder-480b-a35b-instruct")),
        ("T4", ENV.optional("NVIDIA_MODEL_T4", "z-ai/glm5")),
        ("T5", ENV.optional("NVIDIA_MODEL_T5", "nvidia/llama-3.1-nemotron-ultra-253b-v1")),
        ("T6", ENV.optional("NVIDIA_MODEL_T6", "mistralai/devstral-2-123b-instruct-2512")),
        ("T7", ENV.optional("NVIDIA_MODEL_T7", "qwen/qwen3.5-397b-a17b")),
        ("T8", ENV.optional("NVIDIA_MODEL_T8", "meta/llama-3.3-70b-instruct")),
    ],
    timeout=90,
    default_daily=200_000,
    default_rpm=10,
)

cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
