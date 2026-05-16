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


# Anthropic requires max_tokens to exceed thinking.budget_tokens.
_OVERDRIVE_MAX_TOKENS_SLACK = 4096


def _overdrive_timeout() -> int:
    from hme_env import ENV as _ENV
    try:
        return _ENV.optional_int("OVERDRIVE_TIMEOUT", 240)
    except Exception as exc:
        logger.debug(f"reasoning timeout config read failed: {type(exc).__name__}: {exc}")
        return 240

# Source-of-last-answer tracking. Callers read last_source() after call().
_last_source: str | None = None


def _resolve_registry_tier_chain(tier: str) -> tuple[str, ...] | None:
    """Resolve registry tier chain used by active OVERDRIVE_MODE=1.
    Chain ordered free first (including cascade), then subscription, then
    usage; each group by tier_score desc. Returns None if config unreadable
    or tier empty. Caller determines allow_subagent from chain contents."""
    from . import _load_models_json as _lmj
    try:
        _cfg = _lmj()
    except Exception as exc:
        logger.debug(f"reasoning model config read failed: {type(exc).__name__}: {exc}")
        return None
    _models = (_cfg.get("tiers", {}).get(tier, {}).get("models", []) or [])
    if not _models:
        return None
    _cost_order = _cfg.get("ranking_rules", {}).get("cost_order", ["free", "subscription", "usage"])
    _ids = []
    for _cost in _cost_order:
        _group = sorted(
            [m for m in _models if m.get("cost") == _cost],
            key=lambda m: -m.get("tier_score", 0),
        )
        _ids.extend(m["id"] for m in _group if m.get("id"))
    _top = _cfg.get("manually_toprank", {}).get(tier, []) or []
    _ids = [mid for mid in _top if mid in _ids] + [mid for mid in _ids if mid not in _top]
    return tuple(_ids) if _ids else None


def _resolve_mode_legacy_chain_from_registry(mode: str, tier: str) -> tuple[tuple[str, ...], bool] | None:
    """Resolve MODE=1..4 (chain, allow_subagent) from config/models.json
    legacy_chains block. Empty arrays = cascade fallthrough (None).
    allow_subagent: True iff any model in chain starts with 'claude-'."""
    from . import _load_models_json as _lmj
    try:
        _cfg = _lmj()
    except Exception as exc:
        logger.debug(f"reasoning provider config read failed: {type(exc).__name__}: {exc}")
        return None
    _legacy = _cfg.get("legacy_chains", {})
    _mode_chains = _legacy.get(f"mode{mode}", {})
    _raw = _mode_chains.get(tier)
    if _raw is None:
        return None
    # Array form [model,...]: auto-derive allow_subagent. Object form
    # {chain:[], allow_subagent:bool}: explicit override.
    if isinstance(_raw, list):
        if not _raw:  # empty list -> cascade
            return None
        _chain = tuple(_raw)
        _allow_sub = any(m.startswith("claude-") for m in _chain)
    else:
        _chain_list = _raw.get("chain", [])
        if not _chain_list:
            return None
        _chain = tuple(_chain_list)
        _allow_sub = _raw.get("allow_subagent")
        if _allow_sub is None:  # not specified -> derive
            _allow_sub = any(m.startswith("claude-") for m in _chain)
    # Default chain -> don't override (respects OVERDRIVE_CHAIN env var)
    if _chain == ("claude-opus-4-7", "claude-sonnet-4-6"):
        return (None, _allow_sub)
    return (_chain, _allow_sub)


def _resolve_registry_tier_entry(tier: str) -> tuple[tuple[str, ...], bool] | None:
    """Read registry tier chain; allow subagent only when chain includes claude."""
    chain = _resolve_registry_tier_chain(tier)
    if chain is None:
        return None
    allow_sub = any(m.startswith("claude-") for m in chain)
    return (chain, allow_sub)


def _role_tier(role: str, fallback: str) -> str:
    if role in ("driver", "blue_lead", "red_lead", "team_lead"):
        return "E5"
    if role in ("blue_purple", "red_purple", "team_purple"):
        return "E4"
    if role.startswith("crew_e") and len(role) >= 7 and role[6] in "1234":
        return "E" + role[6]
    return fallback


def _role_key(role: str) -> str:
    if role == "driver":
        return "driver"
    if role in ("blue_lead", "red_lead", "team_lead"):
        return "team_lead"
    if role in ("blue_purple", "red_purple", "team_purple"):
        return "team_purple"
    if role.startswith("crew_") or role == "stage_crew":
        return "stage_crew"
    return ""


def _mode1_role_chain(cfg: dict, role: str, role_tier: str) -> tuple[str, ...] | None:
    spec = cfg.get("team_role_models", {}).get(_role_key(role))
    if not isinstance(spec, dict):
        return None
    spec_tier = role_tier if spec.get("tier") == "role" else spec.get("tier", role_tier)
    base = _resolve_registry_tier_chain(spec_tier)
    if base is None:
        return None
    if spec.get("source") != "manually_toprank":
        return base
    top = [m for m in cfg.get("manually_toprank", {}).get(spec_tier, []) if m in base]
    return tuple(top + [m for m in base if m not in top])


def _resolve_mode1_entry(tier: str) -> tuple[tuple[str, ...], bool] | None:
    from hme_env import ENV as _ENV
    from . import _load_models_json as _lmj
    role = _ENV.optional("HME_TEAM_ROLE", "").strip().lower()
    role_tier = _role_tier(role, tier)
    try:
        cfg = _lmj()
    except Exception as _exc:
        return _resolve_registry_tier_entry(role_tier)
    chain = _mode1_role_chain(cfg, role, role_tier) or _resolve_registry_tier_chain(role_tier)
    return (chain, any(m.startswith("claude-") for m in chain)) if chain else None


# Active overdrive modes: 0=cascade, 6=team-role registry routing.
# Legacy modes 1..5 are retired; helpers remain only where MODE=1 reuses
# registry chain resolution. None = cascade.
_MODE_CHAIN_RESOLVERS = {
    "1": _resolve_mode1_entry,
}


def last_source() -> str | None:
    """Return a short string identifying which path produced the most
    recent non-None result from synthesis_reasoning.call(). Values:
        'overdrive/zen/<model>'          -- model from active registry chain
        'overdrive/<model>'              -- model from overdrive chain
        '<provider>/<model>'             -- free-cascade slot fired
        None                             -- last call returned None OR
                                           no call made yet this process
    """
    return _last_source


# Overdrive chain: Opus->Sonnet rate-limit cascade. Override: OVERDRIVE_CHAIN env var.
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
    one NVIDIA deepseek-v4-pro call to finish.

    HME_REASONING_OFFLINE=1 skips the external cascade entirely and returns
    None immediately -- caller falls straight to local fallback. Useful when
    Anthropic is having an outage, when rate-limited, or for offline dev.

    OVERDRIVE_MODE=1 enables team-role registry routing. Legacy modes 1..5
    are retired and fall through to the normal cascade.
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

    # OVERDRIVE_MODE: 0=cascade; 6=team-role registry routing.
    # Legacy modes 1..5 are retired and intentionally fall through.
    _od_mode = _ENV.optional("OVERDRIVE_MODE", "0")
    _LEGACY_TIER = {"easy": "E2", "medium": "E3", "hard": "E4"}
    _raw_tier = (tier or "E3").strip()
    if _raw_tier.upper() in ("E1", "E2", "E3", "E4", "E5"):
        _normalized_tier = _raw_tier.upper()
    else:
        _normalized_tier = _LEGACY_TIER.get(_raw_tier.lower(), "E3")
    if _od_mode in _MODE_CHAIN_RESOLVERS:
        _resolved = _MODE_CHAIN_RESOLVERS[_od_mode](_normalized_tier)
        if _resolved is not None:
            _chain, _allow_sub = _resolved
            _overdrive_result = _call_opus_overdrive(
                prompt, system, max_tokens,
                chain_override=_chain, allow_subagent=_allow_sub,
                tier=_normalized_tier,
            )
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
