"""HME perceptual intelligence — audio analysis via EnCodec + CLAP.

Three-phase perceptual stack:
  Phase 1: Trace-based quality predictor (gradient-boosted tree on run-history)
  Phase 2: EnCodec token analysis (per-section audio complexity + contrast)
  Phase 3: CLAP text-queryable audio understanding (natural language audio search)

All outputs carry a confidence weight (0.0-1.0) that starts LOW and earns
trust through correlation with user verdicts, just like any trust system.
"""
import json
import os
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HyperMeta-Ecstasy")

# Perceptual confidence starts low — earns trust through verified accuracy
_PERCEPTUAL_CONFIDENCE = 0.15  # raised as predictions correlate with verdicts


def _get_wav_path() -> str:
    return os.path.join(ctx.PROJECT_ROOT, "output", "combined.wav")


def _load_audio_sections(wav_path: str, sr: int = 22050) -> list[tuple[int, any]]:
    """Load WAV and split into per-section chunks using trace.jsonl beat timing."""
    import librosa
    import numpy as np
    y, actual_sr = librosa.load(wav_path, sr=sr, mono=True)
    duration = len(y) / sr

    # Get section boundaries from trace
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    section_times: dict = {}
    with open(trace_path, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            bk = rec.get("beatKey", "")
            parts = bk.split(":")
            sec = int(parts[0]) if parts and parts[0].isdigit() else -1
            t = rec.get("timeMs", 0)
            if isinstance(t, (int, float)) and t > 0:
                t_sec = t / 1000.0
                if sec not in section_times:
                    section_times[sec] = {"start": t_sec, "end": t_sec}
                section_times[sec]["end"] = t_sec

    sections = []
    for sec_num in sorted(section_times.keys()):
        st = section_times[sec_num]
        start_sample = int(st["start"] * sr)
        end_sample = min(int(st["end"] * sr) + sr, len(y))  # +1s buffer
        if end_sample > start_sample:
            sections.append((sec_num, y[start_sample:end_sample]))

    return sections


@ctx.mcp.tool()
def audio_encodec(top_sections: int = 3) -> str:
    """Phase 2: Analyze the rendered WAV with EnCodec neural audio codec.
    Extracts per-section token entropy (musical complexity), inter-section
    token distance (contrast), and codebook activation patterns.
    Confidence-weighted — starts low, earns trust through verdict correlation."""
    ctx.ensure_ready_sync()
    _track("audio_encodec")

    wav_path = _get_wav_path()
    if not os.path.isfile(wav_path):
        return "No combined.wav found. Run `npm run render` first."

    try:
        import torch
        import torchaudio
        from encodec import EncodecModel
        from encodec.utils import convert_audio
        import numpy as np
    except ImportError as e:
        return f"Missing dependency: {e}. Install: pip install encodec torchaudio"

    # Load model (24kHz bandwidth for quality)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = EncodecModel.encodec_model_24khz()
    model.set_target_bandwidth(6.0)  # 6kbps = good quality
    model.to(device)
    model.eval()

    # Load and convert audio
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

    # Per-section analysis using trace timing
    sections = _load_audio_sections(wav_path, sr=model.sample_rate)
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
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    section_times: dict = {}
    with open(trace_path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            bk = rec.get("beatKey", "")
            p = bk.split(":")
            sec = int(p[0]) if p and p[0].isdigit() else -1
            t = rec.get("timeMs", 0)
            if isinstance(t, (int, float)) and sec >= 0:
                if sec not in section_times:
                    section_times[sec] = {"start": t / 1000, "end": t / 1000}
                section_times[sec]["end"] = t / 1000

    import numpy as np
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
        bar = "█" * int(ent) + "░" * (10 - int(ent))
        section_entropies.append((sec_num, ent))
        parts.append(f"  S{sec_num}: {ent:.2f} bits [{bar}]")

    # Inter-section contrast (token distribution distance)
    if len(section_entropies) >= 2:
        parts.append(f"\n## Section Contrast")
        for i in range(len(section_entropies) - 1):
            s1, e1 = section_entropies[i]
            s2, e2 = section_entropies[i + 1]
            delta = abs(e2 - e1)
            direction = "▲" if e2 > e1 else "▼"
            parts.append(f"  S{s1}→S{s2}: {direction}{delta:.2f} bits")

    parts.append(f"\n*Confidence: {_PERCEPTUAL_CONFIDENCE:.0%} — verify against listening before trusting*")
    return "\n".join(parts)


@ctx.mcp.tool()
def audio_clap(queries: str = "") -> str:
    """Phase 3: Query the rendered WAV with natural language using CLAP.
    Computes similarity between text descriptions and audio sections.
    Default queries probe tension, coherence, density, atmosphere.
    Custom queries: comma-separated (e.g. 'sparse texture,rhythmic complexity').
    Confidence-weighted — starts low, earns trust through verdict correlation."""
    ctx.ensure_ready_sync()
    _track("audio_clap")

    wav_path = _get_wav_path()
    if not os.path.isfile(wav_path):
        return "No combined.wav found. Run `npm run render` first."

    try:
        import torch
        import laion_clap
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

    # Load CLAP model
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = laion_clap.CLAP_Module(enable_fusion=False, amodel='HTSAT-base')
    model.load_ckpt()

    # Load and chunk audio into ~10s sections
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

    # Get text embeddings
    text_embed = model.get_text_embedding(query_list, use_tensor=True)

    # Get audio embeddings per chunk
    parts = [f"# CLAP Audio Analysis (confidence: {_PERCEPTUAL_CONFIDENCE:.0%})\n"]
    parts.append(f"Chunks: {len(chunks)} x {chunk_seconds}s | Queries: {len(query_list)}\n")

    # Process chunks
    audio_embeds = []
    for chunk in chunks:
        # CLAP expects int16 WAV data or file paths
        chunk_int16 = (chunk * 32767).astype(np.int16)
        embed = model.get_audio_embedding_from_data(
            [chunk_int16], use_tensor=True
        )
        audio_embeds.append(embed)

    audio_embed = torch.cat(audio_embeds, dim=0)  # [n_chunks, embed_dim]

    # Compute similarity matrix
    similarity = torch.nn.functional.cosine_similarity(
        text_embed.unsqueeze(1),  # [n_queries, 1, dim]
        audio_embed.unsqueeze(0),  # [1, n_chunks, dim]
        dim=2
    )  # [n_queries, n_chunks]

    # Report: for each query, which chunks match best
    parts.append("## Query Matches (chunk = ~10s window)")
    for qi, query in enumerate(query_list):
        scores = similarity[qi].cpu().numpy()
        best_chunk = int(np.argmax(scores))
        best_score = float(scores[best_chunk])
        avg_score = float(np.mean(scores))
        # Sparkline of scores across chunks
        step = max(1, len(scores) // 20)
        sampled = scores[::step]
        s_min, s_max = sampled.min(), sampled.max()
        s_range = s_max - s_min if s_max > s_min else 0.001
        spark = "".join("▁▂▃▄▅▆▇█"[min(7, int((v - s_min) / s_range * 7))] for v in sampled)
        parts.append(f"  \"{query}\"")
        parts.append(f"    peak={best_score:.3f} at {best_chunk*chunk_seconds}s | avg={avg_score:.3f} [{spark}]")

    # Overall composition character (highest avg similarity query)
    avg_per_query = similarity.mean(dim=1).cpu().numpy()
    top_qi = int(np.argmax(avg_per_query))
    parts.append(f"\n## Dominant Character: \"{query_list[top_qi]}\" (avg={avg_per_query[top_qi]:.3f})")

    parts.append(f"\n*Confidence: {_PERCEPTUAL_CONFIDENCE:.0%} — verify against listening before trusting*")
    return "\n".join(parts)
