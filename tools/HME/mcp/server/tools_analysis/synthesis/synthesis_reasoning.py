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
    ENV.load(force=True)


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


def _call_opus_overdrive(prompt: str, system: str, max_tokens: int) -> str | None:
    """OVERDRIVE_MODE path — call Claude Opus with maximum extended thinking.

    Triggered when OVERDRIVE_MODE=1 in .env. Bypasses the free-tier cascade
    entirely and spends Claude Code subscription credits for highest-quality
    output. Used for both the subagent replacement (agent_local.py →
    _call_synthesizer) and every other cascade caller — they all funnel
    through call() below.

    Route: POSTs to the local HME proxy at ANTHROPIC_BASE_URL (default
    http://127.0.0.1:9099). The proxy forwards to api.anthropic.com and,
    because loopback out-of-band requests arrive with no Authorization
    header, auto-injects the Claude Code OAuth token from
    ~/.claude/.credentials.json. Same credential Claude Code's live
    session uses — your subscription covers both paths identically.
    The user configures nothing; auth is ambient.

    Returns None on ANY failure (proxy down, upstream 4xx/5xx, empty
    response). Caller falls through to the normal cascade so a
    configuration gap or transient outage doesn't block the agent.

    Model: claude-opus-4-7 with thinking.budget_tokens=32000 — max
    realistic reasoning budget for a single call. max_tokens is bumped
    to max(caller_value, 16384) so the model has room to both think and
    respond without truncation."""
    import json as _json
    import os as _os
    import urllib.request as _req

    # Route through the local proxy. It handles auth injection for
    # loopback out-of-band requests, so this call ships with no auth
    # headers attached — the proxy adds them.
    base_url = _os.environ.get("ANTHROPIC_BASE_URL", "http://127.0.0.1:9099").rstrip("/")

    payload = {
        "model": "claude-opus-4-7",
        "max_tokens": max(max_tokens, 16384),
        "temperature": 1.0,  # Anthropic requires temperature=1.0 with thinking
        "thinking": {"type": "enabled", "budget_tokens": 32000},
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system

    try:
        request = _req.Request(
            f"{base_url}/v1/messages",
            data=_json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
        )
        with _req.urlopen(request, timeout=300) as resp:
            data = _json.loads(resp.read())
    except Exception as e:
        logger.warning(f"OVERDRIVE Opus call failed ({type(e).__name__}: {e}) — falling through to cascade")
        return None

    # Extended-thinking response has alternating `thinking` and `text` blocks.
    # Caller wants the final text answer; skip the thinking traces.
    text_parts = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
    result = "\n".join(p for p in text_parts if p)
    if result:
        logger.info(f"OVERDRIVE: opus returned {len(result)}c")
        return result
    logger.warning("OVERDRIVE Opus returned empty content — falling through to cascade")
    return None


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3, profile: str = "reasoning") -> str | None:
    """Walk the ranking for the given profile best→worst, returning the first success.

    profile='reasoning' (default) — deep think, architecture, analysis.
    profile='coder'                — structural code extraction, verified facts.

    Returns None only when every ranked slot is exhausted OR the wall-clock
    ceiling is hit — caller falls back to local qwen3-coder:30b-a3b.

    Wall-clock ceiling (HME_REASONING_WALL_SECS, default 45s) protects against
    cascade pathologies where multiple slots each burn their 60s per-call
    timeout serially. Without a ceiling, one hung cascade can freeze a worker
    thread for minutes and every request after it queues up behind the burn.

    OVERDRIVE_MODE=1 in .env short-circuits this walk and calls Claude Opus
    with max extended thinking instead. On any failure of the overdrive path
    we fall through to the normal cascade so an API blip doesn't block work.
    """
    import time as _time
    from hme_env import ENV as _ENV
    _refresh_env()

    # OVERDRIVE_MODE: spend Anthropic credits for highest-quality output.
    # Single-branch intercept. When OVERDRIVE_MODE is anything other than
    # "1", this block is a no-op and the function behaves exactly as
    # before. When =1 and the call succeeds, return immediately; on any
    # failure, fall through to the cascade so the agent never blocks on
    # a transient API issue.
    if _ENV.optional("OVERDRIVE_MODE", "0") == "1":
        _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        if _overdrive_result:
            return _overdrive_result

    try:
        providers = _load_providers()
    except Exception as e:
        logger.warning(f"reasoning dispatcher: provider load failed: {e}")
        return None

    wall_secs = _ENV.optional_float("HME_REASONING_WALL_SECS", 45.0)
    deadline = _time.monotonic() + wall_secs
    ranking = _RANKINGS.get(profile, _RANKING_REASONING)
    for provider_key, model in ranking:
        if _time.monotonic() >= deadline:
            logger.warning(
                f"reasoning cascade wall-clock ceiling hit ({wall_secs:.0f}s) — "
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
