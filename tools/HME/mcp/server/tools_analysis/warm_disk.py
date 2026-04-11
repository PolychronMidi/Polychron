"""Shared warm context state and disk persistence for HME warm KV context.

State dicts live here so warm_disk, synthesis_warm, and synthesis can all reference
the same mutable objects. All updates use item assignment (dict[key] = val) so
cross-module imports stay coherent without rebinding.
"""
import json as _json
import os
import logging
import time as _time

from server import context as ctx

logger = logging.getLogger("HME")

# ── Shared warm context state ─────────────────────────────────────────────────
# Imported by synthesis_warm (mutation) and synthesis (read-only reference).
_warm_ctx: dict[str, list] = {}
_warm_ctx_kb_ver: dict[str, int] = {}
_warm_ctx_ts: dict[str, float] = {}
_warm_ctx_append_count: dict = {}
_warm_ctx_baseline_tokens: dict = {}
_warm_ctx_incr_latency: dict = {}

# ── Disk persistence config ───────────────────────────────────────────────────
# Prefer tmpfs buffer (instant I/O) → fallback to project disk.
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


def _save_checkpoint(model: str):
    """Persist a GC checkpoint — used for fast recovery when main cache is stale."""
    if model not in _warm_ctx:
        return
    ckpt_file = os.path.join(_cache_dir(), f"warm-kv-checkpoint-{_model_cache_stem(model)}.json")
    try:
        data = {
            "model": model,
            "kb_ver": _warm_ctx_kb_ver.get(model, 0),
            "ts": _warm_ctx_ts.get(model, 0),
            "context_len": len(_warm_ctx[model]),
            "context": _warm_ctx[model],
        }
        with open(ckpt_file, "w") as f:
            _json.dump(data, f)
        logger.info(f"warm checkpoint SAVED: {model} ({len(_warm_ctx[model])} tokens, kb_ver={data['kb_ver']})")
    except Exception as e:
        logger.warning(f"warm checkpoint save failed: {model}: {e}")


def _try_checkpoint_recovery(model: str) -> bool:
    """Load a GC checkpoint when main cache is stale — instant availability while
    a background full re-prime catches up to current kb_ver.

    Only loads if the checkpoint is within 20 kb_ver versions of current.
    """
    ckpt_file = os.path.join(_cache_dir(), f"warm-kv-checkpoint-{_model_cache_stem(model)}.json")
    if not os.path.exists(ckpt_file):
        return False
    try:
        with open(ckpt_file) as f:
            data = _json.load(f)
        ckpt_kb_ver = data.get("kb_ver", -1)
        ckpt_ctx = data.get("context", [])
        target_kb_ver = getattr(ctx, "_kb_version", 0)
        if not ckpt_ctx or len(ckpt_ctx) < 10:
            return False
        ver_gap = target_kb_ver - ckpt_kb_ver
        if ver_gap > 20 or ver_gap <= 0:
            logger.debug(f"warm checkpoint SKIP: {model} — gap {ver_gap} out of range")
            return False
        _warm_ctx[model] = ckpt_ctx
        _warm_ctx_kb_ver[model] = ckpt_kb_ver
        _warm_ctx_ts[model] = data.get("ts", 0)
        _warm_ctx_append_count[model] = 0
        _warm_ctx_baseline_tokens[model] = len(ckpt_ctx)
        logger.info(
            f"warm checkpoint RECOVERED: {model} ({len(ckpt_ctx)} tokens, "
            f"kb_ver={ckpt_kb_ver}, gap={ver_gap} — usable while re-prime catches up)"
        )
        return True
    except Exception as e:
        logger.warning(f"warm checkpoint load failed: {model}: {e}")
        return False


def _load_all_warm_caches() -> int:
    """Try to restore all model caches from disk. Returns count of successfully restored."""
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    restored = 0
    for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
        if _load_warm_cache(model):
            restored += 1
    return restored
