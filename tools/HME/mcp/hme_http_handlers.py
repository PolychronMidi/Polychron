"""HME HTTP — engine operations: enrich, validate, audit, reindex."""
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

    indexed = []
    for filepath in files[:20]:
        abs_path = filepath if os.path.isabs(filepath) else os.path.join(PROJECT_ROOT, filepath)
        if not os.path.exists(abs_path):
            _log_error("reindex", f"file not found: {filepath}")
            continue
        try:
            _project_engine.index_file(abs_path)
            indexed.append(filepath)
        except Exception as e:
            _log_error("reindex", f"index_file failed for {filepath}: {e}")
    return {"indexed": indexed, "count": len(indexed)}


def _enrich(query: str, top_k: int = 5) -> dict:
    """Pull KB hits for query. Returns {kb: [...], warm: str}."""
    from hme_http_store import _get_transcript_context
    _engine_ready.wait(timeout=45)
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


def _post_audit(changed_files: str = "") -> dict:
    """Post-response audit: run git diff to detect changed files, search KB for violations."""
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

    violations = []
    for f in files[:10]:  # cap at 10 files
        # Search KB for constraints related to this file/module
        module = os.path.splitext(os.path.basename(f))[0]
        hits = _project_engine.search_knowledge(module, top_k=4)
        for h in hits:
            cat = h.get("category", "")
            score = round(1.0 / (1.0 + h.get("_distance", 999)), 3)
            if score >= 0.40 and cat in ("bugfix", "antipattern", "architecture"):
                violations.append({
                    "file": f,
                    "title": h.get("title", ""),
                    "content": h.get("content", "")[:300],
                    "category": cat,
                    "score": score,
                })

    return {"violations": violations, "changed_files": files}
