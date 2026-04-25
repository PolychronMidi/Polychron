"""HME warm KV context — priming, incremental updates, GC, and status.

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

logger = logging.getLogger("HME")

_lazy_prime_attempted = False
_priming_in_progress = _threading.Event()

_incremental_update_lock = _threading.Lock()

# Append count + baseline tokens for GC / drift detection (#4 and #5)
_MAX_INCREMENTAL_APPENDS = 8       # schedule GC re-prime after N incremental appends
_GC_TOKEN_GROWTH_RATIO = 0.20      # or if token count grew > 20% above full-prime baseline

# Batch debounce queue — coalesces rapid-fire learn() calls into one llama.cpp round-trip (#3)
_pending_entries: list = []
_batch_timer = None
_batch_lock = _threading.Lock()
_BATCH_DEBOUNCE_S = 3.0

# Debounce timer for background re-prime after KB removes (#2)
_reprime_timer = None
_reprime_lock = _threading.Lock()

# Rate tracking for adaptive debounce window (#3)
_queue_timestamps: list = []
_RATE_WINDOW_S = 10.0
_DEBOUNCE_LOW = 1.0    # rate < 0.5/s → fast feedback
_DEBOUNCE_HIGH = 10.0  # rate > 3/s → aggressive batching (compact/bulk)

# GPU0 VRAM prefetch throttle (#4)
_last_prefetch_ts = 0.0


def queue_incremental_update(title: str, content: str, category: str, new_kb_ver: int):
    """Queue a KB entry for batched incremental context extension.

    Debounced with adaptive window: resets timer on each call. Window stretches
    to 10s during bulk operations (>3 calls/10s) and shrinks to 1s for single
    interactive learn() calls.
    """
    global _batch_timer
    now = _time.time()
    _queue_timestamps.append(now)
    while _queue_timestamps and now - _queue_timestamps[0] > _RATE_WINDOW_S:
        _queue_timestamps.pop(0)
    rate = len(_queue_timestamps) / _RATE_WINDOW_S
    if rate > 3.0:
        debounce = _DEBOUNCE_HIGH
    elif rate < 0.5:
        debounce = _DEBOUNCE_LOW
    else:
        debounce = _BATCH_DEBOUNCE_S
    with _batch_lock:
        _pending_entries.append({
            "title": title, "content": content, "category": category, "kb_ver": new_kb_ver,
        })
        if _batch_timer is not None:
            _batch_timer.cancel()
        t = _threading.Timer(debounce, _flush_pending_entries)
        t.daemon = True
        t.start()
        _batch_timer = t
    _prefetch_gpu0_if_needed()


def queue_tombstone(entry_id: str, new_kb_ver: int):
    """Queue a tombstone marker for a removed KB entry — same mechanism as incremental add."""
    queue_incremental_update(
        title=f"REMOVED entry {entry_id}",
        content="This KB entry has been deleted — disregard it in all future analysis.",
        category="TOMBSTONE",
        new_kb_ver=new_kb_ver,
    )


def _prefetch_gpu0_if_needed():
    """No-op under llama.cpp.

    The old llamacpp flow evicted models when GPU memory got tight, so this
    function used to ping the coder to force a reload before the real
    incremental KB update landed. llama-server mmap's the GGUF and never
    evicts — the warm-prefetch is moot. Kept as a stub so callers don't break.
    """
    global _last_prefetch_ts
    _last_prefetch_ts = _time.time()


def _flush_pending_entries():
    """Flush queued KB entries into tracked warm-context metadata.

    Under the old llamacpp backend this function re-called each model with
    `context=[prior_tokens]` to append new KB content to the KV cache. llama-
    server's KV cache is internal and is reused automatically across calls
    with matching prompt prefixes (cache_prompt=true), so there is nothing
    to push. We advance kb_ver, persist metadata, and let the next real
    synthesis call warm the cache organically.
    """
    global _batch_timer
    if _priming_in_progress.is_set():
        logger.debug("incr KB flush: skipped — full prime in progress")
        return

    with _incremental_update_lock:
        with _batch_lock:
            if not _pending_entries:
                _batch_timer = None
                return
            entries = list(_pending_entries)
            _pending_entries.clear()
            _batch_timer = None

        new_kb_ver = entries[-1]["kb_ver"]
        from .synthesis_llamacpp import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        import os as _os
        _reasoner_warm = ENV.require_bool("HME_REASONER_WARM")
        _active_models = [_LOCAL_MODEL, _ARBITER_MODEL]
        if _reasoner_warm:
            _active_models.insert(1, _REASONING_MODEL)

        updated = 0
        skipped_uninitialized = 0
        for model in _active_models:
            # Peer-review iter 122: only advance the KB marker for
            # models that actually have a warm_ctx entry. Previous
            # behavior advanced the marker for every active model
            # regardless of whether priming had populated _warm_ctx[model]
            # — so a model that was never primed (or whose cache was
            # evicted / never loaded from disk) now claimed to be at
            # the new KB version despite holding no KV state. Downstream
            # `warm_context_status` then reported "fresh at kb_ver=N"
            # against an empty cache. Track skipped count separately so
            # the priming pipeline can detect models that need a cold
            # warm rather than silently treating them as live.
            if model not in _warm_ctx:
                skipped_uninitialized += 1
                continue
            _warm_ctx_kb_ver[model] = new_kb_ver
            _warm_ctx_ts[model] = _time.time()
            _warm_ctx_append_count[model] = _warm_ctx_append_count.get(model, 0) + len(entries)
            try:
                _save_warm_cache(model)
            except Exception as _save_err:
                logger.debug(f"_save_warm_cache({model}): {type(_save_err).__name__}: {_save_err}")
            updated += 1
        if skipped_uninitialized:
            logger.info(
                f"incr KB marker: skipped {skipped_uninitialized} uninitialized "
                f"model(s) — they need a cold warm before claiming kb_ver={new_kb_ver}")

        if updated > 0:
            try:
                from ..tool_cache import cache_invalidate_kb
                cache_invalidate_kb()
            except Exception as _err2:
                logger.debug(f"cache_invalidate_kb: {type(_err2).__name__}: {_err2}")
        n = len(entries)
        logger.info(
            f"incr KB marker: bumped {updated}/{len(_active_models)} models to kb_ver={new_kb_ver}"
            + (f" ({n} entries batched)" if n > 1 else "")
        )


def _check_and_schedule_gc(model: str):
    """Schedule a background full re-prime when incremental drift exceeds thresholds (#4/#5).

    Triggers when append count >= _MAX_INCREMENTAL_APPENDS OR token growth >= 20%
    above the baseline established at last full prime. Saves a checkpoint before
    rebuilding so future stale-cache loads can recover instantly.
    """
    count = _warm_ctx_append_count.get(model, 0)
    baseline = _warm_ctx_baseline_tokens.get(model, 0)
    current = len(_warm_ctx.get(model, []))
    growth = (current - baseline) / max(baseline, 1) if baseline > 0 else 0.0
    if count >= _MAX_INCREMENTAL_APPENDS or growth >= _GC_TOKEN_GROWTH_RATIO:
        logger.info(
            f"warm GC: {model} ({count} appends, {growth:.0%} token growth) "
            "— scheduling background full re-prime"
        )
        def _gc_reprime():
            _warm_ctx_append_count.pop(model, None)
            _warm_ctx_baseline_tokens.pop(model, None)
            _prime_warm_context(model, force=True)
            _save_checkpoint(model)
        _threading.Thread(target=_gc_reprime, daemon=True, name=f"HME-gc-{model}").start()


def _schedule_reprime_async(delay: float = 5.0):
    """Debounced background full re-prime — coalesces multiple KB removes into one re-prime (#2).

    Resets timer on each call so a burst of removes produces exactly one re-prime
    after delay seconds of silence.
    """
    global _reprime_timer
    with _reprime_lock:
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
        if _warm_ctx_kb_ver.get(model) == kb_ver and model in _warm_ctx:
            logger.debug(f"warm ctx already fresh: {model} (kb_ver={kb_ver})")
            return True
        if _load_warm_cache(model):
            return True
        if _try_checkpoint_recovery(model):
            return True
    logger.info(f"warm ctx priming: {model} (kb_ver={kb_ver}) — building persona...")
    try:
        persona = _gpu_persona(model)
    except Exception as e:
        logger.warning(f"warm ctx priming FAILED: {model} (_gpu_persona crashed: {type(e).__name__}: {e})")
        return False
    logger.info(f"warm ctx priming: {model} — persona built ({len(persona)} chars), sending request...")
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
        logger.info(f"warm ctx priming SKIPPED: {model} — cooldown active, will retry next cycle")
        return False
    if text_result is None and not ctx_array:
        from .synthesis_llamacpp import _interactive_event
        cause = "cancelled by interactive call" if _interactive_event.is_set() else "backend took too long"
        logger.info(f"warm ctx priming CANCELLED: {model} — {cause} ({len(persona)} char persona)")
        return False
    # A text response proves llama-server primed its cache_prompt KV.
    # llama-server doesn't expose a context[] array, so we store an
    # approximate token count derived from the persona length (≈4 chars/token).
    # This keeps warm_context_status reporting honest.
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
    logger.warning(f"warm ctx priming FAILED: {model} — no text response")
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
            return (f"VRAM TIGHT: {model} — only {min_free}MB free "
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


# Legacy alias — some callers still import _init_local_models.
_init_local_models = _init_local_models


def _prime_all_gpus() -> str:
    """Prime active models sequentially. Yields to interactive between each model.

    Sequential so each model finishes before the next starts — interactive calls
    cancel the active priming via _interactive_event and _cancellable_urlopen.
    Reasoner priming only runs when HME_REASONER_WARM=1 (default: skip — cloud handles reasoning).
    """
    if _priming_in_progress.is_set():
        logger.info("_prime_all_gpus: already running, skipping duplicate")
        return "Warm context priming already in progress"
    _priming_in_progress.set()
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
        cached = sum(1 for m in results if m in _warm_ctx and _warm_ctx_kb_ver.get(m) == getattr(ctx, "_kb_version", 0))
        parts = [f"Warm context priming ({elapsed:.1f}s, {restored} cached / {cached} fresh):"]
        for model, ok in results.items():
            ctx_len = len(_warm_ctx.get(model, []))
            parts.append(f"  {model}: {'PRIMED' if ok else 'FAILED'}" +
                         (f" ({ctx_len} ctx tokens)" if ok else ""))
        return "\n".join(parts)
    finally:
        _priming_in_progress.clear()


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
                "kb_fresh": _warm_ctx_kb_ver.get(model) == getattr(ctx, "_kb_version", 0),
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
    """Lazy warm priming — fires background thread on first synthesis call if not primed."""
    global _lazy_prime_attempted
    if model in _warm_ctx:
        return
    if _lazy_prime_attempted or _priming_in_progress.is_set():
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
