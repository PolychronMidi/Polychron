"""HME warm KV context — persona construction, priming, disk persistence, and status.

Warm context = each model's specialized persona + full KB pre-tokenized into Ollama's KV
cache via the context= array. Avoids re-tokenizing the same persona text on every call.

Disk persistence: after every successful prime, context arrays are saved to disk (tmpfs
buffer if mounted, else tools/HME/warm-context-cache/). On startup or after eviction,
cached contexts load instantly (~0ms) instead of re-priming (~30s per model).

VRAM safety: persona size is hard-capped at _MAX_PERSONA_CHARS to prevent KV cache
overflow from crashing CUDA kernels on the M40s (<600 MiB headroom per GPU). The cap
leaves headroom for inference. Failures register with ctx.register_critical_failure()
so Lifesaver surfaces them in the next tool response — never silently swallowed.
"""
import json as _json
import os
import logging
import time as _time
import threading as _threading

from server import context as ctx

logger = logging.getLogger("HME")

# Shared warm context state — imported by synthesis_ollama for context= injection
_warm_ctx: dict[str, list] = {}
_warm_ctx_kb_ver: dict[str, int] = {}
_warm_ctx_ts: dict[str, float] = {}

_lazy_prime_attempted = False
_priming_in_progress = _threading.Event()

# ── Disk persistence for KV cache snapshots ──────────────────────────────────
# Prefer tmpfs buffer (instant I/O) → fallback to project disk
_TMPFS_PATHS = ["/mnt/ollama-buffer-gpu0", "/mnt/ollama-buffer-gpu1"]
_DISK_CACHE_DIR = None  # lazily initialized

_MODEL_CACHE_NAMES = {}  # model → cache file stem, set after model constants load


def _cache_dir() -> str:
    """Return the best available cache directory — tmpfs if mounted, else disk."""
    global _DISK_CACHE_DIR
    for tp in _TMPFS_PATHS:
        if os.path.ismount(tp):
            return tp
    if _DISK_CACHE_DIR is None:
        root = getattr(ctx, "PROJECT_ROOT", "")
        _DISK_CACHE_DIR = os.path.join(root, "tools", "HME", "warm-context-cache") if root else "/tmp/hme-warm-cache"
    os.makedirs(_DISK_CACHE_DIR, exist_ok=True)
    return _DISK_CACHE_DIR


def _model_cache_stem(model: str) -> str:
    """Stable filename stem for a model (e.g. 'qwen3-coder:30b' → 'qwen3-coder-30b')."""
    return model.replace(":", "-").replace("/", "-")


def _save_warm_cache(model: str):
    """Persist one model's warm context to disk after successful prime."""
    if model not in _warm_ctx:
        return
    cache_file = os.path.join(_cache_dir(), f"warm-kv-{_model_cache_stem(model)}.json")
    try:
        data = {
            "model": model,
            "kb_ver": _warm_ctx_kb_ver.get(model, 0),
            "ts": _warm_ctx_ts.get(model, 0),
            "context_len": len(_warm_ctx[model]),
            "context": _warm_ctx[model],
        }
        with open(cache_file, "w") as f:
            _json.dump(data, f)
        logger.info(f"warm cache SAVED: {model} → {cache_file} ({len(_warm_ctx[model])} tokens)")
    except Exception as e:
        logger.warning(f"warm cache save failed: {model}: {e}")


def _load_warm_cache(model: str) -> bool:
    """Try to restore a model's warm context from disk. Returns True if cache was fresh and loaded."""
    cache_file = os.path.join(_cache_dir(), f"warm-kv-{_model_cache_stem(model)}.json")
    if not os.path.exists(cache_file):
        return False
    try:
        with open(cache_file) as f:
            data = _json.load(f)
        cached_model = data.get("model", "")
        cached_kb_ver = data.get("kb_ver", -1)
        cached_ctx = data.get("context", [])
        cached_ts = data.get("ts", 0)
        current_kb_ver = getattr(ctx, "_kb_version", 0)
        if cached_model != model:
            logger.debug(f"warm cache SKIP: model mismatch ({cached_model} != {model})")
            return False
        if cached_kb_ver != current_kb_ver:
            logger.info(f"warm cache STALE: {model} kb_ver {cached_kb_ver} != {current_kb_ver}")
            return False
        if not cached_ctx or len(cached_ctx) < 10:
            logger.debug(f"warm cache SKIP: empty context for {model}")
            return False
        _warm_ctx[model] = cached_ctx
        _warm_ctx_kb_ver[model] = cached_kb_ver
        _warm_ctx_ts[model] = cached_ts
        age_s = _time.time() - cached_ts
        logger.info(f"warm cache RESTORED: {model} ({len(cached_ctx)} tokens, {age_s:.0f}s old)")
        return True
    except Exception as e:
        logger.warning(f"warm cache load failed: {model}: {e}")
        return False


_incremental_update_lock = _threading.Lock()

# Append count + baseline tokens for GC / drift detection (#4 and #5)
_warm_ctx_append_count: dict = {}
_warm_ctx_baseline_tokens: dict = {}
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


def queue_incremental_update(title: str, content: str, category: str, new_kb_ver: int):
    """Queue a KB entry for batched incremental context extension.

    Debounced: resets timer on each call, flushes after BATCH_DEBOUNCE_S of silence.
    Multiple learn() calls within the window are coalesced into one Ollama round-trip.
    """
    global _batch_timer
    with _batch_lock:
        _pending_entries.append({
            "title": title, "content": content, "category": category, "kb_ver": new_kb_ver,
        })
        if _batch_timer is not None:
            _batch_timer.cancel()
        t = _threading.Timer(_BATCH_DEBOUNCE_S, _flush_pending_entries)
        t.daemon = True
        t.start()
        _batch_timer = t


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
        # Drain the queue INSIDE the lock — any entries added while we were waiting
        # (e.g. a third learn() call during GPU0's 17-90s VRAM reload) are included
        # in this batch instead of spawning a separate redundant flush.
        with _batch_lock:
            if not _pending_entries:
                _batch_timer = None
                return
            entries = list(_pending_entries)
            _pending_entries.clear()
            _batch_timer = None

        new_kb_ver = entries[-1]["kb_ver"]
        # Concatenate all pending entries — one Ollama call evaluates all of them at once
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
        # Restore from disk if warm contexts were wiped (e.g. hot-reload)
        if not any(m in _warm_ctx for m in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]):
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
                new_ctx = data.get("context", [])
                if new_ctx and len(new_ctx) > old_len:
                    return model, (old_len, new_ctx), "ok"
                return model, None, "no_new_ctx"
            except Exception as e:
                return model, None, e

        updated = 0
        with ThreadPoolExecutor(max_workers=3) as ex:
            futures = {
                ex.submit(_update_one, m): m
                for m in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]
            }
            for fut in _as_completed(futures):
                model, result, status = fut.result()
                if status == "ok":
                    old_len, new_ctx = result
                    _warm_ctx[model] = new_ctx
                    _warm_ctx_kb_ver[model] = new_kb_ver
                    _warm_ctx_ts[model] = _time.time()
                    _warm_ctx_append_count[model] = _warm_ctx_append_count.get(model, 0) + len(entries)
                    logger.info(
                        f"incr KB update: {model} {old_len}→{len(new_ctx)} tokens, kb_ver→{new_kb_ver}"
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
            except Exception:
                pass
        n = len(entries)
        logger.info(
            f"incr KB update: {updated}/3 models updated to kb_ver={new_kb_ver}"
            + (f" ({n} entries batched)" if n > 1 else "")
        )


def _check_and_schedule_gc(model: str):
    """Schedule a background full re-prime when incremental drift exceeds thresholds (#4/#5).

    Triggers when append count >= _MAX_INCREMENTAL_APPENDS OR token growth >= 20%
    above the baseline established at last full prime.
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
            _prime_warm_context(model)
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


def _load_all_warm_caches() -> int:
    """Try to restore all model caches from disk. Returns count of successfully restored."""
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    restored = 0
    for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
        if _load_warm_cache(model):
            restored += 1
    return restored

# Hard cap on persona size (chars). 12K chars ≈ 4K tokens — keeps prompt eval under
# ~30s on M40, so interactive cancellation (via socket timeout in _cancellable_urlopen)
# limits worst-case Ollama queue wait to ~30s. Larger personas (50K) caused ~120s prompt
# eval during which Ollama ignores client disconnect, blocking interactive requests.
_MAX_PERSONA_CHARS = 12_000


def _load_src_files_for_warm(patterns: list[str], token_budget: int) -> str:
    """Load src/ file contents up to a token budget for warm context expansion.

    Files loaded smallest-first to maximize file count within budget.
    token_budget: approximate token ceiling (1 token ≈ 3 chars for mixed code+text).
    """
    import glob as _glob
    char_budget = token_budget * 3  # conservative: mixed code+text averages ~3 chars/token
    candidates = []
    for pattern in patterns:
        for fpath in _glob.glob(os.path.join(ctx.PROJECT_ROOT, pattern), recursive=True):
            if "index.js" in os.path.basename(fpath) or "__pycache__" in fpath:
                continue
            try:
                candidates.append((os.path.getsize(fpath), fpath))
            except Exception:
                pass
    candidates.sort()
    parts = []
    used = 0
    for size, fpath in candidates:
        if used >= char_budget:
            break
        try:
            content = open(fpath, encoding="utf-8", errors="ignore").read()
            rel = fpath.replace(ctx.PROJECT_ROOT + "/", "")
            entry = f"\n// --- {rel} ---\n{content}\n"
            if used + len(entry) > char_budget:
                entry = entry[:char_budget - used]
            parts.append(entry)
            used += len(entry)
        except Exception:
            pass
    return "".join(parts)


def _gpu_persona(model: str) -> str:
    """Build model-specialized warm persona. GPU0=extractor, GPU1=reasoner, arbiter=hallucination guard."""
    import glob as _glob
    # Import model constants from synthesis_ollama to avoid circular imports
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    from .synthesis_config import _THINK_SYSTEM

    full_kb = ""
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        full_kb = "\n".join(
            f"  [{k.get('category','')}] {k.get('title','')}: {k.get('content','')[:300]}"
            for k in all_kb
        )
    except Exception:
        pass

    _modules = []
    try:
        _cl_files = _glob.glob(
            os.path.join(ctx.PROJECT_ROOT, "src", "crossLayer", "**", "*.js"), recursive=True
        )
        _modules = sorted(set(
            os.path.basename(f).replace(".js", "") for f in _cl_files
            if not os.path.basename(f).startswith("index")
        ))
    except Exception:
        pass
    modules_str = ", ".join(_modules) if _modules else "(unavailable)"

    if model == _LOCAL_MODEL:
        base = (
            "You are the code extractor for Polychron, a self-evolving alien generative music "
            "system with 19 hypermeta controllers and 26 cross-layer modules. "
            "Your role: extract FACTS. File paths (src/crossLayer/...), signal fields, "
            "correlation values, coupling dimensions, bridge status (VIRGIN/PARTIAL/SATURATED). "
            "Antagonism bridges couple BOTH modules of a negatively-correlated pair to the "
            "SAME signal with OPPOSING effects. Never reason or opine — output raw data only.\n"
            "Real crossLayer modules: " + modules_str + ".\n\n"
            "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
        )
        _src_char_budget = max(1000, _MAX_PERSONA_CHARS - len(base) - 100)
        _src_token_budget = _src_char_budget // 3
        src = _load_src_files_for_warm([
            "src/crossLayer/**/*.js",
            "src/conductor/**/*.js",
            "src/fx/**/*.js",
        ], _src_token_budget)
        return (base + "\n\n// ===== SOURCE FILES =====\n" + src)[:_MAX_PERSONA_CHARS]

    if model == _ARBITER_MODEL:
        _signal_fields = []
        try:
            import re as _re
            _l0_files = _glob.glob(
                os.path.join(ctx.PROJECT_ROOT, "src", "conductor", "signal", "**", "*.js"),
                recursive=True
            )
            for _f in _l0_files[:10]:
                try:
                    _txt = open(_f).read(4000)
                    _signal_fields += _re.findall(r"'([a-z][a-zA-Z]+)'", _txt)[:5]
                except Exception:
                    pass
            _signal_fields = sorted(set(_signal_fields))[:40]
        except Exception:
            pass
        if not _signal_fields:
            _signal_fields = ["contourShape", "counterpoint", "thematicDensity",
                              "tessituraPressure", "intervalFreshness", "density",
                              "complexity", "biasStrength", "densitySurprise",
                              "hotspots", "complexityEma"]
        # Arbiter only needs module/field lists for hallucination detection — not full KB
        arb_base = (
            "You are the arbiter for Polychron, a self-evolving alien generative music system. "
            "Your role: compare two independent code analyses and detect contradictions, "
            "hallucinated module names, and overlooked facts. "
            "Real crossLayer modules: " + modules_str + ". "
            "Known signal fields: " + ", ".join(_signal_fields) + ". "
            "If an analysis cites a module or field NOT in these lists, flag it."
        )
        _arbiter_cap = min(_MAX_PERSONA_CHARS, 4_000)
        _src_char_budget = max(500, _arbiter_cap - len(arb_base) - 100)
        _src_token_budget = _src_char_budget // 3
        src = _load_src_files_for_warm([
            "scripts/pipeline/*.js",
            "src/conductor/melodic/*.js",
            "src/crossLayer/structure/**/*.js",
        ], _src_token_budget)
        return (arb_base + "\n\n// ===== PIPELINE SCRIPTS =====\n" + src)[:_arbiter_cap]

    # Reasoner persona: full KB + module list
    rsn_base = (
        _THINK_SYSTEM + "\n\n"
        "Synthesize facts into actionable insights about musical effects, coupling patterns, "
        "and evolution strategy. Cite specific file paths and signal fields. Never invent "
        "module names not in this list: " + modules_str + ".\n\n"
        "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
    )
    _src_char_budget = max(1000, _MAX_PERSONA_CHARS - len(rsn_base) - 100)
    _src_token_budget = _src_char_budget // 3
    src = _load_src_files_for_warm([
        "src/conductor/signal/**/*.js",
        "src/crossLayer/**/*.js",
        "src/composers/**/*.js",
    ], _src_token_budget)
    return (rsn_base + "\n\n// ===== SOURCE FILES =====\n" + src)[:_MAX_PERSONA_CHARS]


def _prime_warm_context(model: str) -> bool:
    """Prime warm KV context for a model. Background priority, skips if KB unchanged.
    Tries disk cache first (instant) before falling back to Ollama prime (~30s)."""
    from .synthesis_ollama import _local_think, _THINK_SYSTEM
    kb_ver = getattr(ctx, "_kb_version", 0)
    if _warm_ctx_kb_ver.get(model) == kb_ver and model in _warm_ctx:
        logger.debug(f"warm ctx already fresh: {model} (kb_ver={kb_ver})")
        return True
    # Try disk cache before expensive Ollama prime
    if _load_warm_cache(model):
        return True
    logger.info(f"warm ctx priming: {model} (kb_ver={kb_ver}) — building persona...")
    try:
        persona = _gpu_persona(model)
    except Exception as e:
        logger.warning(f"warm ctx priming FAILED: {model} (_gpu_persona crashed: {type(e).__name__}: {e})")
        return False
    logger.info(f"warm ctx priming: {model} — persona built ({len(persona)} chars), sending Ollama request...")
    result = _local_think(
        persona + "\n\nI understand this codebase context. Ready.",
        max_tokens=8, model=model, priority="background",
        temperature=0.0, return_context=True,
    )
    # _local_think returns (text, ctx_array) with return_context=True.
    # Cooldown-refused: (_COOLDOWN_REFUSED, []). Background timeout: (None, []).
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
        cause = "cancelled by interactive call" if _ollama_interactive.is_set() else "Ollama took too long"
        logger.info(f"warm ctx priming CANCELLED: {model} — {cause} ({len(persona)} char persona)")
        return False
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
        ctx = m.get("context_length", 0)
        if size_vram == 0:
            return None
        # Query GPU total via nvidia-smi for the instance's GPU
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return None
        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        # Find the GPU this model is on by checking which has the least free memory
        min_free = None
        for line in lines:
            parts = line.split(",")
            if len(parts) == 2:
                total_mb, free_mb = int(parts[0].strip()), int(parts[1].strip())
                if min_free is None or free_mb < min_free:
                    min_free = free_mb
        if min_free is not None and min_free < min_headroom_mb:
            return (f"VRAM TIGHT: {model} ctx={ctx} — only {min_free}MB free "
                    f"(need {min_headroom_mb}MB). KV cache may be in RAM, crippling speed.")
    except Exception:
        return None
    return None


def _init_ollama_models() -> str:
    """Explicitly load all three models to their correct devices at startup.

    Load order: GPU0 (extractor) → GPU1 (reasoner) → CPU (arbiter).
    Uses keep_alive=-1 so models stay resident. Yields to interactive between each model.
    Post-load: VRAM headroom check warns if KV cache is spilling to RAM.
    """
    import urllib.request as _req
    import json as _json
    import time as _t
    from .synthesis_ollama import (
        _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
        _KEEP_ALIVE, _NUM_CTX_30B, _NUM_CTX_4B, _url_for,
        _ollama_background_yield,
    )
    models_config = [
        (_LOCAL_MODEL,     {"num_predict": 1, "num_ctx": _NUM_CTX_30B}),
        (_REASONING_MODEL, {"num_predict": 1, "num_ctx": _NUM_CTX_30B}),
        (_ARBITER_MODEL,   {"num_predict": 1, "num_ctx": _NUM_CTX_4B}),
    ]
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
            except Exception:
                pass
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
    """Prime all three models sequentially. Yields to interactive between each model.

    Sequential so each model finishes before the next starts — interactive calls
    cancel the active priming via _ollama_interactive and _cancellable_urlopen.
    """
    if _priming_in_progress.is_set():
        logger.info("_prime_all_gpus: already running, skipping duplicate")
        return "Warm context priming already in progress"
    _priming_in_progress.set()
    try:
        from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        results = {}
        # Fast path: try restoring all from disk cache first
        restored = _load_all_warm_caches()
        if restored == 3:
            for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
                results[model] = True
            parts = [f"Warm context restored from cache (0.0s, all 3 models):"]
            for model in results:
                ctx_len = len(_warm_ctx.get(model, []))
                parts.append(f"  {model}: CACHED ({ctx_len} ctx tokens)")
            return "\n".join(parts)
        # Slow path: prime any models not restored from cache
        t0 = _time.time()
        for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
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
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    from .synthesis_session import session_state_counts
    now = _time.time()
    status = {}
    for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
        if model in _warm_ctx:
            cache_file = os.path.join(_cache_dir(), f"warm-kv-{_model_cache_stem(model)}.json")
            status[model] = {
                "primed": True, "tokens": len(_warm_ctx[model]),
                "age_s": round(now - _warm_ctx_ts.get(model, 0), 1),
                "kb_fresh": _warm_ctx_kb_ver.get(model) == getattr(ctx, "_kb_version", 0),
                "disk_cached": os.path.exists(cache_file),
                "cache_backend": "tmpfs" if any(os.path.ismount(tp) for tp in _TMPFS_PATHS) else "disk",
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
    _lazy_prime_attempted = True
    def _bg():
        global _lazy_prime_attempted
        from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        try:
            ok0 = _prime_warm_context(_LOCAL_MODEL)
            ok1 = _prime_warm_context(_REASONING_MODEL)
            ok2 = _prime_warm_context(_ARBITER_MODEL)
            if not any([ok0, ok1, ok2]):
                _lazy_prime_attempted = False
                logger.info("lazy warm priming: all failed, will retry on next synthesis call")
        except Exception as _e:
            _lazy_prime_attempted = False
            logger.info(f"lazy warm priming background thread failed: {type(_e).__name__}: {_e}")
    _threading.Thread(target=_bg, daemon=True).start()
    logger.info("lazy warm context priming started (background)")
