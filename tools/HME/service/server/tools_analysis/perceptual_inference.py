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

# Engine acquirers extracted to perceptual_engines.py.
from .perceptual_engines import _acquire_clap, _acquire_encodec  # noqa: F401, E402




def _run_encodec(wav_path: str, top_sections: int = 3) -> str:
    """EnCodec analysis implementation -- called by audio_analyze."""
    try:
        import torch
        import torchaudio
        from encodec.utils import convert_audio
        import numpy as np
    except ImportError as e:
        return f"Missing dependency: {e}. Install: pip install encodec torchaudio"

    with _acquire_encodec() as (model, device):
        # Load and convert audio inside the acquire block so offload/reload
        # decisions from the VramManager apply cleanly to the whole pass.
        wav, sr = torchaudio.load(wav_path)
        wav = convert_audio(wav, sr, model.sample_rate, model.channels)
        wav = wav.unsqueeze(0).to(device)

        # Encode in chunks to manage memory
        chunk_size = model.sample_rate * 30  # 30 second chunks
        all_codes = []
        with torch.no_grad():
            for start in range(0, wav.shape[-1], chunk_size):
                chunk = wav[..., start:start + chunk_size]
                if chunk.shape[-1] < model.sample_rate:
                    continue
                encoded = model.encode(chunk)
                codes = encoded[0][0][0]  # list -> tuple(codes, scale) -> codes [n_codebooks, n_frames]
                all_codes.append(codes.cpu())

    if not all_codes:
        return "Audio too short for EnCodec analysis."

    codes = torch.cat(all_codes, dim=-1)  # [n_codebooks, total_frames]
    n_codebooks, n_frames = codes.shape

    frames_per_sec = n_frames / (wav.shape[-1] / model.sample_rate)

    parts = [f"# EnCodec Analysis (confidence: {_PERCEPTUAL_CONFIDENCE:.0%})\n"]
    parts.append(f"Codebooks: {n_codebooks} | Frames: {n_frames} | Device: {device}")

    # Global codebook entropy
    for cb in range(min(n_codebooks, 4)):
        tokens = codes[cb].numpy()
        unique, counts = np.unique(tokens, return_counts=True)
        probs = counts / counts.sum()
        entropy = -np.sum(probs * np.log2(probs + 1e-10))
        parts.append(f"  CB{cb}: {len(unique)} unique tokens, entropy={entropy:.2f} bits")

    # Per-section complexity (codebook 0 = coarsest = rhythmic structure)
    parts.append(f"\n## Section Complexity (CB0 entropy)")
    section_entropies = []
    trace_path = os.path.join(ctx.PROJECT_ROOT, "src", "output", "metrics", "trace.jsonl")
    section_times: dict = {}
    from . import _load_trace as _lt
    for rec in _lt(trace_path):
        bk = rec.get("beatKey", "")
        p = bk.split(":")
        sec = int(p[0]) if p and p[0].isdigit() else -1
        t = rec.get("timeMs", 0)
        if isinstance(t, (int, float)) and sec >= 0:
            if sec not in section_times:
                section_times[sec] = {"start": t / 1000, "end": t / 1000}
            section_times[sec]["end"] = t / 1000

    for sec_num in sorted(section_times.keys()):
        st = section_times[sec_num]
        f_start = int(st["start"] * frames_per_sec)
        f_end = min(int(st["end"] * frames_per_sec), n_frames)
        if f_end <= f_start:
            continue
        sec_tokens = codes[0, f_start:f_end].numpy()
        unique, counts = np.unique(sec_tokens, return_counts=True)
        probs = counts / counts.sum()
        ent = -np.sum(probs * np.log2(probs + 1e-10))
        bar = "#" * int(ent) + "." * (10 - int(ent))
        section_entropies.append((sec_num, ent))
        parts.append(f"  S{sec_num}: {ent:.2f} bits [{bar}]")

    # Inter-section contrast (token distribution distance)
    if len(section_entropies) >= 2:
        parts.append(f"\n## Section Contrast")
        for i in range(len(section_entropies) - 1):
            s1, e1 = section_entropies[i]
            s2, e2 = section_entropies[i + 1]
            delta = abs(e2 - e1)
            direction = "^" if e2 > e1 else "v"
            parts.append(f"  S{s1}->S{s2}: {direction}{delta:.2f} bits")

    return "\n".join(parts)


def _run_clap(wav_path: str, queries: str = "") -> str:
    """CLAP analysis implementation -- called by audio_analyze."""
    try:
        import torch
        import librosa
        import numpy as np
    except ImportError as e:
        return f"Missing dependency: {e}"

    default_queries = [
        "high musical tension building to climax",
        "relaxed atmospheric ambient texture",
        "rhythmically complex polyrhythmic pattern",
        "sparse minimal quiet passage",
        "dense chaotic many notes simultaneously",
        "coherent organized harmonic structure",
    ]
    if queries.strip():
        query_list = [q.strip() for q in queries.split(",") if q.strip()]
    else:
        query_list = default_queries

    # Load and chunk audio into ~10s sections (CPU-only, no model needed)
    y, sr = librosa.load(wav_path, sr=48000, mono=True)
    chunk_seconds = 10
    chunk_samples = chunk_seconds * sr
    chunks = []
    for start in range(0, len(y), chunk_samples):
        chunk = y[start:start + chunk_samples]
        if len(chunk) >= sr * 3:  # min 3 seconds
            chunks.append(chunk)

    if not chunks:
        return "Audio too short for CLAP analysis."

    parts = [f"# CLAP Audio Analysis\n"]
    parts.append(f"Chunks: {len(chunks)} x {chunk_seconds}s | Queries: {len(query_list)}")
    using_custom = bool(queries.strip())
    parts.append(f"Query set: {'custom' if using_custom else 'default xenolinguistic probes'}")
    if not using_custom:
        parts.append(f"  Probes: {' | '.join(q[:40] for q in query_list)}")
    parts.append("")

    # All model calls go inside the acquire block so offload/reload
    with _acquire_clap() as model:
        text_embed = model.get_text_embedding(query_list, use_tensor=True)

        audio_embeds = []
        for chunk in chunks:
            # CLAP expects float32 torch tensors
            chunk_tensor = torch.from_numpy(chunk).float().unsqueeze(0)
            embed = model.get_audio_embedding_from_data(
                chunk_tensor, use_tensor=True
            )
            audio_embeds.append(embed)

        audio_embed = torch.cat(audio_embeds, dim=0)  # [n_chunks, embed_dim]

        # Compute similarity matrix
        similarity_t = torch.nn.functional.cosine_similarity(
            text_embed.unsqueeze(1),   # [n_queries, 1, dim]
            audio_embed.unsqueeze(0),  # [1, n_chunks, dim]
            dim=2,
        )  # [n_queries, n_chunks]

        # Detach to CPU numpy before exiting the acquire block so the
        similarity = similarity_t.detach().cpu().numpy()
        del text_embed, audio_embed, similarity_t

    # Report: for each query, which chunks match best.
    parts.append("## Query Matches (chunk = ~10s window)")
    for qi, query in enumerate(query_list):
        scores = similarity[qi]
        best_chunk = int(np.argmax(scores))
        best_score = float(scores[best_chunk])
        avg_score = float(np.mean(scores))
        # Sparkline of scores across chunks
        step = max(1, len(scores) // 20)
        sampled = scores[::step]
        s_min, s_max = sampled.min(), sampled.max()
        s_range = s_max - s_min if s_max > s_min else 0.001
        spark = "".join("...#####"[min(7, int((v - s_min) / s_range * 7))] for v in sampled)
        parts.append(f"  \"{query}\"")
        parts.append(f"    peak={best_score:.3f} at {best_chunk*chunk_seconds}s | avg={avg_score:.3f} [{spark}]")

    # Overall composition character (highest avg similarity query)
    avg_per_query = similarity.mean(axis=1)
    top_qi = int(np.argmax(avg_per_query))
    parts.append(f"\n## Dominant Character: \"{query_list[top_qi]}\" (avg={avg_per_query[top_qi]:.3f})")

    # Per-section mismatch coaching: compare CLAP character to section intent
    # Load section intent data if available
    try:
        trace_path = os.path.join(ctx.PROJECT_ROOT, "src", "output", "metrics", "trace.jsonl")
        section_regimes: dict = {}
        if os.path.isfile(trace_path):
            with open(trace_path, encoding="utf-8") as _tf:
                for line in _tf:
                    try:
                        rec = json.loads(line)
                    except Exception as _err:
                        logger.debug(f"unnamed-except perceptual_engines.py:269: {type(_err).__name__}: {_err}")
                        continue
                    bk = rec.get("beatKey", "")
                    p = bk.split(":")
                    sec = int(p[0]) if p and p[0].isdigit() else -1
                    regime = rec.get("regime", "?")
                    if sec >= 0:
                        if sec not in section_regimes:
                            section_regimes[sec] = {}
                        section_regimes[sec][regime] = section_regimes[sec].get(regime, 0) + 1

        # Map chunks to approximate sections
        if section_regimes and len(chunks) >= 3:
            parts.append(f"\n## Section Character Coaching")
            # Intent mapping: regime expectations vs CLAP character
            _REGIME_EXPECTS = {
                "coherent": {"coherent organized harmonic structure", "high musical tension building to climax"},
                "exploring": {"rhythmically complex polyrhythmic pattern", "dense chaotic many notes simultaneously"},
                "evolving": {"high musical tension building to climax", "rhythmically complex polyrhythmic pattern"},
            }
            n_chunks_per_section = max(1, len(chunks) // max(1, len(section_regimes)))
            for sec_num in sorted(section_regimes.keys()):
                dom_regime = max(section_regimes[sec_num].items(), key=lambda x: x[1])[0]
                expected = _REGIME_EXPECTS.get(dom_regime, set())
                if not expected:
                    continue
                # Get dominant CLAP character for chunks in this section range
                chunk_start = sec_num * n_chunks_per_section
                chunk_end = min(chunk_start + n_chunks_per_section, len(chunks))
                if chunk_start >= len(chunks):
                    continue
                sec_scores = similarity[:, chunk_start:chunk_end].mean(axis=1)
                sec_top_qi = int(np.argmax(sec_scores))
                sec_character = query_list[sec_top_qi]
                if sec_character not in expected:
                    parts.append(
                        f"  S{sec_num} ({dom_regime}): CLAP sees \"{sec_character[:45]}\" "
                        f"-- expected {dom_regime} character. Check density/tension tuning."
                    )
    except Exception as _err1:
        logger.debug(f"): {type(_err1).__name__}: {_err1}")

    return "\n".join(parts)
