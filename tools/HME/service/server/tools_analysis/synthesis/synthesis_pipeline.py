"""HME five-stage synthesis pipeline — arbiter triage, conflict resolution, parallel two-stage think."""
import json as _json
import os as _os
import re
import logging
import threading
import time as _time

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM

logger = logging.getLogger("HME")

_ARBITER_LOG = None
_TRACE_LOG = None

# Shared bounded-log helper — single source of truth across the worker.
from common.bounded_log import maybe_trim_append as _maybe_trim_log  # noqa: E402


def _log_dir() -> str:
    return _os.path.join(getattr(ctx, "PROJECT_ROOT", "."), "log")


def _log_arbiter_decision(tool: str, question: str, classification: str,
                          gpu0_chars: int, gpu1_chars: int, resolved_chars: int = 0):
    global _ARBITER_LOG
    if _ARBITER_LOG is None:
        _ARBITER_LOG = _os.path.join(_log_dir(), "synthesis-arbiter.jsonl")
    try:
        entry = _json.dumps({
            "ts": _time.time(), "tool": tool, "query_hash": hash(question) & 0xFFFFFFFF,
            "classification": classification,
            "gpu0_chars": gpu0_chars, "gpu1_chars": gpu1_chars,
            "resolved_chars": resolved_chars,
        })
        with open(_ARBITER_LOG, "a") as f:
            f.write(entry + "\n")
        _maybe_trim_log(_ARBITER_LOG)
    except Exception as _err1:
        logger.debug(f"f.write: {type(_err1).__name__}: {_err1}")


def _log_synthesis_trace(tool: str, question: str, trace: dict):
    global _TRACE_LOG
    if _TRACE_LOG is None:
        _TRACE_LOG = _os.path.join(_log_dir(), "synthesis-traces.jsonl")
    try:
        entry = _json.dumps({"ts": _time.time(), "tool": tool,
                             "query_hash": hash(question) & 0xFFFFFFFF, **trace})
        with open(_TRACE_LOG, "a") as f:
            f.write(entry + "\n")
        _maybe_trim_log(_TRACE_LOG)
    except Exception as _err2:
        logger.debug(f"f.write: {type(_err2).__name__}: {_err2}")


def _arbiter_check(gpu0_out: str | None, gpu1_out: str | None,
                   question: str) -> dict | None:
    """Triage arbiter: contrast GPU0/GPU1 outputs and classify conflict severity.

    Severity levels:
      ALIGNED  — no conflicts, proceed directly to Stage 2
      MINOR    — name mismatch or scope gap, inject as advisory note
      COMPLEX  — fundamental contradiction requiring escalation to Stage 1.75
    Returns None on ALIGNED or unavailable.
    """
    if not gpu0_out or not gpu1_out or len(gpu0_out) < 30 or len(gpu1_out) < 30:
        return None
    from .synthesis_llamacpp import _ARBITER_MODEL, _NUM_CTX_4B, _llamacpp_generate
    from .synthesis_session import get_session_narrative

    session_ctx = get_session_narrative()
    prompt = (
        (session_ctx if session_ctx else "") +
        "Two independent analyses of the same Polychron codebase question.\n\n"
        f"Question: {question[:200]}\n\n"
        f"EXTRACTOR (GPU0, structured facts):\n{gpu0_out[:800]}\n\n"
        f"REASONER (GPU1, analysis):\n{gpu1_out[:800]}\n\n"
        "Compare these analyses. Check for:\n"
        "1. Module names or signal fields in the reasoner NOT present in the extractor\n"
        "2. Contradicting claims about the same module (e.g. coupled vs uncoupled)\n"
        "3. Facts the extractor found that the reasoner completely ignored\n\n"
        "Classify and respond with EXACTLY one of these formats:\n"
        "ALIGNED — if no conflicts or gaps\n"
        "MINOR: <one sentence describing the mismatch>\n"
        "COMPLEX: <one sentence describing the fundamental contradiction>"
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.0, "num_predict": 600, "num_ctx": _NUM_CTX_4B},
    }
    result = _llamacpp_generate(payload, wall_timeout=45.0, priority="interactive")
    if result is None:
        logger.warning("arbiter unavailable: llamacpp generate returned None")
        return None
    from .synthesis_config import clean_model_output
    text = clean_model_output(result.get("response", ""))
    if not text:
        return None
    text_upper = text.upper()
    if "ALIGNED" in text_upper and "MINOR" not in text_upper and "COMPLEX" not in text_upper:
        logger.info("arbiter: ALIGNED")
        _log_arbiter_decision("arbiter", question, "ALIGNED",
                              len(gpu0_out or ""), len(gpu1_out or ""))
        return None
    if "COMPLEX" in text_upper:
        logger.info(f"arbiter: COMPLEX — {text[:200]}")
        _log_arbiter_decision("arbiter", question, "COMPLEX",
                              len(gpu0_out or ""), len(gpu1_out or ""))
        return {"severity": "complex", "report": text}
    logger.info(f"arbiter: MINOR — {text[:200]}")
    _log_arbiter_decision("arbiter", question, "MINOR",
                          len(gpu0_out or ""), len(gpu1_out or ""))
    return {"severity": "minor", "report": text}


def _resolve_complex_conflict(gpu0_out: str, gpu1_out: str,
                               arbiter_report: str, question: str) -> str | None:
    """Stage 1.75: resolve COMPLEX arbiter conflict — escalate to OVERDRIVE.

    Arbitration between two competing analyses is frontier-class reasoning
    (which model hallucinated a module name? which missed a signal?). The
    local reasoner can't reliably distinguish its own blind spots from the
    extractor's. _reasoning_think cascades through ranked cloud providers
    and only falls back to local if every slot is exhausted.
    """
    from .synthesis_inference import _reasoning_think
    from .synthesis_session import append_session_narrative

    resolve_prompt = (
        "The arbiter detected a COMPLEX conflict between two analyses of the "
        "Polychron codebase. You must RESOLVE this before the final answer.\n\n"
        f"Question: {question[:200]}\n\n"
        f"EXTRACTOR analysis:\n{gpu0_out[:600]}\n\n"
        f"REASONER analysis:\n{gpu1_out[:600]}\n\n"
        f"ARBITER CONFLICT:\n{arbiter_report[:400]}\n\n"
        "Resolve: which analysis is correct? Trust the extractor's file paths and "
        "signal fields; discard hallucinated module names from the reasoner. "
        "Output a CORRECTED brief (max 300 words) for Stage 2."
    )
    resolved = _reasoning_think(resolve_prompt, max_tokens=512,
                                system=_THINK_SYSTEM, temperature=0.15)
    if resolved:
        logger.info(f"Stage 1.75: conflict resolved ({len(resolved)} chars)")
        append_session_narrative("arbiter_resolved",
                                 f"COMPLEX conflict on '{question[:60]}' resolved by Stage 1.75")
    return resolved


def _two_stage_think(raw_context: str, question: str, max_tokens: int = 8192,
                     answer_format: str | None = None) -> str | None:
    """Sequential two-stage synthesis: extract → gap-fill → reason. Fallback for _parallel_two_stage_think.

    Extraction + gap-analysis stages stay local (qwen3-coder excels at the
    pattern-matching these require). The reasoning/synthesis stages now
    escalate to OVERDRIVE — answer quality is user-facing and the local
    reasoner's synthesis ceiling was the bottleneck.
    """
    from .synthesis_inference import _local_think, _reasoning_think
    from .synthesis_llamacpp import _LOCAL_MODEL

    _STAGE1_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, function names, signal fields, correlation values, bridge status."
    )
    frame_prompt = (
        "Extract ONLY the facts relevant to answering this question:\n"
        f"  {question}\n\n"
        "Rules:\n"
        "- Preserve EXACT file paths (src/crossLayer/...), function names, signal field names\n"
        "- For each relevant module: file, coupling dimensions, antagonist pair\n"
        "- Mark pairs: VIRGIN (0 bridges), PARTIAL (1-2), SATURATED (3+)\n"
        "- Max 500 words\n\n"
        "Raw project context:\n" + raw_context[:8000]
    )
    frame_result = _local_think(frame_prompt, max_tokens=2000, model=_LOCAL_MODEL,
                                system=_STAGE1_SYSTEM, temperature=0.1, return_context=True)
    frame = frame_result[0] if isinstance(frame_result, tuple) else frame_result
    stage1_kv_ctx = frame_result[1] if isinstance(frame_result, tuple) else []

    if not frame or len(frame) < 40 or "src/" not in frame:
        # No-brief fallback: Stage 1 extraction failed, we're doing full
        # synthesis from raw context. Answer quality is fully exposed —
        # escalate to OVERDRIVE cascade.
        return _reasoning_think(raw_context[:6000] + "\n\n" + question,
                                max_tokens=max_tokens, system=_THINK_SYSTEM)

    # Gap-detection is lightweight pattern enumeration; local reasoner is fine.
    gaps = _local_think(
        "/no_think Brief:\n\n" + frame + "\n\nQuestion: " + question + "\n\n"
        "What SPECIFIC facts are MISSING? List as: NEED: <what>. If nothing, respond: NO GAPS\nMax 5 gaps.",
        max_tokens=800, temperature=0.2, system=_THINK_SYSTEM
    )
    if gaps and "NO GAP" not in gaps.upper() and "NEED:" in gaps:
        supplement = _local_think(
            "Extract ONLY these missing facts:\n\n" + gaps + "\n\nMax 300 words.",
            max_tokens=1000, model=_LOCAL_MODEL, system=_STAGE1_SYSTEM, temperature=0.1,
            context=stage1_kv_ctx if stage1_kv_ctx else None
        )
        if supplement and len(supplement) > 20:
            frame = frame + "\n\n## Supplemental:\n" + supplement

    _fmt = answer_format or (
        "Answer using ONLY modules, files, signals named in the brief. Do NOT invent names.\n"
        "Format: FILE: path, FUNCTION: name, SIGNAL: field, EFFECT: one sentence. Max 4 items."
    )
    # Final synthesis stage — user-facing answer. Escalate to OVERDRIVE; the
    # brief and gap-fill stages have already bounded the context, so cloud
    # latency is the only tradeoff and quality gain is substantial.
    return _reasoning_think(
        "/no_think Brief:\n\n" + frame + "\n\nContext:\n" + raw_context[:4000] +
        "\n\nQuestion: " + question + "\n\n" + _fmt,
        max_tokens=max_tokens, system=_THINK_SYSTEM
    )


def _parallel_two_stage_think(raw_context: str, question: str, max_tokens: int = 8192) -> str | None:
    """Five-stage parallel synthesis pipeline.

    1A (GPU0 extract) + 1B (GPU1 analyze) run simultaneously.
    1.5 Arbiter triage → ALIGNED / MINOR / COMPLEX.
    1.75 GPU1 conflict resolution (COMPLEX only).
    2 GPU1 final synthesis via /api/chat.
    Falls back to _two_stage_think if both Stage 1 branches fail.
    """
    from .synthesis_llamacpp import (
        _LOCAL_MODEL, _REASONING_MODEL, _interactive_event,
    )
    from .synthesis_inference import _local_think, _local_chat, _reasoning_think
    from .synthesis_session import get_session_narrative

    _q_lower = question.lower()
    _is_evolution_q = any(k in _q_lower for k in [
        "next bridge", "antagonist", "leverage", "which pair", "best signal",
        "next evolution", "virgin pair", "best next", "bridge opportunity",
        "coupling round", "next round", "bridge candidate",
    ])
    _EXTRACT_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, signal fields, correlation values, bridge status. NO function names."
    )

    _interactive_event.set()
    results = [None, None]

    def _gpu0_extract():
        if _is_evolution_q:
            prompt = (
                "Extract antagonist pair data relevant to:\n  " + question + "\n\n"
                "For each PAIR: module names, r-value, already-bridged signals, "
                "candidate unused signals with directions (A does X / B does Y opposing).\n"
                "Mark pairs: VIRGIN / PARTIAL / SATURATED. Max 400 words.\n\n"
                "Raw context:\n" + raw_context[:8000]
            )
        else:
            prompt = (
                "Extract ONLY facts relevant to:\n  " + question + "\n\n"
                "- EXACT file paths (src/crossLayer/...), signal field names\n"
                "- For each module: file path, coupling dims, antagonist pair\n"
                "- Mark pairs: VIRGIN / PARTIAL / SATURATED\n"
                "- Max 400 words.\n\nRaw context:\n" + raw_context[:8000]
            )
        results[0] = _local_think(prompt, max_tokens=2000, model=_LOCAL_MODEL,
                                   system=_EXTRACT_SYSTEM, temperature=0.1, priority="parallel")

    def _gpu1_analyze():
        prompt = (
            "/no_think Question: " + question + "\n\n"
            "Analyze this Polychron codebase context. What coupling patterns, antagonism "
            "bridges, or signal flows directly answer this question?\n"
            "Be specific: name modules, exact fields, effects. Max 300 words.\n\n"
            "Context:\n" + raw_context[:6000]
        )
        results[1] = _local_think(prompt, max_tokens=1200, model=_REASONING_MODEL,
                                   system=_THINK_SYSTEM, temperature=0.2, priority="parallel")

    try:
        t0 = threading.Thread(target=_gpu0_extract, daemon=True)
        t1 = threading.Thread(target=_gpu1_analyze, daemon=True)
        t0.start(); t1.start()
        t0.join()
        t1.join()
    finally:
        _interactive_event.clear()

    gpu0_out, gpu1_out = results[0], results[1]
    if not gpu0_out and not gpu1_out:
        logger.warning("_parallel_two_stage_think: both stages failed, falling back to sequential")
        return _two_stage_think(raw_context, question, max_tokens)

    arbiter_result = _arbiter_check(gpu0_out, gpu1_out, question)

    merged_parts = []
    if gpu0_out and len(gpu0_out) > 30:
        merged_parts.append("## Structural Facts (extracted)\n" + gpu0_out)
    if gpu1_out and len(gpu1_out) > 30:
        merged_parts.append("## Coupling Analysis (reasoned)\n" + gpu1_out)

    if arbiter_result and arbiter_result["severity"] == "complex":
        resolved = _resolve_complex_conflict(gpu0_out, gpu1_out, arbiter_result["report"], question)
        if resolved:
            merged_parts.append("## Conflict Resolution (Stage 1.75)\n" + resolved)
        else:
            merged_parts.append("## Arbiter: COMPLEX Conflict (unresolved)\n" + arbiter_result["report"])
    elif arbiter_result and arbiter_result["severity"] == "minor":
        merged_parts.append("## Arbiter Advisory\n" + arbiter_result["report"])

    merged = "\n\n".join(merged_parts) if merged_parts else (gpu0_out or gpu1_out or "")

    _fmt_instruction = (
        "Format each recommendation as:\n"
        "  PAIR: moduleA↔moduleB (r=value), SIGNAL: fieldName, "
        "DIRECTION: moduleA raises X when field high / moduleB lowers Y when field high."
    ) if _is_evolution_q else (
        "Format each finding as:\n  FILE: path, SIGNAL: field, EFFECT: one sentence."
    )

    _narrative_prefix = get_session_narrative()
    chat_messages = [
        {"role": "system",
         "content": _THINK_SYSTEM + " Answer only from facts in the conversation. Do NOT invent module names, function names, or signal fields. /no_think"},
        {"role": "user",
         "content": ((_narrative_prefix or "") +
                     f"Analyze the Polychron codebase for:\n  {question}\n\n"
                     "Context:\n" + raw_context[:2000])},
        {"role": "assistant", "content": merged},
        {"role": "user",
         "content": ("/no_think Based on your analysis, answer the question:\n  " + question + "\n\n"
                     "Use ONLY modules and signals from your analysis above. " + _fmt_instruction + "\n"
                     "Max 4 items. No prose. No explanation. Start immediately with the first item.")},
        {"role": "assistant", "content": "1."},
    ]
    result = _local_chat(chat_messages, model=_REASONING_MODEL, max_tokens=max_tokens, temperature=0.15)
    if not result:
        # Local chat path failed — escalate the final synthesis to OVERDRIVE
        # instead of retrying the same local reasoner with different phrasing.
        fallback_prompt = ("Based on this analysis:\n\n" + merged + "\n\nAnswer: " + question +
                           "\n\n" + _fmt_instruction + "\nMax 4 items.")
        result = _reasoning_think(fallback_prompt, max_tokens=max_tokens, system=_THINK_SYSTEM)

    _arbiter_class = arbiter_result["severity"].upper() if arbiter_result else "ALIGNED"
    _resolved = "Conflict Resolution" in merged if _arbiter_class == "COMPLEX" else False
    _trace_parts = [f"1A:{len(gpu0_out or '')}c", f"1B:{len(gpu1_out or '')}c"]
    _trace_parts.append(f"arbiter:{_arbiter_class}")
    if _arbiter_class == "COMPLEX":
        _trace_parts.append("1.75:resolved" if _resolved else "1.75:failed")
    _trace_parts.append(f"2:{len(result or '')}c")
    _trace = " → ".join(_trace_parts)

    _trace_data = {
        "stage_1a_chars": len(gpu0_out or ""), "stage_1b_chars": len(gpu1_out or ""),
        "arbiter_class": _arbiter_class, "stage_175_resolved": _resolved,
        "stage_2_chars": len(result or ""), "fallback_used": result is None,
    }
    _log_synthesis_trace("parallel_two_stage", question, _trace_data)

    if result:
        result = result + f"\n\n*pipeline: {_trace}*"
        logger.info(f"_parallel_two_stage_think: {_trace}")
    return result or merged
