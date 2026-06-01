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

logger = logging.getLogger("HME")


# Pattern D fix (peer-review iter 131): the prior "is this warm cache
def _warm_ctx_fresh_p(model: str) -> bool:
    """True if model's warm cache is fresh against the KB stores on disk.

    Compares `_warm_ctx_ts[model]` (when the cache was last touched)
    to the max mtime of the KB Lance files. Cache is fresh iff it was
    touched at or after the most recent KB write. Falls back to the
    legacy `_kb_version` attribute when KB files are unavailable.
    """
    if model not in _warm_ctx:
        return False
    kb_root = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "KB")
    kb_max_mtime = 0.0
    for name in ("knowledge.lance", "code_chunks.lance", "symbols.lance"):
        p = os.path.join(kb_root, name)
        try:
            if os.path.exists(p):
                mt = os.path.getmtime(p)
                if mt > kb_max_mtime:
                    kb_max_mtime = mt
        except OSError:
            pass  # silent-ok: best-effort fs op
    if kb_max_mtime == 0.0:
        # Fallback: legacy attr check when KB files unavailable
        return _warm_ctx_kb_ver.get(model) == getattr(ctx, "_kb_version", 0)
    return _warm_ctx_ts.get(model, 0.0) >= kb_max_mtime

_lazy_prime_attempted = False
_priming_in_progress = _threading.Event()

_incremental_update_lock = _threading.Lock()

# Append count + baseline tokens for GC / drift detection (#4 and #5)
_MAX_INCREMENTAL_APPENDS = 8       # schedule GC re-prime after N incremental appends
_GC_TOKEN_GROWTH_RATIO = 0.20      # or if token count grew > 20% above full-prime baseline

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
_DEBOUNCE_LOW = 1.0    # rate < 0.5/s -> fast feedback
_DEBOUNCE_HIGH = 10.0  # rate > 3/s -> aggressive batching (compact/bulk)

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
    """Queue a tombstone marker for a removed KB entry -- same mechanism as incremental add."""
    queue_incremental_update(
        title=f"REMOVED entry {entry_id}",
        content="This KB entry has been deleted -- disregard it in all future analysis.",
        category="TOMBSTONE",
        new_kb_ver=new_kb_ver,
    )


def _prefetch_gpu0_if_needed():
    """No-op under llama.cpp.

    The old llamacpp flow evicted models when GPU memory got tight, so this
    function used to ping the coder to force a reload before the real
    incremental KB update landed. llama-server mmap's the GGUF and never
    evicts -- the warm-prefetch is moot. Kept as a stub so callers don't break.
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
        logger.debug("incr KB flush: skipped -- full prime in progress")
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
                f"model(s) -- they need a cold warm before claiming kb_ver={new_kb_ver}")

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
            "-- scheduling background full re-prime"
        )
        def _gc_reprime():
            _warm_ctx_append_count.pop(model, None)
            _warm_ctx_baseline_tokens.pop(model, None)
            _prime_warm_context(model, force=True)
            _save_checkpoint(model)
        _threading.Thread(target=_gc_reprime, daemon=True, name=f"HME-gc-{model}").start()



# Re-exports -- prime/reprime extracted.
from .synthesis_warm_prime import (  # noqa: F401, E402
    _schedule_reprime_async, _prime_warm_context,
    _check_vram_headroom, _init_local_models, _prime_all_gpus,
    warm_context_status, ensure_warm,
)
