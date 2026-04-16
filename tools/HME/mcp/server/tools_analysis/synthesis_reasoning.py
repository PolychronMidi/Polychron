"""Reasoning/coder tier dispatcher — two quality-ranked cascades across providers.

Two profiles — callers pass `profile="reasoning"` (default) or `profile="coder"`.
Each profile has its own ordered (provider, model) list so reasoning fallbacks
pick reasoning-strong models and coder fallbacks pick code-strong models.

Both rankings share the same provider modules and quota pools — splitting the
order only changes which slot fires first, not which free tiers are consumed.

profile="reasoning" — general analysis, architecture, deep think:
     1. nvidia     deepseek-ai/deepseek-v3.2              full DeepSeek V3.2
     2. nvidia     mistralai/mistral-large-3-675b-...     675B Mistral Large 3
     3. openrouter deepseek/deepseek-r1:free              R1 reasoning
     4. nvidia     nvidia/llama-3.1-nemotron-ultra-253b   253B Nemotron Ultra
     5. nvidia     qwen/qwen3.5-397b-a17b                 397B Qwen 3.5
     6. cerebras   qwen-3-235b-a22b-instruct-2507         235B, wafer-scale fast
     7. mistral    magistral-medium-latest                Mistral reasoning
     8. nvidia     z-ai/glm5                              GLM-5 (paywalled elsewhere)
     9. groq       openai/gpt-oss-120b                    120B OpenAI-open
    10. mistral    mistral-large-latest                   Mistral general flagship
    11. groq       moonshotai/kimi-k2-instruct-0905       Kimi K2
    12. nvidia     meta/llama-3.3-70b-instruct            Meta 70B on NVIDIA
    13. gemini     gemini-3-flash-preview                 newest Gemini flash
    14. gemini     gemini-flash-latest                    floating alias
    15. mistral    mistral-medium-latest                  smaller general
    16. groq       llama-3.3-70b-versatile                Meta 70B on Groq
    17. openrouter meta-llama/llama-3.3-70b-instruct:free slower 70B host
    18. mistral    magistral-small-latest                 small reasoning
    19. gemini     gemini-2.5-flash                       workhorse
    20. gemini     gemini-2.0-flash                       older 2.x
    21. cerebras   llama3.1-8b                            weak fallback
    22. gemini     gemini-2.5-flash-lite                  last before local

profile="coder" — structural code extraction, verified facts, file-aware work:
     1. nvidia     qwen/qwen3-coder-480b-a35b-instruct    480B Qwen3 coder flagship
     2. nvidia     mistralai/devstral-2-123b-instruct     123B agentic coder
     3. nvidia     deepseek-ai/deepseek-v3.2              strong all-round coder
     4. groq       openai/gpt-oss-120b                    strong code + fast
     5. nvidia     mistralai/mistral-large-3-675b-...     675B Mistral Large 3
     6. cerebras   qwen-3-235b-a22b-instruct-2507         235B, great on code
     7. nvidia     z-ai/glm5                              GLM-5 (strong on SWE-Bench)
     8. mistral    devstral-medium-latest                 agentic coder (Mistral direct)
     9. mistral    codestral-latest                       code completion specialist
    10. groq       moonshotai/kimi-k2-instruct-0905       Kimi K2
    11. openrouter deepseek/deepseek-r1:free              R1 (also good at code)
    12. nvidia     meta/llama-3.3-70b-instruct            Meta 70B on NVIDIA
    13. gemini     gemini-3-flash-preview                 Gemini 3
    14. mistral    mistral-large-latest                   flagship general
    15. gemini     gemini-flash-latest                    floating alias
    16. groq       llama-3.3-70b-versatile                Meta 70B on Groq
    17. openrouter meta-llama/llama-3.3-70b-instruct:free slower 70B
    18. mistral    mistral-medium-latest                  medium general
    19. gemini     gemini-2.5-flash                       workhorse
    20. gemini     gemini-2.0-flash                       older 2.x
    21. cerebras   llama3.1-8b                            weak fallback
    22. gemini     gemini-2.5-flash-lite                  last before local

Reasoning models (magistral-*, deepseek-r1) are demoted on the coder profile
because they waste output tokens on chain-of-thought that then gets discarded
when the caller only wants file paths and function names.

Z.ai provider omitted: all GLM models on z.ai are paywalled despite "free tier"
marketing — API returns "insufficient balance" on every request.

Local qwen3-coder:30b-a3b is the final fallback handled by the caller.
"""
import logging
import os
import sys
import time

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.reasoning")

_ENV_REFRESH_INTERVAL = 60  # re-read .env at most once per minute
_env_last_refresh = 0.0


def _refresh_env() -> None:
    """Re-parse project .env so keys added mid-session take effect without
    restarting the MCP server. Throttled to once per minute to keep cost ~0."""
    global _env_last_refresh
    now = time.monotonic()
    if now - _env_last_refresh < _ENV_REFRESH_INTERVAL:
        return
    _env_last_refresh = now
    try:
        from server import context as _ctx
        env_path = os.path.join(_ctx.PROJECT_ROOT, ".env")
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_reasoning.py:88: {type(_err).__name__}: {_err}")
        env_path = os.path.join(ENV.optional("PROJECT_ROOT", ""), ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and val:
                    os.environ[key] = val  # always refresh (don't gate on existing)
    except Exception as e:
        logger.warning(f"reasoning env refresh failed: {e}")


# (provider_key, model_id) in absolute quality order.
# provider_key must match a key in _PROVIDERS below.
_RANKING_REASONING: list[tuple[str, str]] = [
    ("nvidia",     "deepseek-ai/deepseek-v3.2"),
    ("nvidia",     "mistralai/mistral-large-3-675b-instruct-2512"),
    ("openrouter", "deepseek/deepseek-r1:free"),
    ("nvidia",     "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
    ("nvidia",     "qwen/qwen3.5-397b-a17b"),
    ("cerebras",   "qwen-3-235b-a22b-instruct-2507"),
    ("mistral",    "magistral-medium-latest"),
    ("nvidia",     "z-ai/glm5"),
    ("groq",       "openai/gpt-oss-120b"),
    ("mistral",    "mistral-large-latest"),
    ("groq",       "moonshotai/kimi-k2-instruct-0905"),
    ("nvidia",     "meta/llama-3.3-70b-instruct"),
    ("gemini",     "gemini-3-flash-preview"),
    ("gemini",     "gemini-flash-latest"),
    ("mistral",    "mistral-medium-latest"),
    ("groq",       "llama-3.3-70b-versatile"),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct:free"),
    ("mistral",    "magistral-small-latest"),
    ("gemini",     "gemini-2.5-flash"),
    ("gemini",     "gemini-2.0-flash"),
    ("cerebras",   "llama3.1-8b"),
    ("gemini",     "gemini-2.5-flash-lite"),
]

_RANKING_CODER: list[tuple[str, str]] = [
    ("nvidia",     "qwen/qwen3-coder-480b-a35b-instruct"),
    ("nvidia",     "mistralai/devstral-2-123b-instruct-2512"),
    ("nvidia",     "deepseek-ai/deepseek-v3.2"),
    ("groq",       "openai/gpt-oss-120b"),
    ("nvidia",     "mistralai/mistral-large-3-675b-instruct-2512"),
    ("cerebras",   "qwen-3-235b-a22b-instruct-2507"),
    ("nvidia",     "z-ai/glm5"),
    ("mistral",    "devstral-medium-latest"),
    ("mistral",    "codestral-latest"),
    ("groq",       "moonshotai/kimi-k2-instruct-0905"),
    ("openrouter", "deepseek/deepseek-r1:free"),
    ("nvidia",     "meta/llama-3.3-70b-instruct"),
    ("gemini",     "gemini-3-flash-preview"),
    ("mistral",    "mistral-large-latest"),
    ("gemini",     "gemini-flash-latest"),
    ("groq",       "llama-3.3-70b-versatile"),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct:free"),
    ("mistral",    "mistral-medium-latest"),
    ("gemini",     "gemini-2.5-flash"),
    ("gemini",     "gemini-2.0-flash"),
    ("cerebras",   "llama3.1-8b"),
    ("gemini",     "gemini-2.5-flash-lite"),
]

_RANKINGS = {
    "reasoning": _RANKING_REASONING,
    "coder":     _RANKING_CODER,
}


def _load_providers():
    """Lazy-load provider modules so this file has no import-time deps."""
    from . import (
        synthesis_gemini, synthesis_groq, synthesis_openrouter,
        synthesis_cerebras, synthesis_mistral, synthesis_nvidia,
    )
    return {
        "gemini":     synthesis_gemini,
        "groq":       synthesis_groq,
        "openrouter": synthesis_openrouter,
        "cerebras":   synthesis_cerebras,
        "mistral":    synthesis_mistral,
        "nvidia":     synthesis_nvidia,
    }


def get_ranking(profile: str = "reasoning") -> list[tuple[str, str]]:
    """Return the active ranked list for the given profile ('reasoning' or 'coder')."""
    return list(_RANKINGS.get(profile, _RANKING_REASONING))


def available(profile: str = "reasoning") -> bool:
    """True if any ranked (provider, model) pair is reachable right now."""
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_reasoning.py:191: {type(_err).__name__}: {_err}")
        return False
    ranking = _RANKINGS.get(profile, _RANKING_REASONING)
    for provider_key, model in ranking:
        mod = providers.get(provider_key)
        if mod is None:
            continue
        try:
            if _model_available(mod, provider_key, model):
                return True
        except Exception as _err:
            logger.debug(f"unnamed-except synthesis_reasoning.py:201: {type(_err).__name__}: {_err}")
            continue
    return False


def _model_available(mod, provider_key: str, model: str) -> bool:
    """Check whether a specific ranked (provider, model) pair is reachable.

    Each provider module exposes `available()` (any tier up) plus internal tier
    state; we inspect that state to check this specific model slot.
    """
    # First the cheap check: is the provider even keyed and any tier up?
    try:
        if not mod.available():
            return False
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_reasoning.py:216: {type(_err).__name__}: {_err}")
        return False

    if provider_key == "openrouter":
        # OR has a single shared RPD counter; any model is "available" if quota OK
        # and that model's tier circuit breaker is open.
        try:
            if not mod._quota_ok():
                return False
            if model == mod._MODEL_T1:
                return mod._cb_allow("T1")
            if model == mod._MODEL_T2:
                return mod._cb_allow("T2")
            return False
        except Exception as _err:
            logger.debug(f"unnamed-except synthesis_reasoning.py:230: {type(_err).__name__}: {_err}")
            return False

    # gemini / groq: find the tier matching `model` and check it directly.
    try:
        for tier in mod._TIERS:
            if tier.model == model:
                return mod._quota_ok(tier) and mod._cb_allow(tier)
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_reasoning.py:238: {type(_err).__name__}: {_err}")
        return False
    return False


def _call_specific(mod, provider_key: str, model: str, prompt: str,
                   system: str, max_tokens: int, temperature: float) -> str | None:
    """Invoke one specific (provider, model) slot directly, bypassing the
    provider's own internal cascade. Returns None on any failure — caller
    continues down the global ranking.
    """
    if provider_key == "openrouter":
        # OpenRouter's `call()` walks its internal T1→T2. To target a specific
        # model we temporarily patch _MODEL_T1 so that the loop hits our model
        # first. This is safe under the provider's _quota_lock.
        try:
            with mod._quota_lock:
                saved_t1, saved_t2 = mod._MODEL_T1, mod._MODEL_T2
                mod._MODEL_T1 = model
                mod._MODEL_T2 = model  # second try same model to exhaust the slot
            try:
                return mod.call(prompt, system=system, max_tokens=max_tokens, temperature=temperature)
            finally:
                with mod._quota_lock:
                    mod._MODEL_T1, mod._MODEL_T2 = saved_t1, saved_t2
        except Exception as e:
            logger.warning(f"openrouter {model} dispatch error: {type(e).__name__}: {e}")
            return None

    # gemini / groq: call the specific tier directly by invoking the low-level
    # _call_model() with that provider's quota/RPM/CB wrappers.
    try:
        tier = None
        for t in mod._TIERS:
            if t.model == model:
                tier = t
                break
        if tier is None:
            return None
        if not mod._quota_ok(tier) or not mod._cb_allow(tier):
            return None
        mod._rpm_wait(tier)
        try:
            text = mod._call_model(tier.model, prompt, system, max_tokens, temperature)
            if text:
                # Both providers track usage slightly differently; prefer the
                # module's own recorder if present.
                if hasattr(mod, "_record_usage"):
                    mod._record_usage(tier, 500 + max_tokens)
                elif hasattr(mod, "_record_request"):
                    mod._record_request(tier)
                mod._cb_success(tier)
                return text
            mod._cb_failure(tier)
            return None
        except Exception as e:
            # HTTP 429 → burn the tier for today
            import urllib.error
            if isinstance(e, urllib.error.HTTPError) and e.code == 429:
                with mod._quota_lock:
                    if hasattr(tier, "daily_limit"):
                        tier.tokens_used = tier.daily_limit
                    elif hasattr(tier, "rpd_limit"):
                        tier.requests_today = tier.rpd_limit
                logger.info(f"{provider_key} {model} 429 — marking exhausted")
                return None
            mod._cb_failure(tier)
            logger.info(f"{provider_key} {model} failed: {type(e).__name__}")
            return None
    except Exception as e:
        logger.warning(f"{provider_key} {model} dispatch error: {type(e).__name__}: {e}")
        return None


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3, profile: str = "reasoning") -> str | None:
    """Walk the ranking for the given profile best→worst, returning the first success.

    profile='reasoning' (default) — deep think, architecture, analysis.
    profile='coder'                — structural code extraction, verified facts.

    Returns None only when every ranked slot is exhausted — caller falls back
    to local qwen3-coder:30b-a3b.
    """
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception as e:
        logger.warning(f"reasoning dispatcher: provider load failed: {e}")
        return None

    ranking = _RANKINGS.get(profile, _RANKING_REASONING)
    for provider_key, model in ranking:
        mod = providers.get(provider_key)
        if mod is None:
            continue
        if not _model_available(mod, provider_key, model):
            continue
        result = _call_specific(mod, provider_key, model, prompt, system, max_tokens, temperature)
        if result:
            logger.info(f"{profile}: {provider_key}/{model} ({len(result)}c)")
            return result

    return None


def get_status(profile: str = "reasoning") -> list[dict]:
    """Return the ranking annotated with current availability, for status display."""
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_reasoning.py:349: {type(_err).__name__}: {_err}")
        return []
    ranking = _RANKINGS.get(profile, _RANKING_REASONING)
    out = []
    for i, (provider_key, model) in enumerate(ranking, start=1):
        mod = providers.get(provider_key)
        if mod is None:
            out.append({"rank": i, "provider": provider_key, "model": model, "available": False, "reason": "no module", "profile": profile})
            continue
        try:
            ok = _model_available(mod, provider_key, model)
            out.append({"rank": i, "provider": provider_key, "model": model, "available": ok, "profile": profile})
        except Exception as e:
            out.append({"rank": i, "provider": provider_key, "model": model, "available": False, "reason": str(e)[:40], "profile": profile})
    return out
