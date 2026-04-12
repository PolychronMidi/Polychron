"""enrich_prompt — KB assembly → reasoning enrichment → compression."""
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
        _local_think, _REASONING_MODEL, compress_for_claude,
    )
    from .synthesis_session import get_session_narrative

    trace = {"triage_ms": 0, "assembly_ms": 0, "enrich_ms": 0, "compress_ms": 0}
    t0 = time.monotonic()

    # ── Stage 1: Rule-based triage (instant, no model calls) ──────────────
    # Arbiter model adds ~30s cold-start latency and frequently returns all-NO
    # due to thinking token exhaustion. Use lightweight heuristics instead:
    # - KB mode: only when prompt mentions code symbols (camelCase, file paths, module names)
    # - Structural mode: always (cheap to include, rarely harmful)
    # - Contextual mode: only when prompt is long enough to benefit from session context
    import re as _re_triage
    _has_symbols = bool(_re_triage.search(r'[a-z][a-zA-Z]{4,}[A-Z]|src/|\.js\b|\.ts\b', prompt))
    _is_short = len(prompt.strip()) < 60
    triage = {
        "kb": _has_symbols,
        "structural": True,
        "contextual": not _is_short,
        "raw": "heuristic",
    }
    trace["triage_ms"] = 0

    # ── Stage 2: Context assembly (instant, no model) ─────────────────────
    t1 = time.monotonic()
    assembled_parts = []

    if triage["kb"] and ctx.project_engine:
        kb_hits = ctx.project_engine.search_knowledge(prompt[:400], top_k=5)
        if kb_hits:
            kb_lines = ["[Knowledge Base Context]"]
            for h in kb_hits:
                kb_lines.append(f"  [{h.get('category', '')}] {h.get('title', '')}")
                kb_lines.append(f"    {h.get('content', '')[:400]}")
            assembled_parts.append("\n".join(kb_lines))

    if triage["contextual"]:
        narrative = get_session_narrative(max_entries=5, categories=["edit", "search", "enrich", "evolve"])
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
    enrich_text = (
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
        enrich_text, max_tokens=16000, model=_REASONING_MODEL,
        system="You enrich prompts with project-specific knowledge. Output only the enriched prompt.",
        temperature=0.2,
    )
    trace["enrich_ms"] = int((time.monotonic() - t2) * 1000)

    if not enriched or len(enriched.strip()) < 10:
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": "Reasoning model returned empty — original preserved"}

    # ── Stage 4: Arbiter compression (if enriched is too long) ────────────
    t3 = time.monotonic()
    max_len = max(len(prompt) * 10, 2000)
    if len(enriched) > max_len:
        enriched = compress_for_claude(enriched, max_chars=max_len,
                                       hint="prompt enrichment — preserve specificity and intent")
    trace["compress_ms"] = int((time.monotonic() - t3) * 1000)

    total_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        f"enrich_prompt: {len(prompt)}→{len(enriched)} chars, "
        f"modes={'|'.join(k for k, v in triage.items() if v and k != 'raw')}, "
        f"{total_ms}ms (triage:{trace['triage_ms']} assembly:{trace['assembly_ms']} "
        f"enrich:{trace['enrich_ms']} compress:{trace['compress_ms']})"
    )

    # ── Stage 5: Grounding check — flag hallucinated paths ────────────────
    hallucinated = []
    import re as _re
    for m in _re.finditer(r'(?:src/|tools/)[^\s,)]+\.(?:js|py|ts)', enriched):
        p = m.group(0)
        full = os.path.join(ctx.PROJECT_ROOT, p)
        if not os.path.exists(full):
            hallucinated.append(p)

    return {"enriched": enriched, "original": prompt, "triage": triage, "trace": trace,
            "hallucinated_paths": hallucinated}


@ctx.mcp.tool()
def enrich_prompt(prompt: str, frame: str = "") -> str:
    """Enrich a prompt with KB grounding, structural clarity, and session context.
    Runs entirely on local models — zero Claude token cost.
    Arbiter triages which enrichment modes are needed, reasoning model enriches.
    frame: optional instruction for how to enrich (e.g. 'focus on coupling dimensions').
    """
    from . import _track
    from .synthesis_session import append_session_narrative
    _track("enrich_prompt")
    append_session_narrative("enrich_prompt", f"enrich: {prompt[:60]}")
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
    bad_paths = result.get("hallucinated_paths", [])
    if bad_paths:
        out.append(f"\n\n⚠ *Grounding check: these paths don't exist — verify before using:*")
        for p in bad_paths:
            out.append(f"  - `{p}`")
    out.append(f"\n\n---\n*Modes: {', '.join(modes)} | "
               f"Triage: {trace['triage_ms']}ms, Assembly: {trace['assembly_ms']}ms, "
               f"Enrich: {trace['enrich_ms']}ms, Compress: {trace['compress_ms']}ms*")
    return "\n".join(out)
