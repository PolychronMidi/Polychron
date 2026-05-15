"""HME perceptual engines -- EnCodec and CLAP model inference, called by audio_analyze.

Placement contract:
  - Audio models are pinned to the audio GPU (HME_AUDIO_GPU env, default 1)
    so they predictably live next to the coder LLM rather than competing
    with the RAG stack on the arbiter GPU.
  - BOTH a GPU instance AND a CPU mirror are loaded at startup (eager),
    so dispatchers can fall back instantly when the GPU is contended or
    the model has been offloaded by the VramManager.
  - Each model registers with a shared VramManager for the audio GPU;
    under VRAM pressure (coder KV cache growing), lower-priority audio
    models are offloaded first (EnCodec before CLAP) to free room, and a
    background poller reloads them on busy->idle edges of the daemon's
    per-GPU flag.
  - Audio generations flip the daemon's per-GPU busy flag for the audio
    GPU so any coder generate concurrently scheduled there routes
    appropriately. Legacy `pick_gpu_or_cpu()` is preserved for any callers
    that need a one-off device probe.
"""
import json
import os
import logging
import threading
from contextlib import contextmanager

from server import context as ctx

logger = logging.getLogger("HME")

# Perceptual confidence starts low -- earns trust through verified accuracy
_PERCEPTUAL_CONFIDENCE = 0.15  # raised as predictions correlate with verdicts

# VramManager integration
# Single manager instance per process, covering the audio GPU.
_audio_vram: "VramManager | None" = None        # type: ignore[name-defined]
_mm_encodec = None                                # ManagedModel for EnCodec
_mm_clap = None                                   # ManagedModel for CLAP
_encodec_cpu = None                               # CPU mirror (always resident)
_clap_cpu = None                                  # CPU mirror (always resident)
_audio_lock = threading.Lock()                    # serialize audio_analyze calls
_audio_init_lock = threading.Lock()               # one-shot eager init gate
_audio_init_done = False

# Device selection -- read from central .env via ENV.require (fail-fast).
import sys as _sys_env
_mcp_dir_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _mcp_dir_env not in _sys_env.path:
    _sys_env.path.insert(0, _mcp_dir_env)
from hme_env import ENV  # noqa: E402

_AUDIO_GPU_IDX = ENV.require_int("HME_AUDIO_GPU")
_AUDIO_VULKAN = ENV.require("HME_AUDIO_VULKAN")
_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_ENCODEC_PATH = ENV.require("HME_MODEL_ENCODEC")
_CLAP_PATH = ENV.require("HME_MODEL_CLAP")


def pick_gpu_or_cpu(min_free_gb: float, label: str = "") -> str:
    """Legacy helper: return the best torch device for a model needing at
    least `min_free_gb` of free VRAM. Kept for any out-of-band probes that
    don't route through the managed model system."""
    try:
        import torch
        if torch.cuda.is_available():
            best_idx, best_free = -1, 0
            for i in range(torch.cuda.device_count()):
                free, _ = torch.cuda.mem_get_info(i)
                free_gb = free / (1024 ** 3)
                if free >= min_free_gb * (1024 ** 3) and free > best_free:
                    best_free, best_idx = free, i
            if best_idx >= 0:
                dev = f"cuda:{best_idx}"
                if label:
                    logger.info(f"{label}: {dev} ({best_free / (1024 ** 3):.1f} GB free, needed {min_free_gb:.1f} GB)")
                return dev
    except Exception as e:
        logger.warning(f"{label or 'pick_gpu'}: GPU detection failed ({e}), using CPU")
    if label:
        logger.info(f"{label}: cpu (no GPU has {min_free_gb:.1f} GB free)")
    return "cpu"


def _build_encodec(device: str):
    """Load EnCodec 24kHz from the local checkpoint in HME_MODEL_ENCODEC."""
    from encodec import EncodecModel
    import torch
    m = EncodecModel.encodec_model_24khz()
    # Override with local checkpoint so we don't hit torch hub at runtime
    state = torch.load(_ENCODEC_PATH, map_location=device, weights_only=True)
    m.load_state_dict(state)
    m.set_target_bandwidth(6.0)
    m.to(device).eval()
    return m


def _build_encodec_gpu():
    """Factory: create a fresh EnCodec instance pinned to the audio GPU.
    Called both during eager startup and when VramManager.try_reload decides
    to bring EnCodec back after being offloaded."""
    return _build_encodec(f"cuda:{_AUDIO_GPU_IDX}")


def _build_encodec_cpu():
    return _build_encodec("cpu")


def _build_clap(device: str):
    """Load CLAP from the local checkpoint in HME_MODEL_CLAP."""
    import laion_clap
    m = laion_clap.CLAP_Module(
        enable_fusion=False, amodel='HTSAT-tiny',
        device=device,
    )
    m.load_ckpt(_CLAP_PATH)
    return m


def _build_clap_gpu():
    return _build_clap(f"cuda:{_AUDIO_GPU_IDX}")


def _build_clap_cpu():
    return _build_clap("cpu")


def _ensure_audio_initialized() -> None:
    """Eager-load GPU + CPU instances for EnCodec and CLAP on first call,
    register them with a VramManager for the audio GPU, and start a reload
    poller. Idempotent under _audio_init_lock."""
    global _audio_vram, _mm_encodec, _mm_clap, _encodec_cpu, _clap_cpu
    global _audio_init_done
    with _audio_init_lock:
        if _audio_init_done:
            return
        try:
            import torch
            if not torch.cuda.is_available():
                logger.warning("audio init: no CUDA -- both GPU and CPU mirrors will load to CPU")
        except Exception as _e:
            logger.warning(f"audio init: torch unavailable ({_e})")

        # Load CPU mirrors first (always resident, lower failure risk).
        try:
            _encodec_cpu = _build_encodec_cpu()
            logger.info("EnCodec CPU mirror ready.")
        except Exception as _e:
            logger.warning(f"EnCodec CPU mirror load failed: {type(_e).__name__}: {_e}")
        try:
            _clap_cpu = _build_clap_cpu()
            logger.info("CLAP CPU mirror ready.")
        except Exception as _e:
            logger.warning(f"CLAP CPU mirror load failed: {type(_e).__name__}: {_e}")

        # Load GPU instances (may fail if audio GPU is too tight).
        encodec_gpu = None
        clap_gpu = None
        try:
            encodec_gpu = _build_encodec_gpu()
            logger.info(f"EnCodec GPU loaded on cuda:{_AUDIO_GPU_IDX}.")
        except Exception as _e:
            logger.warning(f"EnCodec GPU load failed: {type(_e).__name__}: {_e} -- CPU-only")
        try:
            clap_gpu = _build_clap_gpu()
            logger.info(f"CLAP GPU loaded on cuda:{_AUDIO_GPU_IDX}.")
        except Exception as _e:
            logger.warning(f"CLAP GPU load failed: {type(_e).__name__}: {_e} -- CPU-only")

        # Register with VramManager
        try:
            import sys as _sys
            # vram_manager.py lives one level up from server/ (in tools/HME/service/)
            _mcp_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            if _mcp_dir not in _sys.path:
                _sys.path.insert(0, _mcp_dir)
            from vram_manager import VramManager, ManagedModel, start_reload_poller
            _audio_vram = VramManager(gpu_idx=_AUDIO_GPU_IDX)

            _mm_encodec = ManagedModel(
                name="encodec-24khz",
                gpu_idx=_AUDIO_GPU_IDX,
                priority=1,        # first to offload (smallest, least hot)
                size_gb=0.5,
                headroom_gb=0.5,
                gpu_factory=_build_encodec_gpu,
                gpu_instance=encodec_gpu,
                cpu_instance=_encodec_cpu,
            )
            _audio_vram.register(_mm_encodec)

            _mm_clap = ManagedModel(
                name="clap-htsat-tiny",
                gpu_idx=_AUDIO_GPU_IDX,
                priority=2,        # offloaded after encodec
                size_gb=4.0,
                headroom_gb=1.5,
                gpu_factory=_build_clap_gpu,
                gpu_instance=clap_gpu,
                cpu_instance=_clap_cpu,
            )
            _audio_vram.register(_mm_clap)

            start_reload_poller(
                _audio_vram, _DAEMON_URL, _AUDIO_VULKAN,
                poll_interval_s=2.0,
            )
        except Exception as _e:
            logger.warning(
                f"audio VramManager init failed ({type(_e).__name__}: {_e}) -- "
                f"audio tools will use static device selection without active offload"
            )

        _audio_init_done = True


def _audio_gpu_ok() -> bool:
    """Cheap check: does the daemon say the audio GPU is free right now?"""
    try:
        import urllib.request
        with urllib.request.urlopen(
            f"{_DAEMON_URL}/rag-route?device={_AUDIO_VULKAN}", timeout=0.4,
        ) as resp:
            return json.loads(resp.read()).get("route") == "gpu"
    except Exception as _e:
        logger.debug(f"rag-route probe: {type(_e).__name__}: {_e}")
        return True  # daemon unreachable -- assume idle, GPU was the fast path


@contextmanager
def _acquire_audio_model(mm, cpu_fallback, label: str):
    """Serialized acquire for an audio model. Yields (model, device_tag).

    Serialization matters here because audio tools run batch work that
    allocates large intermediate tensors, and two simultaneous CLAP calls
    would either OOM or thrash. We take a process-wide lock so only one
    audio tool call runs at a time (RAG stack and arbiter run in
    parallel to audio -- this lock only governs audio).
    """
    with _audio_lock:
        # Pressure check before using GPU
        use_gpu = (
            mm is not None
            and mm.gpu_instance is not None
            and _audio_gpu_ok()
        )
        if use_gpu and _audio_vram is not None:
            ok = _audio_vram.request_room(mm.headroom_gb, caller=mm)
            if not ok:
                use_gpu = False

        if use_gpu:
            yield mm.gpu_instance, f"cuda:{_AUDIO_GPU_IDX}"
        elif cpu_fallback is not None:
            yield cpu_fallback, "cpu"
        elif mm is not None and mm.gpu_instance is not None:
            # CPU mirror missing but GPU still exists -- use GPU unconditionally
            yield mm.gpu_instance, f"cuda:{_AUDIO_GPU_IDX}"
        else:
            raise RuntimeError(f"{label}: no instance available (neither GPU nor CPU)")


def _get_encodec():
    """Back-compat: returns (model, device). Prefer `_acquire_encodec()` for
    new code. This exists so tests and ad-hoc scripts can still probe."""
    _ensure_audio_initialized()
    if _mm_encodec is not None and _mm_encodec.gpu_instance is not None:
        return _mm_encodec.gpu_instance, f"cuda:{_AUDIO_GPU_IDX}"
    if _encodec_cpu is not None:
        return _encodec_cpu, "cpu"
    raise RuntimeError("EnCodec: not loaded")


def _get_clap():
    """Back-compat: returns model. Prefer `_acquire_clap()` for new code."""
    _ensure_audio_initialized()
    if _mm_clap is not None and _mm_clap.gpu_instance is not None:
        return _mm_clap.gpu_instance
    if _clap_cpu is not None:
        return _clap_cpu
    raise RuntimeError("CLAP: not loaded")


@contextmanager
def _acquire_encodec():
    """Context manager: yields (model, device_tag) with proper serialization
    and daemon busy-flag signaling. Flips the audio GPU busy flag for the
    duration of the call so concurrent coder generations route appropriately."""
    _ensure_audio_initialized()
    _set_audio_busy(True)
    try:
        with _acquire_audio_model(_mm_encodec, _encodec_cpu, "EnCodec") as (m, dev):
            yield m, dev
    finally:
        _set_audio_busy(False)


@contextmanager
def _acquire_clap():
    """Context manager: yields model (with internal device) with proper
    serialization and daemon busy-flag signaling."""
    _ensure_audio_initialized()
    _set_audio_busy(True)
    try:
        with _acquire_audio_model(_mm_clap, _clap_cpu, "CLAP") as (m, _dev):
            yield m
    finally:
        _set_audio_busy(False)


def _set_audio_busy(busy: bool) -> None:
    """POST to daemon's /gpu-busy endpoint to flip the audio GPU's busy
    flag. Concurrent generators on the audio GPU (coder generations, other
    future workloads) read this flag via /rag-route?device=<audio> and
    route accordingly. Silent on failure -- daemon may be down during probes.
    """
    try:
        import urllib.request
        payload = json.dumps({
            "device": _AUDIO_VULKAN,
            "state": "set" if busy else "clear",
        }).encode()
        req = urllib.request.Request(
            f"{_DAEMON_URL}/gpu-busy",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=0.3).read()
    except Exception as _e:
        logger.debug(f"_set_audio_busy({busy}): daemon unreachable ({type(_e).__name__})")



# Re-exports -- inference funcs extracted.
from .perceptual_inference import _run_encodec, _run_clap  # noqa: F401, E402
