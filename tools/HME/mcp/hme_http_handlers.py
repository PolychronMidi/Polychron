"""HME HTTP — engine operations: enrich, validate, audit, reindex."""
import concurrent.futures
import logging
import os
import subprocess
import threading

logger = logging.getLogger("HME.http")

# Injected by hme_http.py
_engine_ready: threading.Event = None  # type: ignore
_project_engine = None
_global_engine = None
PROJECT_ROOT: str = ""


def init_handlers(engine_ready: threading.Event, project_engine, global_engine, project_root: str) -> None:
    """Wire engine references after startup. Call once engines are ready."""
    global _engine_ready, _project_engine, _global_engine, PROJECT_ROOT
    _engine_ready = engine_ready
    _project_engine = project_engine
    _global_engine = global_engine
    PROJECT_ROOT = project_root


def _reindex_files(files: list[str]) -> dict:
    """Trigger immediate mini-reindex of specific files via RAG engine."""
    from hme_http_store import _log_error
    if not _engine_ready.is_set():
        return {"indexed": [], "count": 0, "deferred": "engines starting"}
    if _project_engine is None:
        _log_error("reindex", "engines not ready — cannot reindex files")
        return {"error": "engines not ready", "indexed": [], "count": 0}

    if _project_engine._bulk_indexing.is_set():
        return {"indexed": [], "count": 0, "deferred": "bulk index in progress"}

    indexed = []
    # Budget: 25s total across all files (safely under 30s client timeout).
    # Each file gets at most 5s; if it times out we skip and continue.
    import time as _time
    deadline = _time.monotonic() + 25
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        for filepath in files[:20]:
            if _time.monotonic() >= deadline:
                break
            abs_path = filepath if os.path.isabs(filepath) else os.path.join(PROJECT_ROOT, filepath)
            if not os.path.exists(abs_path):
                _log_error("reindex", f"file not found: {filepath}")
                continue
            remaining = max(1, deadline - _time.monotonic())
            future = executor.submit(_project_engine.index_file, abs_path)
            try:
                future.result(timeout=min(5, remaining))
                indexed.append(filepath)
            except concurrent.futures.TimeoutError:
                pass  # skip this file; don't block the response
            except Exception as e:
                _log_error("reindex", f"index_file failed for {filepath}: {e}")
    return {"indexed": indexed, "count": len(indexed)}


def _enrich(query: str, top_k: int = 5) -> dict:
    """Pull KB hits for query. Returns {kb: [...], warm: str}."""
    from hme_http_store import _get_transcript_context
    if not _engine_ready.wait(timeout=5):
        return {"kb": [], "warm": "", "deferred": "engines starting"}
    if _project_engine is None:
        return {"kb": [], "warm": "", "error": "engines not ready"}

    proj_hits = _project_engine.search_knowledge(query, top_k=top_k)
    glob_hits = _global_engine.search_knowledge(query, top_k=2)

    kb_entries = []
    seen = set()
    for h in (proj_hits + glob_hits):
        eid = h.get("id", "")
        if eid in seen:
            continue
        seen.add(eid)
        kb_entries.append({
            "title": h.get("title", ""),
            "content": h.get("content", ""),
            "category": h.get("category", ""),
            "score": round(1.0 / (1.0 + h.get("_distance", 999)), 3),
        })

    # Build warm context string
    if kb_entries:
        lines = ["[HME Knowledge Context]"]
        for e in kb_entries:
            lines.append(f"[{e['category']}] {e['title']}")
            lines.append(e["content"][:400])
            lines.append("")
        warm = "\n".join(lines).strip()
    else:
        warm = ""

    # Append transcript context
    transcript = _get_transcript_context(query)
    if transcript:
        warm = warm + "\n\n" + transcript if warm else transcript

    return {"kb": kb_entries, "warm": warm, "transcript": transcript}


def _validate(query: str) -> dict:
    """Pre-send anti-pattern check. Returns {warnings: [...], blocks: [...]}."""
    if not _engine_ready.is_set():
        return {"warnings": [], "blocks": [], "deferred": "engines starting"}
    if _project_engine is None:
        return {"warnings": [], "blocks": [], "error": "engines not ready"}

    # Search for anti-patterns, bugfixes, and architectural constraints related to the query
    hits = _project_engine.search_knowledge(query, top_k=8)

    warnings = []
    blocks = []
    for h in hits:
        cat = h.get("category", "")
        title = h.get("title", "")
        content = h.get("content", "")
        score = round(1.0 / (1.0 + h.get("_distance", 999)), 3)
        if score < 0.35:
            continue
        entry = {"title": title, "content": content[:300], "score": score}
        if cat in ("bugfix", "antipattern"):
            blocks.append(entry)
        elif cat in ("architecture", "pattern", "decision"):
            warnings.append(entry)

    return {"warnings": warnings, "blocks": blocks}


def _enrich_prompt(prompt: str, frame: str = "") -> dict:
    """Prompt enrichment via local models — self-contained, no MCP server imports.

    Uses the shim's own _project_engine for KB and calls Ollama directly.
    Returns {enriched, original, triage, trace}.
    """
    import json as _json
    import time as _time
    import urllib.request as _urlreq

    # Model/URL config — same env vars as MCP server, same defaults.
    _REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")
    _PORT_GPU1 = int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435"))
    _REASONING_URL = f"http://localhost:{_PORT_GPU1}/api/chat"
    _KEEP_ALIVE  = int(os.environ.get("HME_KEEP_ALIVE",   "-1"))
    _NUM_CTX_30B = int(os.environ.get("HME_NUM_CTX_30B", "32768"))

    trace = {"triage_ms": 0, "assembly_ms": 0, "enrich_ms": 0, "compress_ms": 0}
    t0 = _time.monotonic()

    # ── Stage 1: Skip arbiter triage in HTTP shim ─────────────────────────────
    # The user clicked Enrich explicitly — always run all modes.
    # Arbiter triage is reserved for the MCP tool path (where warm KV context
    # makes it fast); in the shim the thinking model is cold and unreliable.
    triage = {"kb": True, "structural": True, "contextual": True, "raw": "explicit"}

    # ── Stage 2: Context assembly (instant, no model) ─────────────────────────
    t1 = _time.monotonic()
    assembled_parts = []

    if triage["kb"] and _project_engine is not None:
        try:
            kb_hits = _project_engine.search_knowledge(prompt[:200], top_k=5)
            if kb_hits:
                lines = ["[Knowledge Base Context]"]
                for h in kb_hits:
                    lines.append(f"  [{h.get('category', '')}] {h.get('title', '')}")
                    lines.append(f"    {h.get('content', '')[:200]}")
                assembled_parts.append("\n".join(lines))
        except Exception as e:
            logger.info(f"enrich_prompt: KB search failed: {e}")

    if triage["contextual"]:
        try:
            from hme_http_store import _get_transcript
            entries = _get_transcript(minutes=30, max_entries=5)
            if entries:
                lines = ["[Recent Session]"]
                for e in entries[-3:]:
                    lines.append(f"  {e.get('type','')}: {str(e.get('content',''))[:100]}")
                assembled_parts.append("\n".join(lines))
        except Exception:
            pass
        summary_path = os.path.join(PROJECT_ROOT, "metrics", "pipeline-summary.json")
        if os.path.exists(summary_path):
            try:
                with open(summary_path) as f:
                    ps = _json.load(f)
                assembled_parts.append(f"[Pipeline: {ps.get('verdict', 'unknown')}]")
            except Exception:
                pass

    assembled = "\n\n".join(assembled_parts)
    trace["assembly_ms"] = int((_time.monotonic() - t1) * 1000)

    # ── Stage 3: Reasoning model enrichment ──────────────────────────────────
    t2 = _time.monotonic()
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
    enrich_content = (
        "You are a prompt enrichment engine for Polychron, a generative music engine. "
        "Take the raw prompt and make it more specific, grounded, and actionable "
        "without changing the user's intent.\n\n"
        f"MODES ACTIVE:\n" + "\n".join(mode_instructions) + "\n\n"
        + frame_instruction
        + f"RAW PROMPT:\n{prompt}\n\n"
        + (f"ASSEMBLED CONTEXT:\n{assembled}\n\n" if assembled else "")
        + "OUTPUT RULES:\n"
        "- Return ONLY the enriched prompt text, nothing else\n"
        "- Preserve the user's voice and intent exactly\n"
        "- Do NOT add meta-commentary about the enrichment"
    )
    enriched = ""
    try:
        body = _json.dumps({
            "model": _REASONING_MODEL,
            "messages": [
                {"role": "system", "content": "You enrich prompts with project-specific knowledge. Output only the enriched prompt."},
                {"role": "user",   "content": enrich_content},
            ],
            "stream": False,
            "keep_alive": _KEEP_ALIVE,
            "options": {"temperature": 0.2, "num_predict": 16000, "num_ctx": _NUM_CTX_30B},
        }).encode()
        req = _urlreq.Request(_REASONING_URL, data=body, headers={"Content-Type": "application/json"})
        with _urlreq.urlopen(req, timeout=180) as resp:
            enriched = _json.loads(resp.read()).get("message", {}).get("content", "").strip()
            if "</think>" in enriched:
                enriched = enriched[enriched.rfind("</think>") + len("</think>"):].strip()
    except Exception as e:
        logger.error(f"enrich_prompt: reasoning model failed: {e}")
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": f"Reasoning model failed: {e}"}

    trace["enrich_ms"] = int((_time.monotonic() - t2) * 1000)

    if not enriched or len(enriched.strip()) < 10:
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": "Reasoning model returned empty — original preserved"}

    # ── Stage 4: Hard truncate only if absurdly long ─────────────────────────
    # Min floor of 2000 chars — short prompts can legitimately expand significantly.
    max_len = max(len(prompt) * 10, 2000)
    if len(enriched) > max_len:
        enriched = enriched[:max_len]

    total_ms = int((_time.monotonic() - t0) * 1000)
    logger.info(
        f"enrich_prompt: {len(prompt)}→{len(enriched)} chars, "
        f"modes={'|'.join(k for k, v in triage.items() if v and k != 'raw')}, "
        f"{total_ms}ms"
    )
    return {"enriched": enriched, "original": prompt, "triage": triage, "trace": trace}


def _post_audit(changed_files: str = "") -> dict:
    """Post-response audit: run git diff to detect changed files, search KB for violations.

    Caps total KB search time at 12s so the response always arrives before the
    15s client timeout in routerHme.ts auditChanges().
    """
    from hme_http_store import _log_error
    if not _engine_ready.is_set():
        return {"violations": [], "changed_files": [], "deferred": "engines starting"}
    if _project_engine is None:
        return {"violations": [], "changed_files": [], "error": "engines not ready"}

    # Get changed files from git if not provided
    files = [f.strip() for f in changed_files.split(",") if f.strip()]
    if not files:
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "HEAD"],
                capture_output=True, text=True, timeout=5,
                cwd=os.environ.get("PROJECT_ROOT", os.getcwd())
            )
            files = [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]
        except Exception as e:
            _log_error("audit", f"git diff failed: {e}")

    if not files:
        return {"violations": [], "changed_files": []}

    if _project_engine._bulk_indexing.is_set():
        return {"violations": [], "changed_files": files, "deferred": "bulk index in progress"}

    def _search_all() -> list:
        found = []
        for f in files[:10]:  # cap at 10 files
            module = os.path.splitext(os.path.basename(f))[0]
            hits = _project_engine.search_knowledge(module, top_k=4)
            for h in hits:
                cat = h.get("category", "")
                score = round(1.0 / (1.0 + h.get("_distance", 999)), 3)
                if score >= 0.40 and cat in ("bugfix", "antipattern", "architecture"):
                    found.append({
                        "file": f,
                        "title": h.get("title", ""),
                        "content": h.get("content", "")[:300],
                        "category": cat,
                        "score": score,
                    })
        return found

    violations = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_search_all)
        try:
            violations = future.result(timeout=12)  # always respond before 15s client deadline
        except concurrent.futures.TimeoutError:
            pass  # return empty violations rather than blocking past client timeout

    return {"violations": violations, "changed_files": files}
