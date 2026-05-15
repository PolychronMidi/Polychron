"""Synthesis model dispatcher -- everything routes through OmniRoute.

OmniRoute handles all provider-specific auth, compression, and Anthropic<->OpenAI
translation. Models are resolved per-tier from config/models.json.
"""
import logging
import os
import sys
import time
import time as _time_mod  # alias used by overdrive call sites

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402
from common import maybe_trim_append as _maybe_trim_activity_log  # noqa: E402

logger = logging.getLogger("HME.reasoning")

# Constants live on synthesis_reasoning; resolve via `_sr.<name>` at call time

_ENV_REFRESH_INTERVAL = 60  # re-read .env at most once per minute
_env_last_refresh = 0.0




def _label_for_model(model_id: str) -> str:
    """Turn 'deepseek-v4-pro' -> 'overdrive/zen/deepseek-pro', etc.
    Falls back to 'overdrive/{model_id}'."""
    lower = model_id.lower()
    if lower.startswith("deepseek-"):
        if "pro" in lower:
            return "overdrive/zen/deepseek-pro"
        if "flash" in lower:
            return "overdrive/zen/deepseek-flash"
        return f"overdrive/zen/{model_id}"
    if lower.startswith("glm-"):
        return f"overdrive/zen/{model_id}"
    return f"overdrive/{model_id}"


def _resolve_overdrive_chain() -> tuple[tuple[str, str], ...]:
    """Read OVERDRIVE_CHAIN from .env if set, else use the default. Returns
    a tuple of (model_id, source_label) pairs."""
    from hme_env import ENV as _ENV
    raw = _ENV.optional("OVERDRIVE_CHAIN", "").strip()
    from . import synthesis_reasoning as _sr
    models = [m.strip() for m in raw.split(",") if m.strip()] if raw else list(_sr._OVERDRIVE_CHAIN_DEFAULT)
    return tuple((m, _label_for_model(m)) for m in models)


# Circuit-breaker: model cooldown on rate-limit. Tunable: OVERDRIVE_RATE_LIMIT_COOLDOWN.
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
    Best-effort: any failure is swallowed -- activity logging must never
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


def _resolve_model_meta(model_id: str) -> dict:
    import json as _json
    import os as _os
    try:
        from . import _load_models_json as _lmj
        _cfg = _lmj()
        for _tier in _cfg.get("tiers", {}).values():
            for _m in _tier.get("models", []):
                if _m.get("id") == model_id:
                    return _m
    except Exception:  # silent-ok: config read best-effort, fallback context cap applies
        pass
    return {}


def _resolve_model_provider(model_id: str) -> str | None:
    return _resolve_model_meta(model_id).get("provider")



def _context_limits_for(model_id: str) -> tuple[int, int | None]:
    meta = _resolve_model_meta(model_id)
    ctx_limit = int(meta.get("context_length") or meta.get("max_context") or 0)
    output_limit = int(meta.get("max_output_tokens") or 0)
    return (ctx_limit if ctx_limit > 0 else 128000, output_limit if output_limit > 0 else None)


def _try_overdrive_model(model_id: str, prompt: str, system: str,
                         max_tokens: int) -> tuple[str | None, bool]:
    """POST a single-model overdrive call through the proxy.

    Returns (text_or_None, rate_limited). `rate_limited` is True iff the
    upstream returned HTTP 429 OR the JSON body is an `error` object with
    type `rate_limit_error` OR the circuit breaker is tripped for this
    model -- the caller uses that flag to decide whether to try the next
    model in the chain or give up on overdrive entirely.

    Non-429 failures (proxy down, timeout, 5xx, malformed JSON, empty
    content) return (None, False) -- not worth retrying another model, the
    problem is structural. Caller falls through to the free cascade."""
    import json as _json
    import os as _os
    import urllib.error as _urllib_error
    import urllib.request as _req

    # Circuit-open models skip network and advance the chain immediately.
    if _circuit_open(model_id):
        logger.info(f"OVERDRIVE {model_id} in cooldown -- skipping")
        return (None, True)

    import sys as _sys
    _project = _os.environ.get("PROJECT_ROOT") or _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "..", ".."))
    _scripts = _os.path.join(_project, "tools", "HME", "scripts")
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    from service_registry import service_map as _service_map, service_url as _service_url
    _services = _service_map()
    base_url = _os.environ.get("ANTHROPIC_BASE_URL", _service_url(_services["proxy"]).removesuffix("/health")).rstrip("/")

    from . import synthesis_reasoning as _sr
    timeout_secs = _sr._overdrive_timeout()
    _provider = _resolve_model_provider(model_id)
    _limit, _output_limit = _context_limits_for(model_id)
    _reserve = 4096
    _max_output = _output_limit or max(256, _limit - _reserve)
    resolved_max = min(max_tokens, _max_output)
    budget = max(0, resolved_max - _sr._OVERDRIVE_MAX_TOKENS_SLACK)
    if resolved_max < max_tokens:
        logger.info(f"OVERDRIVE {model_id} max_tokens clamped {max_tokens}->{resolved_max} for cap {_limit}")

    _drop_thinking = budget < 1024

    # Zen requires content-blocks form; Anthropic accepts both. Use blocks uniformly.
    _user_content = [{"type": "text", "text": prompt}]
    _api_model = model_id
    if _api_model.endswith("-go"):
        _api_model = _api_model[:-3]
    # Prefix with OmniRoute provider (codex uses "cx" alias, others match)
    _omni_prefix = "cx" if _provider == "codex" else (_provider or "opencode-go")
    _api_model = f"{_omni_prefix}/{_api_model}"
    payload = {
        "model": _api_model,
        "max_tokens": resolved_max,
        "messages": [{"role": "user", "content": _user_content}],
    }
    if not _drop_thinking:
        payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
        payload["temperature"] = 1.0  # Anthropic requires temperature=1.0 with thinking
    if system:
        payload["system"] = system

    # Everything goes through OmniRoute -- uniform compression, translation, auth.
    headers = {"Content-Type": "application/json", "anthropic-version": "2023-06-01"}
    headers["X-HME-Upstream"] = _service_url(_services["omniroute"]).removesuffix("/v1/models")

    try:
        request = _req.Request(
            f"{base_url}/v1/messages",
            data=_json.dumps(payload).encode(),
            headers=headers,
        )
        with _req.urlopen(request, timeout=timeout_secs) as resp:
            data = _json.loads(resp.read())
    except _urllib_error.HTTPError as e:
        # 429 = rate limit -- try next model in the chain.
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

    # Some upstreams wrap rate limits as HTTP 200 error payloads; treat as 429.
    if isinstance(data, dict) and data.get("type") == "error":
        err = data.get("error", {}) or {}
        is_rate = err.get("type") == "rate_limit_error"
        logger.warning(f"OVERDRIVE {model_id} error-body: {err.get('type', '?')} -- {err.get('message', '?')[:120]}")
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


def _dispatch_via_subagent(prompt: str, system: str, max_tokens: int, subagent_type: str = "general-purpose", tier: str = "E3") -> tuple[str, str] | None:
    # Priority 1: optional legacy persisted thread; falls through to direct/sentinel.
    try:
        from .agent_direct import dispatch_thread as _thread
        thread_result = _thread(prompt, tier=tier)
        if thread_result is not None:
            return (thread_result, "overdrive/thread")
    except (ImportError, AttributeError) as _thr_struct:
        logger.warning(f"thread dispatch structurally unreachable: "
                       f"{type(_thr_struct).__name__}: {_thr_struct}")
    except Exception as _thr_err:
        logger.debug(f"thread dispatch errored: {type(_thr_err).__name__}: {_thr_err}")

    # PRIORITY 2: feature-flagged ephemeral direct path (OVERDRIVE_DIRECT_AGENT=1)
    # -- spawns a fresh claude subprocess per call. No context accumulation.
    try:
        from .agent_direct import dispatch_direct as _direct
        direct_result = _direct(prompt, system, max_tokens, subagent_type=subagent_type, tier=tier)
        if direct_result:
            return (direct_result, "overdrive/direct-agent")
    except Exception as _dir_err:
        logger.debug(f"agent_direct path errored: {type(_dir_err).__name__}: {_dir_err}")

    """OVERDRIVE_VIA_SUBAGENT path: queue the prompt for an Agent tool call."""
    import json as _json
    import os as _os
    import uuid as _uuid
    from server import context as _ctx
    req_id = _uuid.uuid4().hex[:12]
    queue_dir = _os.path.join(_ctx.PROJECT_ROOT, "tmp", "hme-subagent-queue")
    _os.makedirs(queue_dir, exist_ok=True)
    # Unknown Claude Code subagent types fall back to general-purpose.
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
    # Self-instructing sentinel; thread.sid routes to persistent subagent if present
    project_root = _os.environ.get("PROJECT_ROOT", "")
    thread_sid_file = _os.path.join(project_root, "tmp", "hme-thread.sid") \
        if project_root else ""
    thread_active = bool(thread_sid_file) and _os.path.exists(thread_sid_file)
    if thread_active:
        sentinel = (
            f"\n[[HME_AGENT_TASK req_id={req_id} "
            f"prompt_file=tmp/hme-subagent-queue/{req_id}.json "
            f"subagent_type={subagent_type} mode=thread]] -> "
            f"Bash(command='i/thread send tmp/hme-subagent-queue/{req_id}.json', "
            f"description='HME reasoning for {req_id} via thread')"
        )
    else:
        sentinel = (
            f"\n[[HME_AGENT_TASK req_id={req_id} "
            f"prompt_file=tmp/hme-subagent-queue/{req_id}.json "
            f"subagent_type={subagent_type}]] -> "
            f"Agent(subagent_type='{subagent_type}', "
            f"description='HME reasoning for {req_id}', "
            f"prompt=<Read {prompt_file}>)"
        )
    logger.info(f"OVERDRIVE_VIA_SUBAGENT: queued req_id={req_id} "
                f"(prompt={len(prompt)}c, system={len(system)}c)")
    return (sentinel, "overdrive/subagent")


def _call_opus_overdrive(prompt: str, system: str, max_tokens: int,
                          chain_override: tuple[str, ...] | None = None,
                          allow_subagent: bool = True,
                          tier: str = "E3") -> tuple[str, str] | None:
    """Walk a model chain, returning the first successful response.

    Walks the resolved chain in order: on rate-limit for the current model,
    advances to the next; on any other failure (proxy down, timeout, empty
    content), returns None so the caller falls through to the cascade.

    chain_override: optional explicit (model_id, ...) tuple. MODE=5 always
    provides this via the registry resolver.

    OVERDRIVE_VIA_SUBAGENT=1 routes through Claude Code's Agent tool instead
    of direct API calls (different rate-limit bucket).

    allow_subagent: when False, force direct API even with OVERDRIVE_VIA_SUBAGENT=1.
    """
    from hme_env import ENV as _ENV_OD
    if _ENV_OD.optional("OVERDRIVE_MODE", "0") == "6":
        allow_subagent = False
    if allow_subagent and _ENV_OD.optional("OVERDRIVE_VIA_SUBAGENT", "0") == "1":
        return _dispatch_via_subagent(prompt, system, max_tokens, tier=tier)
    if chain_override is not None:
        chain = tuple((m, _label_for_model(m)) for m in chain_override)
    else:
        chain = _resolve_overdrive_chain()
    for model_id, source_label in chain:
        result, rate_limited = _try_overdrive_model(model_id, prompt, system, max_tokens)
        if result:
            return (result, source_label)
        if not rate_limited:
            # Non-rate-limit failure -- the problem is not model-specific.
            # Don't bother the next model; fall through to cascade.
            return None
        # Rate-limited (or circuit-open): move to the next model in the chain.
    # Every model in the chain rate-limited or was in cooldown.
    logger.warning("OVERDRIVE: every model in chain rate-limited -- falling through to cascade")
    return None
