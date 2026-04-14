"""Reasoning tier dispatcher — global quality-ranked cascade across all providers.

Rather than iterating provider-by-provider (which would call a weak Gemini lite
model before a strong Groq model), this module holds a single absolute ranking
of (provider, model) pairs sorted by quality, and walks it in order.

Each entry consults its provider's quota/RPM/circuit before firing. Providers
still manage their own rate-limit state — we just change iteration order from
provider-first to quality-first.

Ranking (strongest → weakest):
     1. OpenRouter  deepseek/deepseek-r1:free             — full R1, top open reasoning
     2. Cerebras    qwen-3-235b-a22b-instruct-2507        — 235B MoE, wafer-scale fast
     3. Groq        openai/gpt-oss-120b                   — 120B OpenAI-open, Groq flagship free
     4. Cerebras    gpt-oss-120b                          — same weights, separate free pool
     5. Mistral     mistral-large-latest                  — flagship Mistral, 1B tok/month pool
     6. Groq        moonshotai/kimi-k2-instruct-0905      — Kimi K2, 262k context
     7. Cerebras    llama-3.3-70b                         — Meta 70B on Cerebras
     8. Gemini      gemini-3-flash-preview                — newest Gemini 3 flash
     9. Z.ai        glm-4.7-flash                         — newest GLM free flash
    10. Gemini      gemini-flash-latest                   — floating alias
    11. Mistral     codestral-latest                      — code specialist
    12. Groq        llama-3.3-70b-versatile               — Meta 70B, fast on Groq
    13. Cerebras    qwen-3-32b                            — Qwen 32B fallback
    14. OpenRouter  meta-llama/llama-3.3-70b-instruct:free — same weights, slower host
    15. Z.ai        glm-4.5-flash                         — older GLM free fallback
    16. Gemini      gemini-2.5-flash                      — solid workhorse
    17. Gemini      gemini-2.0-flash                      — older 2.x
    18. Gemini      gemini-2.5-flash-lite                 — lite, last before local

Local qwen3-coder:30b-a3b is the final fallback handled by the caller.
"""
import logging
import os
import time

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
    except Exception:
        env_path = os.path.join(os.environ.get("PROJECT_ROOT", ""), ".env")
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
_RANKING: list[tuple[str, str]] = [
    ("openrouter", "deepseek/deepseek-r1:free"),
    ("cerebras",   "qwen-3-235b-a22b-instruct-2507"),
    ("groq",       "openai/gpt-oss-120b"),
    ("cerebras",   "gpt-oss-120b"),
    ("mistral",    "mistral-large-latest"),
    ("groq",       "moonshotai/kimi-k2-instruct-0905"),
    ("cerebras",   "llama-3.3-70b"),
    ("gemini",     "gemini-3-flash-preview"),
    ("zai",        "glm-4.7-flash"),
    ("gemini",     "gemini-flash-latest"),
    ("mistral",    "codestral-latest"),
    ("groq",       "llama-3.3-70b-versatile"),
    ("cerebras",   "qwen-3-32b"),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct:free"),
    ("zai",        "glm-4.5-flash"),
    ("gemini",     "gemini-2.5-flash"),
    ("gemini",     "gemini-2.0-flash"),
    ("gemini",     "gemini-2.5-flash-lite"),
]


def _load_providers():
    """Lazy-load provider modules so this file has no import-time deps."""
    from . import (
        synthesis_gemini, synthesis_groq, synthesis_openrouter,
        synthesis_zai, synthesis_cerebras, synthesis_mistral,
    )
    return {
        "gemini":     synthesis_gemini,
        "groq":       synthesis_groq,
        "openrouter": synthesis_openrouter,
        "zai":        synthesis_zai,
        "cerebras":   synthesis_cerebras,
        "mistral":    synthesis_mistral,
    }


def get_ranking() -> list[tuple[str, str]]:
    """Return the active ranked list, allowing env overrides in the future."""
    return list(_RANKING)


def available() -> bool:
    """True if any ranked (provider, model) pair is reachable right now."""
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception:
        return False
    for provider_key, model in _RANKING:
        mod = providers.get(provider_key)
        if mod is None:
            continue
        try:
            if _model_available(mod, provider_key, model):
                return True
        except Exception:
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
    except Exception:
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
        except Exception:
            return False

    # gemini / groq: find the tier matching `model` and check it directly.
    try:
        for tier in mod._TIERS:
            if tier.model == model:
                return mod._quota_ok(tier) and mod._cb_allow(tier)
    except Exception:
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
         temperature: float = 0.3) -> str | None:
    """Walk the global ranking best→worst, returning the first successful result.

    Returns None only when every ranked slot is exhausted — caller falls back
    to local qwen3:30b-a3b.
    """
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception as e:
        logger.warning(f"reasoning dispatcher: provider load failed: {e}")
        return None

    for provider_key, model in _RANKING:
        mod = providers.get(provider_key)
        if mod is None:
            continue
        if not _model_available(mod, provider_key, model):
            continue
        result = _call_specific(mod, provider_key, model, prompt, system, max_tokens, temperature)
        if result:
            logger.info(f"reasoning: {provider_key}/{model} ({len(result)}c)")
            return result

    return None


def get_status() -> list[dict]:
    """Return the ranking annotated with current availability, for status display."""
    _refresh_env()
    try:
        providers = _load_providers()
    except Exception:
        return []
    out = []
    for i, (provider_key, model) in enumerate(_RANKING, start=1):
        mod = providers.get(provider_key)
        if mod is None:
            out.append({"rank": i, "provider": provider_key, "model": model, "available": False, "reason": "no module"})
            continue
        try:
            ok = _model_available(mod, provider_key, model)
            out.append({"rank": i, "provider": provider_key, "model": model, "available": ok})
        except Exception as e:
            out.append({"rank": i, "provider": provider_key, "model": model, "available": False, "reason": str(e)[:40]})
    return out
