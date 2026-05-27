"""HME warm KV context -- priming, incremental updates, GC, and status.

Warm context = each model's specialized persona + full KB pre-tokenized into llama.cpp's KV
cache via the context= array. Avoids re-tokenizing the same persona text on every call.

Disk persistence and shared state live in warm_disk.py.
Persona construction lives in warm_persona.py.
"""
import json as _json
import os
import logging
import time as _time
import threading as _threading

from server import context as ctx
from hme_env import ENV
from ..warm_disk import (
    _warm_ctx, _warm_ctx_kb_ver, _warm_ctx_ts,
    _warm_ctx_append_count, _warm_ctx_baseline_tokens, _warm_ctx_incr_latency,
    _cache_dir, _model_cache_stem, _save_warm_cache, _load_warm_cache,
    _save_checkpoint, _try_checkpoint_recovery, _load_all_warm_caches,
)
from ..warm_persona import _MAX_PERSONA_CHARS, _gpu_persona  # noqa: F401

# synthesis_warm imports US at line 245 -- top-level back-import would
def _warm_ctx_fresh_p(model):
    from . import synthesis_warm as _sw; return _sw._warm_ctx_fresh_p(model)

logger = logging.getLogger("HME")


# Pattern D fix (peer-review iter 131): the prior "is this warm cache


def _schedule_reprime_async(delay: float = 5.0):
    """Debounced background full re-prime -- coalesces multiple KB removes into one re-prime (#2).

    Resets timer on each call so a burst of removes produces exactly one re-prime
    after delay seconds of silence.
    """
    global _reprime_timer
    from . import synthesis_warm as _sw
    with _sw._reprime_lock:
        if _reprime_timer is not None:
            _reprime_timer.cancel()
        def _do_reprime():
            logger.info("warm re-prime: background re-prime after KB removes")
            _prime_all_gpus()
        t = _threading.Timer(delay, _do_reprime)
        t.daemon = True
        t.start()
        _reprime_timer = t


def _prime_warm_context(model: str, force: bool = False) -> bool:
    """Prime warm KV context for a model. Background priority, skips if KB unchanged.
    Tries disk cache first (instant) before falling back to a prime request (~30s).
    force=True: skip freshness check and rebuild from persona (used by GC to clean drift).

    llama-server holds KV internally via cache_prompt=true. A successful
    persona response is the priming signal; we store a sentinel token list
    (sized to the persona) so downstream warm_context_status reports primed.
    """
    from .synthesis_inference import _local_think
    kb_ver = getattr(ctx, "_kb_version", 0)
    if not force:
        # Pattern D: file-mtime check rather than kb_ver attribute
        if _warm_ctx_fresh_p(model):
            logger.debug(f"warm ctx already fresh: {model} (kb_ver={kb_ver})")
            return True
        if _load_warm_cache(model):
            return True
        if _try_checkpoint_recovery(model):
            return True
    logger.info(f"warm ctx priming: {model} (kb_ver={kb_ver}) -- building persona...")
    try:
        persona = _gpu_persona(model)
    except Exception as e:
        logger.warning(f"warm ctx priming FAILED: {model} (_gpu_persona crashed: {type(e).__name__}: {e})")
        return False
    logger.info(f"warm ctx priming: {model} -- persona built ({len(persona)} chars), sending request...")
    result = _local_think(
        persona + "\n\nI understand this codebase context. Ready.",
        max_tokens=8, model=model, priority="background",
        temperature=0.0, return_context=True,
    )
    from .synthesis_llamacpp import _COOLDOWN_REFUSED
    if isinstance(result, tuple):
        text_result, ctx_array = result
    else:
        text_result, ctx_array = result, None
    if text_result == _COOLDOWN_REFUSED:
        logger.info(f"warm ctx priming SKIPPED: {model} -- cooldown active, will retry next cycle")
        return False
    if text_result is None and not ctx_array:
        from .synthesis_llamacpp import _interactive_event
        cause = "cancelled by interactive call" if _interactive_event.is_set() else "backend took too long"
        logger.info(f"warm ctx priming CANCELLED: {model} -- {cause} ({len(persona)} char persona)")
        return False
    # A text response proves llama-server primed its cache_prompt KV.
    if text_result is not None:
        approx_tokens = max(1, len(persona) // 4)
        _warm_ctx[model] = [0] * approx_tokens
        _warm_ctx_kb_ver[model] = kb_ver
        _warm_ctx_ts[model] = _time.time()
        _warm_ctx_append_count[model] = 0
        _warm_ctx_baseline_tokens[model] = approx_tokens
        logger.info(
            f"warm ctx PRIMED: {model} (~{approx_tokens} tokens via cache_prompt, kb_ver={kb_ver})"
        )
        _save_warm_cache(model)
        return True
    logger.warning(f"warm ctx priming FAILED: {model} -- no text response")
    return False


def _check_vram_headroom(model: str, url: str, min_headroom_mb: int = 800) -> str | None:
    """Post-load VRAM check. Returns warning string if headroom is dangerously low."""
    import urllib.request as _req
    import json as _json
    try:
        ps_url = url.rsplit("/api/", 1)[0] + "/api/ps"
        with _req.urlopen(ps_url, timeout=5) as resp:
            data = _json.loads(resp.read())
        models = data.get("models", [])
        if not models:
            return None
        m = models[0]
        size_vram = m.get("size_vram", 0)
        if size_vram == 0:
            return None
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return None
        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        min_free = None
        for line in lines:
            parts = line.split(",")
            if len(parts) == 2:
                total_mb, free_mb = int(parts[0].strip()), int(parts[1].strip())
                if min_free is None or free_mb < min_free:
                    min_free = free_mb
        if min_free is not None and min_free < min_headroom_mb:
            return (f"VRAM TIGHT: {model} -- only {min_free}MB free "
                    f"(need {min_headroom_mb}MB). KV cache may be in RAM, crippling speed.")
    except Exception as _err:
        logger.debug(f"unnamed-except synthesis_warm.py:404: {type(_err).__name__}: {_err}")
        return None
    return None


def _init_local_models() -> str:
    """Verify llama-server instances are healthy at startup.

    llama-server instances (arbiter on Vulkan1, coder on Vulkan2) are spawned
    by llamacpp_daemon (sole authority); this function is a health probe
    that does NOT touch any legacy inference API. It reports readiness to the
    shim and fires a CRITICAL LIFESAVER if an instance is unreachable.
    """
    import urllib.request as _req
    import json as _json
    import time as _t
    import os as _os
    if _os.path.exists(ENV.require("HME_TRAINING_LOCK")):
        logger.info("_init_local_models: training lock present, skipping health probe")
        return "training_locked"
    from .synthesis_llamacpp import _LOCAL_MODEL, _ARBITER_MODEL

    results = {}
    failures = 0
    targets = [
        (_LOCAL_MODEL,   ENV.require("HME_LLAMACPP_CODER_URL")),
        (_ARBITER_MODEL, ENV.require("HME_LLAMACPP_ARBITER_URL")),
    ]
    for model, base in targets:
        t0 = _t.time()
        try:
            req = _req.Request(f"{base}/health")
            with _req.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                try:
                    data = _json.loads(body)
                except ValueError:
                    data = {}
                if resp.status == 200 and data.get("status") == "ok":
                    elapsed = _t.time() - t0
                    results[model] = f"OK ({elapsed:.2f}s llamacpp)"
                    logger.info(f"model init: {model} ready at {base}")
                else:
                    results[model] = f"FAILED: llama-server {base} status={data.get('status') or resp.status}"
                    ctx.register_critical_failure(
                        f"model_init({model})",
                        f"llama-server {base} not healthy: {body[:120]}",
                    )
                    failures += 1
        except Exception as e:
            # silent-ok: optional fallback path.
            results[model] = f"FAILED: {type(e).__name__}: {e}"
            ctx.register_critical_failure(
                f"model_init({model})",
                f"llama-server {base} unreachable: {type(e).__name__}: {e}",
            )
            failures += 1
    summary = "Model init (llamacpp): " + "; ".join(f"{m.split(':')[0]}={r}" for m, r in results.items())
    if failures:
        summary += f" ({failures} FAILED)"
    return summary


# Legacy alias -- some callers still import _init_local_models.
_init_local_models = _init_local_models


def _prime_all_gpus() -> str:
    """Prime active models sequentially. Yields to interactive between each model.

    Sequential so each model finishes before the next starts -- interactive calls
    cancel the active priming via _interactive_event and _cancellable_urlopen.
    Reasoner priming only runs when HME_REASONER_WARM=1 (default: skip -- cloud handles reasoning).
    """
    from . import synthesis_warm as _sw
    if _sw._priming_in_progress.is_set():
        logger.info("_prime_all_gpus: already running, skipping duplicate")
        return "Warm context priming already in progress"
    _sw._priming_in_progress.set()
    try:
        import os as _os
        from .synthesis_llamacpp import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        _reasoner_warm = ENV.require_bool("HME_REASONER_WARM")
        active_models = [_LOCAL_MODEL, _ARBITER_MODEL]
        if _reasoner_warm:
            active_models.insert(1, _REASONING_MODEL)
        n = len(active_models)
        results = {}
        restored = _load_all_warm_caches()
        if restored >= n:
            for model in active_models:
                results[model] = True
            parts = [f"Warm context restored from cache (0.0s, {n} models):"]
            for model in results:
                ctx_len = len(_warm_ctx.get(model, []))
                parts.append(f"  {model}: CACHED ({ctx_len} ctx tokens)")
            return "\n".join(parts)
        t0 = _time.time()
        for model in active_models:
            results[model] = _prime_warm_context(model)
        elapsed = _time.time() - t0
        cached = sum(1 for m in results if _warm_ctx_fresh_p(m))
        parts = [f"Warm context priming ({elapsed:.1f}s, {restored} cached / {cached} fresh):"]
        for model, ok in results.items():
            ctx_len = len(_warm_ctx.get(model, []))
            parts.append(f"  {model}: {'PRIMED' if ok else 'FAILED'}" +
                         (f" ({ctx_len} ctx tokens)" if ok else ""))
        return "\n".join(parts)
    finally:
        _sw._priming_in_progress.clear()


def warm_context_status() -> dict:
    """Health dict of warm contexts for selftest."""
    import os as _os
    from .synthesis_llamacpp import _LOCAL_MODEL, _REASONING_MODEL, _refresh_arbiter
    _refresh_arbiter()
    from .synthesis_llamacpp import _ARBITER_MODEL
    from .synthesis_session import session_state_counts
    from ..warm_disk import _TMPFS_PATHS
    _reasoner_warm = ENV.require_bool("HME_REASONER_WARM")
    _active = [_LOCAL_MODEL, _ARBITER_MODEL]
    if _reasoner_warm:
        _active.insert(1, _REASONING_MODEL)
    now = _time.time()
    status = {}
    for model in _active:
        if model in _warm_ctx:
            cache_file = os.path.join(_cache_dir(), f"warm-kv-{_model_cache_stem(model)}.json")
            baseline = _warm_ctx_baseline_tokens.get(model, 0)
            current = len(_warm_ctx[model])
            growth = round((current - baseline) / max(baseline, 1), 3) if baseline > 0 else 0.0
            ckpt_file = os.path.join(_cache_dir(), f"warm-kv-checkpoint-{_model_cache_stem(model)}.json")
            status[model] = {
                "primed": True, "tokens": current,
                "age_s": round(now - _warm_ctx_ts.get(model, 0), 1),
                "kb_fresh": _warm_ctx_fresh_p(model),
                "disk_cached": os.path.exists(cache_file),
                "checkpoint": os.path.exists(ckpt_file),
                "cache_backend": "tmpfs" if any(os.path.ismount(tp) for tp in _TMPFS_PATHS) else "disk",
                "append_count": _warm_ctx_append_count.get(model, 0),
                "baseline_tokens": baseline,
                "token_growth": growth,
                "last_incr_latency_s": _warm_ctx_incr_latency.get(model),
            }
        else:
            status[model] = {"primed": False}
    status.update(session_state_counts())
    return status


def ensure_warm(model: str):
    """Lazy warm priming -- fires background thread on first synthesis call if not primed."""
    global _lazy_prime_attempted
    if model in _warm_ctx:
        return
    from . import synthesis_warm as _sw
    if _lazy_prime_attempted or _sw._priming_in_progress.is_set():
        return
    import os as _os
    if _os.path.exists(ENV.require("HME_TRAINING_LOCK")):
        logger.info("ensure_warm: training lock present, skipping warm priming")
        return
    _lazy_prime_attempted = True
    def _bg():
        global _lazy_prime_attempted
        import os as _os
        from .synthesis_llamacpp import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        _reasoner_warm = ENV.require_bool("HME_REASONER_WARM")
        try:
            ok0 = _prime_warm_context(_LOCAL_MODEL)
            ok1 = _prime_warm_context(_REASONING_MODEL) if _reasoner_warm else False
            ok2 = _prime_warm_context(_ARBITER_MODEL)
            if not any([ok0, ok1, ok2]):
                _lazy_prime_attempted = False
                logger.info("lazy warm priming: all failed, will retry on next synthesis call")
        except Exception as _e:
            _lazy_prime_attempted = False
            logger.info(f"lazy warm priming background thread failed: {type(_e).__name__}: {_e}")
    _threading.Thread(target=_bg, daemon=True).start()
    logger.info("lazy warm context priming started (background)")
