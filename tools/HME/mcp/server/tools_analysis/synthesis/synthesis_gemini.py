"""Gemini synthesis tiers — free-tier cascade, best quality first.

Free tier cascade (Google AI Studio free, 15 RPM, ~1M tok/day per model):
    T1: gemini-3-flash-preview   — newest, strongest free flash
    T2: gemini-flash-latest      — floating alias to current flagship flash
    T3: gemini-2.5-flash         — stable 2.5 flash
    T4: gemini-2.0-flash         — older overflow
    T5: gemini-2.5-flash-lite    — lite fallback

Config: GEMINI_API_KEY, GEMINI_DAILY_LIMIT_*, GEMINI_RPM_LIMIT_*
"""
from hme_env import ENV
from .synthesis_provider_base import OpenAIProvider, GROUNDING_HEADER


class _GeminiProvider(OpenAIProvider):
    """Google Gemini — overrides request format, URL, auth, and response parsing."""

    def _build_request_body(self, model, prompt, system, max_tokens, temperature):
        full_system = GROUNDING_HEADER + ("\n\n" + system if system else "")
        return {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": full_system}]},
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }

    def _build_url(self, model):
        return f"{self.base_url}/{model}:generateContent?key={self._api_key()}"

    def _build_auth_header(self):
        return {}  # Gemini uses query-param auth, not header

    def _parse_response(self, data):
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        return "".join(
            p.get("text", "")
            for p in candidates[0].get("content", {}).get("parts", [])
        ).strip() or None


_provider = _GeminiProvider(
    name="Gemini",
    env_key="GEMINI_API_KEY",
    base_url="https://generativelanguage.googleapis.com/v1beta/models",
    tiers=[
        ("T1", ENV.optional("GEMINI_MODEL_T1", "gemini-3-flash-preview")),
        ("T2", ENV.optional("GEMINI_MODEL_T2", "gemini-flash-latest")),
        ("T3", ENV.optional("GEMINI_MODEL_T3", "gemini-2.5-flash")),
        ("T4", ENV.optional("GEMINI_MODEL_T4", "gemini-2.0-flash")),
        ("T5", ENV.optional("GEMINI_MODEL_T5", "gemini-2.5-flash-lite")),
    ],
    timeout=60,
    default_daily=900_000,
    default_rpm=14,
)

cascade = _provider.cascade
available = _provider.available
get_quota_status = _provider.get_quota_status
