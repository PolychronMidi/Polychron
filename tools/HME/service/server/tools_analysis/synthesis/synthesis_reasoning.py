"""Reasoning/coder tier dispatcher -- two quality-ranked cascades across providers.

Two profiles -- callers pass `profile="reasoning"` (default) or `profile="coder"`.
Each profile has its own ordered (provider, model) list so reasoning fallbacks
pick reasoning-strong models and coder fallbacks pick code-strong models.

Both rankings share the same provider modules and quota pools -- splitting the
order only changes which slot fires first, not which free tiers are consumed.

profile="reasoning" -- general analysis, architecture, deep think:
     1. nvidia     deepseek-ai/deepseek-v4-pro            full DeepSeek V4 Pro
     2. nvidia     deepseek-ai/deepseek-v4-flash          DeepSeek V4 Flash
     3. nvidia     mistralai/mistral-large-3-675b-...     675B Mistral Large 3
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

profile="coder" -- structural code extraction, verified facts, file-aware work:
     1. nvidia     qwen/qwen3-coder-480b-a35b-instruct    480B Qwen3 coder flagship
     2. nvidia     mistralai/devstral-2-123b-instruct     123B agentic coder
     3. nvidia     deepseek-ai/deepseek-v4-pro            strong all-round coder
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
marketing -- API returns "insufficient balance" on every request.

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
from common import maybe_trim_append as _maybe_trim_activity_log  # noqa: E402

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
    ENV.load(force=True)


# (provider_key, model_id) in absolute quality order.
# provider_key must match a key in _PROVIDERS below.
_RANKING_REASONING: list[tuple[str, str]] = [
    ("nvidia",     "deepseek-ai/deepseek-v4-pro"),
    ("nvidia",     "deepseek-ai/deepseek-v4-flash"),
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
    ("nvidia",     "deepseek-ai/deepseek-v4-pro"),
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
    """Lazy-load provider modules. Each exposes a _provider (OpenAIProvider instance)."""
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


def _get_provider_obj(mod):
    """Get the OpenAIProvider instance from a provider module."""
    return getattr(mod, '_provider', None)


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
    """Check whether a specific ranked (provider, model) pair is reachable."""
    prov = _get_provider_obj(mod)
    if prov:
        return prov.model_available(model)
    # Legacy fallback for modules without _provider
    try:
        return mod.available()
    except Exception as _e:
        logger.debug(f"legacy mod.available() {provider_key}:{model}: {type(_e).__name__}: {_e}")
        return False


def _call_specific(mod, provider_key: str, model: str, prompt: str,
                   system: str, max_tokens: int, temperature: float) -> str | None:
    """Invoke one specific (provider, model) slot directly via the unified interface."""
    prov = _get_provider_obj(mod)
    if prov:
        return prov.call_specific(model, prompt, system, max_tokens, temperature)
    # Legacy fallback: use module-level cascade (less targeted but functional)
    try:
        return mod.cascade(prompt, system=system, max_tokens=max_tokens, temperature=temperature)
    except Exception as e:
        logger.warning(f"{provider_key} {model} dispatch error: {type(e).__name__}: {e}")
        return None


# Overdrive defaults: 64k thinking budget, 240s wall clock. Tunable via
# OVERDRIVE_THINK_BUDGET / OVERDRIVE_TIMEOUT. Opus generates thinking at
# ~500 tok/s, so timeout >= budget/500 + headroom (32k:>=180s, 64k:>=240s,
# 96k:>=240s, 128k:>=300s). Anthropic ceiling 128k.
# _OVERDRIVE_MAX_TOKENS_SLACK is fixed (max_tokens > thinking.budget required).
_OVERDRIVE_MAX_TOKENS_SLACK = 4096


def _overdrive_think_budget() -> int:
    from hme_env import ENV as _ENV
    try:
        return _ENV.optional_int("OVERDRIVE_THINK_BUDGET", 64000)
    except Exception:
        return 64000


def _overdrive_timeout() -> int:
    from hme_env import ENV as _ENV
    try:
        return _ENV.optional_int("OVERDRIVE_TIMEOUT", 240)
    except Exception:
        return 240

# Source-of-last-answer tracking. synthesis_reasoning.call() writes this
# on every non-None return. Callers that care (e.g. agent_local.py's
# _call_synthesizer, which reports a per-call source tag upstream) can
# read last_source() after the call. Not thread-safe -- one-shot per
# caller context.
_last_source: str | None = None


def last_source() -> str | None:
    """Return a short string identifying which path produced the most
    recent non-None result from synthesis_reasoning.call(). Values:
        'overdrive/opus'                 -- Opus answered under OVERDRIVE_MODE
        'overdrive/sonnet'               -- Opus rate-limited, Sonnet took over
        '<provider>/<model>'             -- free-cascade slot fired
        None                             -- last call returned None OR
                                           no call made yet this process
    """
    return _last_source


# Overdrive model chain -- env-tunable via OVERDRIVE_CHAIN.
#
# Default chain: Opus first (max quality on user's subscription), Sonnet on
# Opus rate-limit (still Anthropic, still extended thinking). Only when every
# Anthropic model in the chain rate-limits does the caller fall through to
# the free cascade. claude-opus-4-7 and claude-sonnet-4-6 are the current-
# generation dated aliases; bare "opus"/"sonnet" return 404 from the API.
#
# Override via .env:
#   OVERDRIVE_CHAIN=claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001
# One comma-separated list of model IDs. Source labels are auto-generated
# from the model name so last_source() reports meaningfully.
_OVERDRIVE_CHAIN_DEFAULT = (
    "claude-opus-4-7",
    "claude-sonnet-4-6",
)



# Re-exports -- overdrive logic extracted to sibling.
from .synthesis_overdrive import (  # noqa: F401, E402
    _label_for_model, _resolve_overdrive_chain, _circuit_cooldown_secs,
    _circuit_open, _circuit_trip, _emit_overdrive_activity,
    _try_overdrive_model, _dispatch_via_subagent, _call_opus_overdrive,
)

def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3, profile: str = "reasoning",
         tier: str = "medium") -> str | None:
    """Walk the ranking for the given profile best->worst, returning the first success.

    profile='reasoning' (default) -- deep think, architecture, analysis.
    profile='coder'                -- structural code extraction, verified facts.

    Returns None only when every ranked slot is exhausted OR the wall-clock
    ceiling is hit -- caller falls back to local qwen3-coder:30b-a3b.

    Wall-clock ceiling (HME_REASONING_WALL_SECS, default 300s). Protects
    against cascade pathologies where multiple slots hang and each burns
    its per-call timeout serially. INVARIANT: wall_secs must be at least
    3* the longest per-provider timeout, or the cascade can't actually
    try multiple providers -- we'd time out inside the first provider's
    thinking pass. NVIDIA's per-call timeout is 120s (thinking models
    legitimately take 30-90s), so 300s gives 2-3 fair attempts. Raising
    the default from the legacy 45s after the user reported cascade
    exhaustion with Anthropic rate-limited: 45s wasn't enough for even
    one NVIDIA deepseek-v3.2 call to finish.

    HME_REASONING_OFFLINE=1 skips the external cascade entirely and returns
    None immediately -- caller falls straight to local fallback. Useful when
    Anthropic is having an outage, when rate-limited, or for offline dev.

    OVERDRIVE_MODE=1 in .env short-circuits this walk and calls Claude Opus
    with max extended thinking instead. On any failure of the overdrive path
    we fall through to the normal cascade so an API blip doesn't block work.
    OVERDRIVE_VIA_SUBAGENT=1 additionally routes the Claude calls through a
    Claude-Code Agent subagent (via proxy's subagent_bridge middleware)
    instead of hitting api.anthropic.com directly -- moves reasoning cost
    off raw per-minute RPM onto session-budget, which has far more headroom.
    """
    import time as _time
    from hme_env import ENV as _ENV
    _refresh_env()

    global _last_source
    _last_source = None  # reset per-call; caller can read last_source() after

    # Offline mode: skip the whole external cascade.
    if _ENV.optional("HME_REASONING_OFFLINE", "0") == "1":
        logger.info("reasoning: HME_REASONING_OFFLINE=1 -- skipping external cascade")
        return None

    # OVERDRIVE_MODE: 0=cascade; 1=Opus-all; 2=Opus/Sonnet/cascade; 3=Opus/DSeek/cascade.
    _od_mode = _ENV.optional("OVERDRIVE_MODE", "0")
    _LEGACY_TIER = {"easy": "E2", "medium": "E3", "hard": "E4"}
    _raw_tier = (tier or "E3").strip()
    if _raw_tier.upper() in ("E1", "E2", "E3", "E4", "E5"):
        _normalized_tier = _raw_tier.upper()
    else:
        _normalized_tier = _LEGACY_TIER.get(_raw_tier.lower(), "E3")
    if _od_mode == "1":
        _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        if _overdrive_result:
            _text, _source = _overdrive_result
            _last_source = _source
            return _text
    elif _od_mode == "2":
        if _normalized_tier in ("E4", "E5"):
            _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        elif _normalized_tier == "E3":
            # Pin Sonnet -- force direct API; subagent dispatch can't honor a model-specific chain.
            _overdrive_result = _call_opus_overdrive(
                prompt, system, max_tokens,
                chain_override=("claude-sonnet-4-6",),
                allow_subagent=False,
            )
        else:  # E1, E2
            _overdrive_result = None  # skip overdrive -> cascade handles it
        if _overdrive_result:
            _text, _source = _overdrive_result
            _last_source = _source
            return _text
    elif _od_mode == "3":
        # MODE=3: OpenCode Go DeepSeek between cascade and Opus.
        if _normalized_tier == "E5":
            _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        elif _normalized_tier == "E4":
            _overdrive_result = _call_opus_overdrive(
                prompt, system, max_tokens,
                chain_override=("deepseek-v4-pro",),
                allow_subagent=False,
            )
        elif _normalized_tier == "E3":
            _overdrive_result = _call_opus_overdrive(
                prompt, system, max_tokens,
                chain_override=("deepseek-v4-flash",),
                allow_subagent=False,
            )
        else:  # E1, E2
            _overdrive_result = None
        if _overdrive_result:
            _text, _source = _overdrive_result
            _last_source = _source
            return _text

    try:
        providers = _load_providers()
    except Exception as e:
        logger.warning(f"reasoning dispatcher: provider load failed: {e}")
        return None

    wall_secs = _ENV.optional_float("HME_REASONING_WALL_SECS", 300.0)
    deadline = _time.monotonic() + wall_secs
    ranking = _RANKINGS.get(profile, _RANKING_REASONING)
    for provider_key, model in ranking:
        if _time.monotonic() >= deadline:
            logger.warning(
                f"reasoning cascade wall-clock ceiling hit ({wall_secs:.0f}s) -- "
                f"exhausting to local fallback. Last attempted: {provider_key}/{model}"
            )
            return None
        mod = providers.get(provider_key)
        if mod is None:
            continue
        if not _model_available(mod, provider_key, model):
            continue
        result = _call_specific(mod, provider_key, model, prompt, system, max_tokens, temperature)
        if result:
            logger.info(f"{profile}: {provider_key}/{model} ({len(result)}c)")
            _last_source = f"{provider_key}/{model}"
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
