"""Prompt enricher — arbiter triage → KB assembly → reasoning enrichment → compression."""
import json
import logging
import os
import time

from server import context as ctx

logger = logging.getLogger("HME")


def _enrich_prompt(prompt: str, frame: str = "") -> dict:
    """Core enrichment logic. Returns {enriched, original, triage, trace}.

    Arbiter triages which enrichment modes the prompt needs,
    KB/context assembly runs instantly, reasoning model enriches,
    arbiter compresses if needed. All local, zero Claude tokens.
    """
    from .synthesis_ollama import (
        _local_think, _ARBITER_MODEL, _REASONING_MODEL, _LOCAL_MODEL,
        _KEEP_ALIVE, _NUM_CTX_4B, _url_for, compress_for_claude,
    )
    from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
    from .synthesis_session import get_session_narrative
    import urllib.request

    trace = {"triage_ms": 0, "assembly_ms": 0, "enrich_ms": 0, "compress_ms": 0}
    t0 = time.monotonic()

    # ── Stage 1: Arbiter triage ───────────────────────────────────────────
    frame_ctx = f"\nUser framing: {frame}\n" if frame else ""
    triage_prompt = (
        f"Analyze this prompt for a code-evolving AI assistant working on Polychron "
        f"(a generative music engine, 487 JS files).{frame_ctx}\n\n"
        f"PROMPT:\n{prompt[:1500]}\n\n"
        "Classify what enrichment this prompt needs. For each, answer YES or NO "
        "with a one-line reason:\n"
        "KB_NEEDED: Does it mention modules, signals, coupling, or patterns that "
        "a knowledge base could ground with specific names/constraints?\n"
        "STRUCTURAL_NEEDED: Is it ambiguous, compound, or missing specificity "
        "that restructuring would fix?\n"
        "CONTEXTUAL_NEEDED: Would recent session state (pipeline verdict, "
        "regime distribution, last changes) make it more situated?\n\n"
        "Format exactly:\n"
        "KB_NEEDED: YES/NO — reason\n"
        "STRUCTURAL_NEEDED: YES/NO — reason\n"
        "CONTEXTUAL_NEEDED: YES/NO — reason"
    )

    payload = {
        "model": _ARBITER_MODEL, "prompt": triage_prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": 300, "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
        payload["context"] = arbiter_ctx
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _url_for(_ARBITER_MODEL), data=body,
        headers={"Content-Type": "application/json"},
    )

    triage = {"kb": False, "structural": False, "contextual": False, "raw": ""}
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            triage["raw"] = text
            text_upper = text.upper()
            triage["kb"] = "KB_NEEDED: YES" in text_upper or "KB_NEEDED:YES" in text_upper
            triage["structural"] = "STRUCTURAL_NEEDED: YES" in text_upper or "STRUCTURAL_NEEDED:YES" in text_upper
            triage["contextual"] = "CONTEXTUAL_NEEDED: YES" in text_upper or "CONTEXTUAL_NEEDED:YES" in text_upper
    except Exception as e:
        logger.info(f"prompt_enricher: arbiter triage failed ({e}), defaulting to all modes")
        triage = {"kb": True, "structural": True, "contextual": True, "raw": f"triage failed: {e}"}

    if not triage["kb"] and not triage["structural"] and not triage["contextual"]:
        trace["triage_ms"] = int((time.monotonic() - t0) * 1000)
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": "Arbiter: prompt needs no enrichment"}

    trace["triage_ms"] = int((time.monotonic() - t0) * 1000)

    # ── Stage 2: Context assembly (instant, no model) ─────────────────────
    t1 = time.monotonic()
    assembled_parts = []

    if triage["kb"] and ctx.project_engine:
        kb_hits = ctx.project_engine.search_knowledge(prompt[:200], top_k=5)
        if kb_hits:
            kb_lines = ["[Knowledge Base Context]"]
            for h in kb_hits:
                kb_lines.append(f"  [{h.get('category', '')}] {h.get('title', '')}")
                kb_lines.append(f"    {h.get('content', '')[:200]}")
            assembled_parts.append("\n".join(kb_lines))

    if triage["contextual"]:
        narrative = get_session_narrative(max_entries=3)
        if narrative:
            assembled_parts.append(narrative.strip())
        summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "pipeline-summary.json")
        if os.path.exists(summary_path):
            try:
                with open(summary_path) as f:
                    ps = json.load(f)
                verdict = ps.get("verdict", "unknown")
                assembled_parts.append(f"[Pipeline: {verdict}]")
            except Exception:
                pass

    assembled = "\n\n".join(assembled_parts) if assembled_parts else ""
    trace["assembly_ms"] = int((time.monotonic() - t1) * 1000)

    # ── Stage 3: Reasoning model enrichment ───────────────────────────────
    t2 = time.monotonic()
    mode_instructions = []
    if triage["kb"]:
        mode_instructions.append(
            "- GROUND with specifics: replace vague module references with exact "
            "file paths, signal field names, and constraints from the KB context below")
    if triage["structural"]:
        mode_instructions.append(
            "- RESTRUCTURE for clarity: split compound requests, resolve ambiguity, "
            "add missing specificity")
    if triage["contextual"]:
        mode_instructions.append(
            "- SITUATE with session state: weave in relevant context from the "
            "session narrative and pipeline status below")

    frame_instruction = f"\nUser's enrichment framing: {frame}\n" if frame else ""
    enrich_prompt = (
        "You are a prompt enrichment engine for Polychron, a generative music engine. "
        "Your job is to take a raw prompt and make it more specific, grounded, and actionable "
        "without changing the user's intent.\n\n"
        f"MODES ACTIVE (from arbiter triage):\n" +
        "\n".join(mode_instructions) + "\n\n"
        f"{frame_instruction}"
        f"RAW PROMPT:\n{prompt}\n\n"
        + (f"ASSEMBLED CONTEXT:\n{assembled}\n\n" if assembled else "") +
        "OUTPUT RULES:\n"
        "- Return ONLY the enriched prompt text, nothing else\n"
        "- Preserve the user's voice and intent exactly\n"
        "- Add specificity (module names, file paths, signal fields) where the KB provides them\n"
        "- Do NOT add instructions the user didn't ask for\n"
        "- Do NOT add meta-commentary about the enrichment\n"
        "- Keep it concise — enriched should be at most 2x the original length"
    )

    enriched = _local_think(
        enrich_prompt, max_tokens=2048, model=_REASONING_MODEL,
        system="You enrich prompts with project-specific knowledge. Output only the enriched prompt.",
        temperature=0.2,
    )
    trace["enrich_ms"] = int((time.monotonic() - t2) * 1000)

    if not enriched or len(enriched.strip()) < 10:
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": "Reasoning model returned empty — original preserved"}

    # ── Stage 4: Arbiter compression (if enriched is too long) ────────────
    t3 = time.monotonic()
    max_len = len(prompt) * 3
    if len(enriched) > max_len:
        enriched = compress_for_claude(enriched, max_chars=max_len,
                                       hint="prompt enrichment — preserve specificity and intent")
    trace["compress_ms"] = int((time.monotonic() - t3) * 1000)

    total_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        f"prompt_enricher: {len(prompt)}→{len(enriched)} chars, "
        f"modes={'|'.join(k for k, v in triage.items() if v and k != 'raw')}, "
        f"{total_ms}ms (triage:{trace['triage_ms']} assembly:{trace['assembly_ms']} "
        f"enrich:{trace['enrich_ms']} compress:{trace['compress_ms']})"
    )

    return {"enriched": enriched, "original": prompt, "triage": triage, "trace": trace}


@ctx.mcp.tool()
def prompt_enricher(prompt: str, frame: str = "") -> str:
    """Enrich a prompt with KB grounding, structural clarity, and session context.
    Runs entirely on local models — zero Claude token cost.
    Arbiter triages which enrichment modes are needed, reasoning model enriches.
    frame: optional instruction for how to enrich (e.g. 'focus on coupling dimensions').
    """
    from . import _track
    _track("prompt_enricher")
    ctx.ensure_ready_sync()

    if not prompt or not prompt.strip():
        return "Error: prompt cannot be empty."

    result = _enrich_prompt(prompt.strip(), frame.strip())
    if result.get("unchanged"):
        return f"No enrichment needed: {result.get('reason', 'prompt is already specific')}\n\nOriginal prompt returned as-is."

    triage = result["triage"]
    modes = [k for k in ("kb", "structural", "contextual") if triage.get(k)]
    trace = result["trace"]

    out = [f"## Enriched Prompt\n\n{result['enriched']}"]
    out.append(f"\n\n---\n*Modes: {', '.join(modes)} | "
               f"Triage: {trace['triage_ms']}ms, Assembly: {trace['assembly_ms']}ms, "
               f"Enrich: {trace['enrich_ms']}ms, Compress: {trace['compress_ms']}ms*")
    return "\n".join(out)
