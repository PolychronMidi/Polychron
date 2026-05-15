"""HME HTTP -- engine operations: enrich, validate, audit, reindex."""
import concurrent.futures
import logging
import os
import subprocess
import sys
import threading

# Central .env loader -- fail-fast semantics.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.http")

# Injected by worker.py via init_handlers().
_engine_ready: threading.Event = threading.Event()
_project_engine = None
_global_engine = None
PROJECT_ROOT: str = ""
METRICS_DIR: str = os.environ.get("METRICS_DIR", "")




def _enrich_prompt(prompt: str, frame: str = "") -> dict:
    """Prompt enrichment via local models -- self-contained, no MCP server imports.

    Uses the shim's own _project_engine for KB and calls llama.cpp directly.
    Returns {enriched, original, triage, trace}.
    """
    import json as _json
    import time as _time
    import urllib.request as _urlreq

    # All enrichment dispatch goes through llama-server /v1/chat/completions.
    _ENRICH_MODEL = ENV.require("HME_ARBITER_MODEL")
    _ENRICH_URL = ENV.require("HME_LLAMACPP_ARBITER_URL") + "/v1/chat/completions"
    _NUM_CTX_30B = ENV.require_int("HME_NUM_CTX_30B")

    trace = {"triage_ms": 0, "assembly_ms": 0, "enrich_ms": 0, "compress_ms": 0}
    t0 = _time.monotonic()

    # Stage 1: Skip arbiter triage in HTTP shim
    triage = {"kb": True, "structural": True, "contextual": True, "raw": "explicit"}

    # Stage 2: Context assembly (instant, no model)
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
        except Exception as e:
            logger.info(f"enrich_prompt: transcript load failed: {e}")
        summary_path = os.path.join(METRICS_DIR, "pipeline-summary.json")
        if os.path.exists(summary_path):
            try:
                with open(summary_path) as f:
                    ps = _json.load(f)
                assembled_parts.append(f"[Pipeline: {ps.get('verdict', 'unknown')}]")
            except Exception as e:
                logger.info(f"enrich_prompt: pipeline summary load failed: {e}")

    assembled = "\n\n".join(assembled_parts)
    trace["assembly_ms"] = int((_time.monotonic() - t1) * 1000)

    # Stage 3: Reasoning model enrichment
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
    messages = [
        {"role": "system", "content": "You enrich prompts with project-specific knowledge. Output only the enriched prompt."},
        {"role": "user",   "content": enrich_content},
    ]
    try:
        body = _json.dumps({
            "model": _ENRICH_MODEL,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 4096,
            "stream": False,
            "cache_prompt": True,
        }).encode()
        req = _urlreq.Request(_ENRICH_URL, data=body, headers={"Content-Type": "application/json"})
        with _urlreq.urlopen(req, timeout=180) as resp:
            resp_data = _json.loads(resp.read())
            choices = resp_data.get("choices") or []
            if choices and isinstance(choices[0], dict):
                msg = choices[0].get("message", {}) or {}
                enriched = (msg.get("content", "") or "").strip() if isinstance(msg, dict) else ""
            if "</think>" in enriched:
                enriched = enriched[enriched.rfind("</think>") + len("</think>"):].strip()
    except Exception as e:
        logger.error(f"enrich_prompt: reasoning model failed: {e}")
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": f"Reasoning model failed: {e}"}

    trace["enrich_ms"] = int((_time.monotonic() - t2) * 1000)

    if not enriched or len(enriched.strip()) < 10:
        return {"enriched": prompt, "original": prompt, "triage": triage, "trace": trace,
                "unchanged": True, "reason": "Reasoning model returned empty -- original preserved"}

    # Stage 4: Hard truncate only if absurdly long
    # Min floor of 2000 chars -- short prompts can legitimately expand significantly.
    max_len = max(len(prompt) * 10, 2000)
    if len(enriched) > max_len:
        enriched = enriched[:max_len]

    total_ms = int((_time.monotonic() - t0) * 1000)
    logger.info(
        f"enrich_prompt: {len(prompt)}->{len(enriched)} chars, "
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
                cwd=ENV.require("PROJECT_ROOT")
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
    truncated = False
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_search_all)
    try:
        violations = future.result(timeout=12)
    except concurrent.futures.TimeoutError:
        truncated = True
        logger.warning(f"audit: KB search timed out (12s) for {len(files)} files")
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    result = {"violations": violations, "changed_files": files}
    if truncated:
        result["truncated"] = True
    return result
