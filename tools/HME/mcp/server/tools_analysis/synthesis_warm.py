"""HME warm KV context — priming, incremental updates, GC, and status.

Warm context = each model's specialized persona + full KB pre-tokenized into Ollama's KV
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
from .warm_disk import (
    _warm_ctx, _warm_ctx_kb_ver, _warm_ctx_ts,
    _warm_ctx_append_count, _warm_ctx_baseline_tokens, _warm_ctx_incr_latency,
    _cache_dir, _model_cache_stem, _save_warm_cache, _load_warm_cache,
    _save_checkpoint, _try_checkpoint_recovery, _load_all_warm_caches,
)
from .warm_persona import _MAX_PERSONA_CHARS, _gpu_persona  # noqa: F401

logger = logging.getLogger("HME")

_lazy_prime_attempted = False
_priming_in_progress = _threading.Event()

_incremental_update_lock = _threading.Lock()

# Append count + baseline tokens for GC / drift detection (#4 and #5)
_MAX_INCREMENTAL_APPENDS = 8       # schedule GC re-prime after N incremental appends
_GC_TOKEN_GROWTH_RATIO = 0.20      # or if token count grew > 20% above full-prime baseline

# Batch debounce queue — coalesces rapid-fire learn() calls into one Ollama round-trip (#3)
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
    """Poke GPU0 so it starts VRAM reload during the debounce window.

    If GPU0 was evicted, this ping forces Ollama to reload it before the real
    incremental update arrives. By the time the debounce fires, GPU0 is hot.
    Throttled to max once per 30s to avoid spamming.
    """
    global _last_prefetch_ts
    import os as _os
    if _os.path.exists(_os.environ.get("HME_TRAINING_LOCK", "/home/jah/Polychron/tmp/hme-training.lock")):
        return
    now = _time.time()
    if now - _last_prefetch_ts < 30.0:
        return
    _last_prefetch_ts = now
    def _ping():
        try:
            import urllib.request as _req
            from .synthesis_ollama import _LOCAL_MODEL, _url_for, _KEEP_ALIVE
            payload = _json.dumps({
                "model": _LOCAL_MODEL, "prompt": "", "stream": False,
                "keep_alive": _KEEP_ALIVE, "options": {"num_predict": 0},
            }).encode()
            req = _req.Request(
                _url_for(_LOCAL_MODEL), data=payload,
                headers={"Content-Type": "application/json"},
            )
            with _req.urlopen(req, timeout=90) as resp:
                resp.read()
        except Exception as _err1:
            logger.debug(f"resp.read: {type(_err1).__name__}: {_err1}")
    _threading.Thread(target=_ping, daemon=True, name="HME-gpu0-prefetch").start()


def _flush_pending_entries():
    """Flush queued KB entries to all warm contexts — GPU0 and GPU1 updated in parallel (#1).

    Builds one concatenated prompt from all pending entries and sends a num_predict=1
    Ollama call to each model concurrently via ThreadPoolExecutor. Saves caches and
    runs GC check after each successful update.
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
        entry_text = "".join(
            f"\n\n[KB #{e['kb_ver']}] [{e['category']}] {e['title']}: {e['content'][:400]}"
            for e in entries
        )
        import urllib.request as _req
        from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
        from .synthesis_ollama import (
            _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
            _url_for, _KEEP_ALIVE, _num_ctx_for,
        )
        import os as _os
        _reasoner_warm = _os.environ.get("HME_REASONER_WARM", "0") == "1"
        _active_models = [_LOCAL_MODEL, _ARBITER_MODEL]
        if _reasoner_warm:
            _active_models.insert(1, _REASONING_MODEL)

        if not any(m in _warm_ctx for m in _active_models):
            restored = _load_all_warm_caches()
            if restored == 0:
                logger.info("incr KB flush: no warm contexts in memory or cache — skipping (will prime on next use)")
                return
            logger.info(f"incr KB flush: restored {restored} contexts from cache for update")

        # Dense 30B (GPU0) may need up to 90s to reload from VRAM eviction before eval
        _incr_timeout = {_LOCAL_MODEL: 90, _REASONING_MODEL: 45, _ARBITER_MODEL: 45}

        def _update_one(model):
            if model not in _warm_ctx:
                return model, None, "not_primed"
            if _warm_ctx_kb_ver.get(model) == new_kb_ver:
                return model, None, "already_fresh"
            old_len = len(_warm_ctx[model])
            num_ctx = _num_ctx_for(model)
            if old_len > num_ctx - 500:
                return model, None, "near_limit"
            t0 = _time.time()
            try:
                payload = _json.dumps({
                    "model": model, "prompt": entry_text, "context": _warm_ctx[model],
                    "stream": False, "keep_alive": _KEEP_ALIVE,
                    "options": {"num_predict": 1, "temperature": 0.0, "num_ctx": num_ctx},
                }).encode()
                req = _req.Request(
                    _url_for(model), data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with _req.urlopen(req, timeout=_incr_timeout.get(model, 60)) as resp:
                    data = _json.loads(resp.read())
                elapsed = _time.time() - t0
                new_ctx = data.get("context", [])
                if new_ctx and len(new_ctx) > old_len:
                    return model, (old_len, new_ctx, elapsed), "ok"
                return model, None, "no_new_ctx"
            except Exception as e:
                return model, None, e

        updated = 0
        with ThreadPoolExecutor(max_workers=len(_active_models)) as ex:
            futures = {
                ex.submit(_update_one, m): m
                for m in _active_models
            }
            for fut in _as_completed(futures):
                model, result, status = fut.result()
                if status == "ok":
                    old_len, new_ctx, elapsed = result
                    _warm_ctx[model] = new_ctx
                    _warm_ctx_kb_ver[model] = new_kb_ver
                    _warm_ctx_ts[model] = _time.time()
                    _warm_ctx_append_count[model] = _warm_ctx_append_count.get(model, 0) + len(entries)
                    _warm_ctx_incr_latency[model] = round(elapsed, 1)
                    logger.info(
                        f"incr KB update: {model} {old_len}→{len(new_ctx)} tokens, "
                        f"kb_ver→{new_kb_ver} ({elapsed:.1f}s)"
                    )
                    _save_warm_cache(model)
                    updated += 1
                    _check_and_schedule_gc(model)
                elif status == "near_limit":
                    logger.info(f"incr KB update: {model} ctx near limit, marking stale for full re-prime")
                elif isinstance(status, Exception):
                    logger.warning(f"incr KB update: {model} failed: {type(status).__name__}: {status}")

        if updated > 0:
            try:
                from .tool_cache import cache_invalidate_kb
                cache_invalidate_kb()
            except Exception as _err2:
                logger.debug(f"cache_invalidate_kb: {type(_err2).__name__}: {_err2}")
        n = len(entries)
        logger.info(
            f"incr KB update: {updated}/{len(_active_models)} models updated to kb_ver={new_kb_ver}"
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

    Backend differences:
      - ollama: returns a context[] array of token IDs that must be round-tripped
        to warm the KV cache. We store the array in _warm_ctx.
      - llamacpp: llama-server holds KV internally via cache_prompt=true. A
        successful persona response is the priming signal; we store a sentinel
        "primed=true" token list so downstream warm_context_status reports it.
    """
    from .synthesis_ollama import _local_think, _ARBITER_BACKEND
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
    from .synthesis_ollama import _COOLDOWN_REFUSED
    if isinstance(result, tuple):
        text_result, ctx_array = result
    else:
        text_result, ctx_array = result, None
    if text_result == _COOLDOWN_REFUSED:
        logger.info(f"warm ctx priming SKIPPED: {model} — cooldown active, will retry next cycle")
        return False
    if text_result is None and not ctx_array:
        from .synthesis_ollama import _ollama_interactive
        cause = "cancelled by interactive call" if _ollama_interactive.is_set() else "backend took too long"
        logger.info(f"warm ctx priming CANCELLED: {model} — {cause} ({len(persona)} char persona)")
        return False
    # llamacpp path: a text response proves the server primed its cache_prompt KV.
    # llama-server doesn't expose context[] arrays, so store an approximate token
    # count derived from the persona length (≈4 chars/token). This keeps warm
    # context status reporting honest without forcing callers to special-case.
    if _ARBITER_BACKEND == "llamacpp" and text_result is not None and not ctx_array:
        approx_tokens = max(1, len(persona) // 4)
        _warm_ctx[model] = [0] * approx_tokens
        _warm_ctx_kb_ver[model] = kb_ver
        _warm_ctx_ts[model] = _time.time()
        _warm_ctx_append_count[model] = 0
        _warm_ctx_baseline_tokens[model] = approx_tokens
        logger.info(
            f"warm ctx PRIMED (llamacpp): {model} (~{approx_tokens} tokens via cache_prompt, kb_ver={kb_ver})"
        )
        _save_warm_cache(model)
        return True
    if ctx_array:
        _warm_ctx[model] = ctx_array
        _warm_ctx_kb_ver[model] = kb_ver
        _warm_ctx_ts[model] = _time.time()
        _warm_ctx_append_count[model] = 0
        _warm_ctx_baseline_tokens[model] = len(ctx_array)
        logger.info(f"warm ctx PRIMED: {model} ({len(ctx_array)} ctx tokens, kb_ver={kb_ver})")
        _save_warm_cache(model)
        return True
    logger.warning(
        f"warm ctx priming FAILED: {model} — text={'present' if text_result else 'None'}, "
        f"ctx_array={'present' if ctx_array else 'None'}"
    )
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


def _init_ollama_models() -> str:
    """Explicitly load models to their correct devices at startup.

    Load order: GPU0 (extractor) → GPU1 (arbiter).
    Reasoner (qwen3:30b-a3b) is NOT loaded — cloud cascade handles all reasoning calls;
    local reasoner remains as code fallback only (HME_REASONER_WARM=1 to re-enable).
    Uses keep_alive=-1 so models stay resident. Yields to interactive between each model.
    Post-load: VRAM headroom check warns if KV cache is spilling to RAM.

    When HME_ARBITER_BACKEND=llamacpp (default now), the llama-server instances
    have already loaded their models via systemd (--model flag) — this function
    becomes a health probe that does NOT touch the ollama API. Probing ollama
    ports 11434/11435/11436 on a pure llamacpp stack produces
    ConnectionRefused errors and a LIFESAVER flood (see commit that introduced
    _check_llamacpp_instances in health_topology.py).
    """
    import urllib.request as _req
    import json as _json
    import time as _t
    import os as _os
    if _os.path.exists(_os.environ.get("HME_TRAINING_LOCK", "/home/jah/Polychron/tmp/hme-training.lock")):
        logger.info("_init_ollama_models: training lock present, skipping startup load")
        return "training_locked"
    from .synthesis_ollama import (
        _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL, _ARBITER_BACKEND,
        _KEEP_ALIVE, _NUM_CTX_30B, _NUM_CTX_4B, _url_for,
        _llamacpp_url_for, _ollama_background_yield,
    )
    _reasoner_warm = _os.environ.get("HME_REASONER_WARM", "0") == "1"

    # llama-server path: probe /health on each configured llama-server URL
    # instead of forcing a model load via ollama /api/generate.
    if _ARBITER_BACKEND == "llamacpp":
        results = {}
        failures = 0
        targets = [
            (_LOCAL_MODEL,   _os.environ.get("HME_LLAMACPP_CODER_URL",   "http://127.0.0.1:8081")),
            (_ARBITER_MODEL, _os.environ.get("HME_LLAMACPP_ARBITER_URL", "http://127.0.0.1:8080")),
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
                        logger.info(f"model init (llamacpp): {model} ready at {base}")
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

    # Legacy ollama path (HME_ARBITER_BACKEND=ollama)
    models_config = [
        (_LOCAL_MODEL,   {"num_predict": 1, "num_ctx": _NUM_CTX_30B}),
        (_ARBITER_MODEL, {"num_predict": 1, "num_ctx": _NUM_CTX_4B}),
    ]
    if _reasoner_warm:
        models_config.insert(1, (_REASONING_MODEL, {"num_predict": 1, "num_ctx": _NUM_CTX_30B}))
    results = {}
    failures = 0
    for model, options in models_config:
        _ollama_background_yield()
        t0 = _t.time()
        logger.info(f"model init: loading {model} on {_url_for(model)} (options={options})...")
        payload = {"model": model, "prompt": "", "stream": False,
                   "keep_alive": _KEEP_ALIVE, "options": options}
        request = _req.Request(_url_for(model), data=_json.dumps(payload).encode(),
                               headers={"Content-Type": "application/json"})
        try:
            with _req.urlopen(request, timeout=120) as resp:
                body = resp.read()
                if resp.status >= 500:
                    err_detail = body.decode("utf-8", errors="ignore")[:200]
                    results[model] = f"FAILED: HTTP {resp.status} — {err_detail}"
                    ctx.register_critical_failure(
                        f"model_init({model})",
                        f"HTTP {resp.status}: {err_detail}",
                    )
                    failures += 1
                    continue
            elapsed = _t.time() - t0
            vram_warn = _check_vram_headroom(model, _url_for(model))
            if vram_warn:
                results[model] = f"OK ({elapsed:.1f}s) ⚠ {vram_warn}"
                ctx.register_critical_failure(
                    f"model_init({model})", vram_warn, severity="WARNING",
                )
            else:
                results[model] = f"OK ({elapsed:.1f}s)"
                logger.info(f"model init: {model} ready ({elapsed:.1f}s)")
        except _req.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="ignore")[:200]
            except Exception as _err3:
                logger.debug(f"e.read: {type(_err3).__name__}: {_err3}")
            results[model] = f"FAILED: HTTP {e.code} — {err_body or e}"
            ctx.register_critical_failure(
                f"model_init({model})",
                f"HTTP {e.code}: {err_body or e}",
            )
            failures += 1
        except Exception as e:
            results[model] = f"FAILED: {type(e).__name__}: {e}"
            ctx.register_critical_failure(
                f"model_init({model})",
                f"{type(e).__name__}: {e}",
            )
            failures += 1
    summary = "Model init: " + "; ".join(f"{m.split(':')[0]}={r}" for m, r in results.items())
    if failures:
        summary += f" ({failures} FAILED — warm priming will be skipped for failed models)"
    return summary


def _prime_all_gpus() -> str:
    """Prime active models sequentially. Yields to interactive between each model.

    Sequential so each model finishes before the next starts — interactive calls
    cancel the active priming via _ollama_interactive and _cancellable_urlopen.
    Reasoner priming only runs when HME_REASONER_WARM=1 (default: skip — cloud handles reasoning).
    """
    if _priming_in_progress.is_set():
        logger.info("_prime_all_gpus: already running, skipping duplicate")
        return "Warm context priming already in progress"
    _priming_in_progress.set()
    try:
        import os as _os
        from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        _reasoner_warm = _os.environ.get("HME_REASONER_WARM", "0") == "1"
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
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _refresh_arbiter
    _refresh_arbiter()
    from .synthesis_ollama import _ARBITER_MODEL
    from .synthesis_session import session_state_counts
    from .warm_disk import _TMPFS_PATHS
    _reasoner_warm = _os.environ.get("HME_REASONER_WARM", "0") == "1"
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
    if _os.path.exists(_os.environ.get("HME_TRAINING_LOCK", "/home/jah/Polychron/tmp/hme-training.lock")):
        logger.info("ensure_warm: training lock present, skipping warm priming")
        return
    _lazy_prime_attempted = True
    def _bg():
        global _lazy_prime_attempted
        import os as _os
        from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        _reasoner_warm = _os.environ.get("HME_REASONER_WARM", "0") == "1"
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
