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
from common.bounded_log import maybe_trim_append as _maybe_trim_activity_log  # noqa: E402

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


# Overdrive budget and timeout tuning.
#
# Defaults are "max effort" — 64k thinking, 240s wall clock — because
# that's what OVERDRIVE_MODE exists for. Callers who want true
# ceiling-level reasoning (up to 128k budget) can bump both knobs in
# .env without code changes. The two are coupled: Opus generates
# thinking at ~500 tok/s, so a budget/timeout combo that under-budgets
# time produces spurious 504/timeout failures mid-thought.
#
# Rough timing math for capacity planning:
#   32k budget → ~64s   → fits well under 180s
#   64k budget → ~128s  → default; fits under 240s with headroom
#   96k budget → ~192s  → needs timeout ≥ 240s
#   128k budget → ~256s → needs timeout ≥ 300s (Anthropic ceiling)
#
# Env vars:
#   OVERDRIVE_THINK_BUDGET  — int, thinking budget in tokens (default 64000)
#   OVERDRIVE_TIMEOUT       — int, wall-clock seconds per model call (default 240)
#
# _OVERDRIVE_MAX_TOKENS_SLACK is a code constant (not env-tunable): Anthropic
# requires max_tokens > thinking.budget_tokens, so the effective max_tokens
# is always budget+slack. Slack of 4096 gives the answer itself ~4k headroom
# beyond the thinking phase, which is plenty for the structured outputs
# agentic workloads produce.
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
# read last_source() after the call. Not thread-safe — one-shot per
# caller context.
_last_source: str | None = None


def last_source() -> str | None:
    """Return a short string identifying which path produced the most
    recent non-None result from synthesis_reasoning.call(). Values:
        'overdrive/opus'                 — Opus answered under OVERDRIVE_MODE
        'overdrive/sonnet'               — Opus rate-limited, Sonnet took over
        '<provider>/<model>'             — free-cascade slot fired
        None                             — last call returned None OR
                                           no call made yet this process
    """
    return _last_source


# Overdrive model chain — env-tunable via OVERDRIVE_CHAIN.
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


def _label_for_model(model_id: str) -> str:
    """Turn 'claude-opus-4-7' → 'overdrive/opus', 'claude-sonnet-4-6' →
    'overdrive/sonnet', 'claude-haiku-4-5-20251001' → 'overdrive/haiku'.
    Falls back to the full model id when the slug isn't recognizable."""
    for slug in ("opus", "sonnet", "haiku"):
        if slug in model_id.lower():
            return f"overdrive/{slug}"
    return f"overdrive/{model_id}"


def _resolve_overdrive_chain() -> tuple[tuple[str, str], ...]:
    """Read OVERDRIVE_CHAIN from .env if set, else use the default. Returns
    a tuple of (model_id, source_label) pairs."""
    from hme_env import ENV as _ENV
    raw = _ENV.optional("OVERDRIVE_CHAIN", "").strip()
    models = [m.strip() for m in raw.split(",") if m.strip()] if raw else list(_OVERDRIVE_CHAIN_DEFAULT)
    return tuple((m, _label_for_model(m)) for m in models)


# Circuit-breaker state. When a model rate-limits, record the wall-clock
# monotonic time at which it should be retried. Subsequent overdrive calls
# short-circuit that model's slot until the window passes — avoids the
# N×2 retry tax during sustained rate-limit windows.
#
# Cooldown tunable via OVERDRIVE_RATE_LIMIT_COOLDOWN (seconds, default 60).
# Not thread-safe (module-global dict) — acceptable because the MCP server
# is single-process and the overdrive path is called serially per request.
_model_cooldown_until: dict[str, float] = {}


def _circuit_cooldown_secs() -> int:
    from hme_env import ENV as _ENV
    try:
        return _ENV.optional_int("OVERDRIVE_RATE_LIMIT_COOLDOWN", 60)
    except Exception:
        return 60


def _circuit_open(model_id: str) -> bool:
    """Return True if the model is currently in cooldown (skip it)."""
    import time as _time
    deadline = _model_cooldown_until.get(model_id, 0.0)
    return _time.monotonic() < deadline


def _circuit_trip(model_id: str) -> None:
    """Mark a model as rate-limited; block calls to it for the cooldown window."""
    import time as _time
    cooldown = _circuit_cooldown_secs()
    _model_cooldown_until[model_id] = _time.monotonic() + cooldown
    logger.info(f"OVERDRIVE circuit: {model_id} cooldown for {cooldown}s")


def _emit_overdrive_activity(source_label: str, model_id: str,
                              budget: int, char_count: int) -> None:
    """Append an inference_call event to hme-activity.jsonl so overdrive
    rounds show up in the same per-round analytics as cascade slots.
    Best-effort: any failure is swallowed — activity logging must never
    block or fail the inference call."""
    try:
        import json as _json
        import os as _os
        import time as _time
        path = _os.environ.get("METRICS_DIR")
        if not path:
            root = _os.environ.get("PROJECT_ROOT", "")
            if not root:
                return
            path = _os.path.join(root, "output", "metrics")
        _os.makedirs(path, exist_ok=True)
        entry = {
            "ts": int(_time.time()),
            "event": "inference_call",
            "source": source_label,
            "model": model_id,
            "thinking_budget": budget,
            "response_chars": char_count,
        }
        _activity_path = _os.path.join(path, "hme-activity.jsonl")
        with open(_activity_path, "a") as f:
            f.write(_json.dumps(entry) + "\n")
        # Bounded growth: fires more often now that OVERDRIVE is the default
        # for synthesis/reasoning call sites. Tail-half trim every 200 writes.
        _maybe_trim_activity_log(_activity_path)
    except Exception as _e:
        logger.debug(f"overdrive activity emit failed ({type(_e).__name__}: {_e})")


# (bounded_log import moved to module top alongside other imports)


def _try_overdrive_model(model_id: str, prompt: str, system: str,
                         max_tokens: int) -> tuple[str | None, bool]:
    """POST a single-model overdrive call through the proxy.

    Returns (text_or_None, rate_limited). `rate_limited` is True iff the
    upstream returned HTTP 429 OR the JSON body is an `error` object with
    type `rate_limit_error` OR the circuit breaker is tripped for this
    model — the caller uses that flag to decide whether to try the next
    model in the chain or give up on overdrive entirely.

    Non-429 failures (proxy down, timeout, 5xx, malformed JSON, empty
    content) return (None, False) — not worth retrying another model, the
    problem is structural. Caller falls through to the free cascade."""
    import json as _json
    import os as _os
    import urllib.error as _urllib_error
    import urllib.request as _req

    # Circuit breaker: if this model rate-limited recently, short-circuit
    # without hitting the network. Returns "rate_limited=True" so the
    # chain advances to the next model immediately.
    if _circuit_open(model_id):
        logger.info(f"OVERDRIVE {model_id} in cooldown — skipping")
        return (None, True)

    base_url = _os.environ.get("ANTHROPIC_BASE_URL", "http://127.0.0.1:9099").rstrip("/")

    # Read env-tunable knobs fresh per call so .env changes take effect
    # without restarting the worker. The hme_env cache already handles
    # refresh policy; these helpers are thin wrappers.
    budget = _overdrive_think_budget()
    timeout_secs = _overdrive_timeout()

    # max_tokens MUST exceed thinking.budget_tokens. Raise the caller's
    # value to budget+slack when it's too low.
    _floor = budget + _OVERDRIVE_MAX_TOKENS_SLACK
    resolved_max = max(max_tokens, _floor)

    payload = {
        "model": model_id,
        "max_tokens": resolved_max,
        "temperature": 1.0,  # Anthropic requires temperature=1.0 with thinking
        "thinking": {"type": "enabled", "budget_tokens": budget},
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
        with _req.urlopen(request, timeout=timeout_secs) as resp:
            data = _json.loads(resp.read())
    except _urllib_error.HTTPError as e:
        # 429 = rate limit — try next model in the chain.
        is_rate = (e.code == 429)
        try:
            body = e.read().decode(errors="replace")[:200]
        except Exception:
            body = ""
        logger.warning(f"OVERDRIVE {model_id} HTTP {e.code}: {body}")
        if is_rate:
            _circuit_trip(model_id)
        return (None, is_rate)
    except Exception as e:
        logger.warning(f"OVERDRIVE {model_id} call failed ({type(e).__name__}: {e})")
        return (None, False)

    # Some upstreams (including the current proxy when upstream 429s)
    # wrap the rate-limit as a normal 200 with {"type":"error",...}.
    # Treat that identically to an HTTP 429.
    if isinstance(data, dict) and data.get("type") == "error":
        err = data.get("error", {}) or {}
        is_rate = err.get("type") == "rate_limit_error"
        logger.warning(f"OVERDRIVE {model_id} error-body: {err.get('type', '?')} — {err.get('message', '?')[:120]}")
        if is_rate:
            _circuit_trip(model_id)
        return (None, is_rate)

    # Extended-thinking response has alternating `thinking` and `text` blocks.
    # Caller wants the final text answer; skip the thinking traces.
    text_parts = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
    result = "\n".join(p for p in text_parts if p)
    if result:
        logger.info(f"OVERDRIVE: {model_id} returned {len(result)}c")
        _emit_overdrive_activity(_label_for_model(model_id), model_id, budget, len(result))
        return (result, False)
    logger.warning(f"OVERDRIVE {model_id} returned empty content")
    return (None, False)


def _dispatch_via_subagent(prompt: str, system: str, max_tokens: int, subagent_type: str = "general-purpose") -> tuple[str, str] | None:
    # PRIORITY 1: persistent thread. If user has run `i/thread init`,
    # tmp/hme-thread.sid exists; every reasoning call flows synchronously
    # through that one long-lived claude session so context accumulates
    # across review/OVERDRIVE/suggest_evolution dispatches. The result
    # comes back inline as a normal reasoning response — no sentinel,
    # no separate dispatch step on the agent side. Falls through to
    # direct/sentinel paths if the thread dispatch fails or no sid.
    #
    # ImportError / AttributeError are logged at WARNING — they signal
    # the thread-dispatch module is structurally unreachable (misnamed
    # symbol, refactor breakage, etc.) which must not silently demote
    # to debug. Runtime failures (timeouts, subprocess errors) are
    # handled inside dispatch_thread; anything leaking out is unexpected.
    # Accept empty string as a valid result (explicit `is not None`) so
    # a legitimate empty reply doesn't cause fallback double-dispatch.
    try:
        from .agent_direct import dispatch_thread as _thread
        thread_result = _thread(prompt)
        if thread_result is not None:
            return (thread_result, "overdrive/thread")
    except (ImportError, AttributeError) as _thr_struct:
        logger.warning(f"thread dispatch structurally unreachable: "
                       f"{type(_thr_struct).__name__}: {_thr_struct}")
    except Exception as _thr_err:
        logger.debug(f"thread dispatch errored: {type(_thr_err).__name__}: {_thr_err}")

    # PRIORITY 2: feature-flagged ephemeral direct path (OVERDRIVE_DIRECT_AGENT=1)
    # — spawns a fresh claude subprocess per call. No context accumulation.
    try:
        from .agent_direct import dispatch_direct as _direct
        direct_result = _direct(prompt, system, max_tokens, subagent_type=subagent_type)
        if direct_result:
            return (direct_result, "overdrive/direct-agent")
    except Exception as _dir_err:
        logger.debug(f"agent_direct path errored: {type(_dir_err).__name__}: {_dir_err}")

    """OVERDRIVE_VIA_SUBAGENT path — queue the prompt for Claude to dispatch
    via its own Agent tool rather than hitting api.anthropic.com directly.

    Writes prompt + system to tmp/hme-subagent-queue/<uuid>.json. Returns a
    sentinel string that appears in the reasoning output; the proxy
    middleware `subagent_bridge.js` scans for the sentinel in outgoing
    API requests and injects an instruction into the system message telling
    Claude to invoke Agent(...) with the queued prompt. Agent runs inside
    Claude Code's session-budget path, NOT the per-minute raw-API RPM
    bucket that OVERDRIVE's direct calls hit. The user confirmed session
    budget has headroom when RPM is exhausted.

    Returns (sentinel, 'overdrive/subagent') — the sentinel IS the
    synthesis result from HME's perspective; Claude will fulfill it on
    its next turn."""
    import json as _json
    import os as _os
    import uuid as _uuid
    from server import context as _ctx
    req_id = _uuid.uuid4().hex[:12]
    queue_dir = _os.path.join(_ctx.PROJECT_ROOT, "tmp", "hme-subagent-queue")
    _os.makedirs(queue_dir, exist_ok=True)
    # Known-valid Claude Code subagent_types. The middleware validates against
    # this list before instructing the agent, so an unknown type silently
    # falls back to general-purpose (fail-safe default).
    _VALID_TYPES = {
        "general-purpose", "Explore", "Plan",
        "statusline-setup", "claude-code-guide",
    }
    if subagent_type not in _VALID_TYPES:
        logger.warning(
            f"OVERDRIVE_VIA_SUBAGENT: subagent_type={subagent_type!r} not in "
            f"known set; falling back to general-purpose"
        )
        subagent_type = "general-purpose"
    payload = {
        "req_id": req_id,
        "prompt": prompt,
        "system": system,
        "max_tokens": max_tokens,
        "subagent_type": subagent_type,
        "created_at": _time_mod.time() if '_time_mod' in globals() else None,
    }
    try:
        import time as _t
        payload["created_at"] = _t.time()
    except Exception as _err:
        logger.debug(f"subagent queue: ts stamp skipped: {type(_err).__name__}: {_err}")
    prompt_file = _os.path.join(queue_dir, f"{req_id}.json")
    try:
        with open(prompt_file, "w") as f:
            _json.dump(payload, f)
    except Exception as e:
        logger.warning(f"OVERDRIVE_VIA_SUBAGENT: queue write failed: {e}")
        return None
    # Compact self-instructing sentinel — single line. The tag contains
    # all fields the proxy middleware needs to route the result back;
    # the trailing call-form is a dispatch hint the agent can execute
    # directly without needing a separate system-message.
    #
    # Routing switch: when `tmp/hme-thread.sid` exists, the user has
    # initialized a persistent subagent thread via `i/thread init`. All
    # subsequent reasoning dispatches go through that thread instead of
    # spawning ephemeral Agent calls — context accumulates across tasks.
    # When the sid file is absent, behavior is identical to pre-thread
    # (ephemeral Agent dispatch with middleware-side result capture).
    project_root = _os.environ.get("PROJECT_ROOT", "")
    thread_sid_file = _os.path.join(project_root, "tmp", "hme-thread.sid") \
        if project_root else ""
    thread_active = bool(thread_sid_file) and _os.path.exists(thread_sid_file)
    if thread_active:
        sentinel = (
            f"\n[[HME_AGENT_TASK req_id={req_id} "
            f"prompt_file=tmp/hme-subagent-queue/{req_id}.json "
            f"subagent_type={subagent_type} mode=thread]] → "
            f"Bash(command='i/thread send tmp/hme-subagent-queue/{req_id}.json', "
            f"description='HME reasoning for {req_id} via thread')"
        )
    else:
        sentinel = (
            f"\n[[HME_AGENT_TASK req_id={req_id} "
            f"prompt_file=tmp/hme-subagent-queue/{req_id}.json "
            f"subagent_type={subagent_type}]] → "
            f"Agent(subagent_type='{subagent_type}', "
            f"description='HME reasoning for {req_id}', "
            f"prompt=<Read {prompt_file}>)"
        )
    logger.info(f"OVERDRIVE_VIA_SUBAGENT: queued req_id={req_id} "
                f"(prompt={len(prompt)}c, system={len(system)}c)")
    return (sentinel, "overdrive/subagent")


def _call_opus_overdrive(prompt: str, system: str, max_tokens: int,
                          chain_override: tuple[str, ...] | None = None,
                          allow_subagent: bool = True) -> tuple[str, str] | None:
    """OVERDRIVE_MODE path — Opus-then-Sonnet chain with max extended thinking.

    Triggered when OVERDRIVE_MODE=1 in .env. Bypasses the free-tier cascade
    and spends Claude Code subscription credits for highest-quality output.
    Walks the model chain (Opus, Sonnet) in order: on rate-limit for the
    current model, advances to the next; on any other failure (proxy down,
    timeout, empty content, malformed response), returns None so the caller
    falls through to the free cascade.

    OVERDRIVE_VIA_SUBAGENT=1 short-circuits direct API calls and routes
    through Claude Code's Agent tool instead (different rate-limit bucket —
    session budget, not per-minute RPM). See _dispatch_via_subagent.

    chain_override: optional explicit (model_id, ...) tuple — overrides the
    .env-resolved chain. Used by OVERDRIVE_MODE=2 (tier-aware routing) to
    pin specific models per task tier (e.g. Sonnet-only for tier=medium).
    Source labels are auto-generated via _label_for_model.

    allow_subagent: when False, force direct API even if OVERDRIVE_VIA_SUBAGENT=1.
    Used by OVERDRIVE_MODE=2 to pin model selection per tier — subagent
    dispatch runs at whatever /model is set, so it can't honor a Sonnet-
    specific chain. Hard-tier (Opus chain) keeps subagent compatibility.

    Returns (text, source_label) on success where source_label is e.g.
    'overdrive/opus' or 'overdrive/sonnet'. Returns None when every model in
    the chain failed.

    Route: POSTs to the local HME proxy at ANTHROPIC_BASE_URL (default
    http://127.0.0.1:9099). The proxy forwards to api.anthropic.com and,
    because loopback out-of-band requests arrive with no Authorization
    header, auto-injects the Claude Code OAuth token from
    ~/.claude/.credentials.json. Same credential Claude Code's live
    session uses — your subscription covers both paths identically.
    The user configures nothing; auth is ambient."""
    from hme_env import ENV as _ENV_OD
    if allow_subagent and _ENV_OD.optional("OVERDRIVE_VIA_SUBAGENT", "0") == "1":
        return _dispatch_via_subagent(prompt, system, max_tokens)
    if chain_override is not None:
        chain = tuple((m, _label_for_model(m)) for m in chain_override)
    else:
        chain = _resolve_overdrive_chain()
    for model_id, source_label in chain:
        result, rate_limited = _try_overdrive_model(model_id, prompt, system, max_tokens)
        if result:
            return (result, source_label)
        if not rate_limited:
            # Non-rate-limit failure — the problem is not model-specific.
            # Don't bother the next model; fall through to cascade.
            return None
        # Rate-limited (or circuit-open): move to the next model in the chain.
    # Every model in the chain rate-limited or was in cooldown.
    logger.warning("OVERDRIVE: every model in chain rate-limited — falling through to cascade")
    return None


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3, profile: str = "reasoning",
         tier: str = "medium") -> str | None:
    """Walk the ranking for the given profile best→worst, returning the first success.

    profile='reasoning' (default) — deep think, architecture, analysis.
    profile='coder'                — structural code extraction, verified facts.

    Returns None only when every ranked slot is exhausted OR the wall-clock
    ceiling is hit — caller falls back to local qwen3-coder:30b-a3b.

    Wall-clock ceiling (HME_REASONING_WALL_SECS, default 300s). Protects
    against cascade pathologies where multiple slots hang and each burns
    its per-call timeout serially. INVARIANT: wall_secs must be at least
    3× the longest per-provider timeout, or the cascade can't actually
    try multiple providers — we'd time out inside the first provider's
    thinking pass. NVIDIA's per-call timeout is 120s (thinking models
    legitimately take 30-90s), so 300s gives 2–3 fair attempts. Raising
    the default from the legacy 45s after the user reported cascade
    exhaustion with Anthropic rate-limited: 45s wasn't enough for even
    one NVIDIA deepseek-v3.2 call to finish.

    HME_REASONING_OFFLINE=1 skips the external cascade entirely and returns
    None immediately — caller falls straight to local fallback. Useful when
    Anthropic is having an outage, when rate-limited, or for offline dev.

    OVERDRIVE_MODE=1 in .env short-circuits this walk and calls Claude Opus
    with max extended thinking instead. On any failure of the overdrive path
    we fall through to the normal cascade so an API blip doesn't block work.
    OVERDRIVE_VIA_SUBAGENT=1 additionally routes the Claude calls through a
    Claude-Code Agent subagent (via proxy's subagent_bridge middleware)
    instead of hitting api.anthropic.com directly — moves reasoning cost
    off raw per-minute RPM onto session-budget, which has far more headroom.
    """
    import time as _time
    from hme_env import ENV as _ENV
    _refresh_env()

    global _last_source
    _last_source = None  # reset per-call; caller can read last_source() after

    # Offline mode: skip the whole external cascade.
    if _ENV.optional("HME_REASONING_OFFLINE", "0") == "1":
        logger.info("reasoning: HME_REASONING_OFFLINE=1 — skipping external cascade")
        return None

    # OVERDRIVE_MODE: route through Claude Code subscription for higher-
    # quality output than the free cascade. All paths consume Max session
    # quota (via direct API with proxy-injected OAuth token, OR via the
    # subagent bridge), NEVER raw api.anthropic.com.
    #
    # Mode 1: Opus-then-Sonnet chain regardless of task tier. Original
    #         behavior. Same chain for every call.
    # Mode 2: tier-aware routing —
    #           hard   → Opus chain (Opus, fallback Sonnet on rate-limit)
    #           medium → Sonnet-only chain (skip Opus to preserve quota
    #                    for hard tasks; force direct API since subagent
    #                    can't pin a specific model independent of /model)
    #           easy   → skip overdrive entirely → fall through to free
    #                    cascade (NVIDIA/Cerebras/Groq/Gemini)
    # Mode 0 (or unset): no-op; cascade is the only path.
    #
    # On any overdrive failure (rate-limit-everything, proxy down, etc.),
    # we fall through to the free cascade so the agent never blocks on a
    # transient API issue.
    _od_mode = _ENV.optional("OVERDRIVE_MODE", "0")
    _normalized_tier = (tier or "medium").lower()
    if _normalized_tier not in ("easy", "medium", "hard"):
        _normalized_tier = "medium"
    if _od_mode == "1":
        _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        if _overdrive_result:
            _text, _source = _overdrive_result
            _last_source = _source
            return _text
    elif _od_mode == "2":
        if _normalized_tier == "hard":
            _overdrive_result = _call_opus_overdrive(prompt, system, max_tokens)
        elif _normalized_tier == "medium":
            # Pin Sonnet — force direct API since subagent dispatch
            # can't honor a model-specific chain (it runs at /model).
            _overdrive_result = _call_opus_overdrive(
                prompt, system, max_tokens,
                chain_override=("claude-sonnet-4-6",),
                allow_subagent=False,
            )
        else:  # easy
            _overdrive_result = None  # skip overdrive → cascade handles it
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
