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


def init_handlers(engine_ready: threading.Event, project_engine, global_engine, project_root: str) -> None:
    """Wire engine references after startup. Call once engines are ready."""
    global _engine_ready, _project_engine, _global_engine, PROJECT_ROOT, METRICS_DIR
    _engine_ready = engine_ready
    _project_engine = project_engine
    _global_engine = global_engine
    PROJECT_ROOT = project_root
    METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics"))


def _is_indexable(abs_path: str) -> str | None:
    """Check if a file would be found by walk_code_files.  Returns None if OK,
    or a reason string if the file should be rejected."""
    from file_walker import get_ignore_dirs, get_max_file_size
    from lang_registry import SUPPORTED_EXTENSIONS, SUPPORTED_FILENAMES

    fname = os.path.basename(abs_path)
    suffix = os.path.splitext(fname)[1]

    # Extension/filename check
    if suffix not in SUPPORTED_EXTENSIONS and fname not in SUPPORTED_FILENAMES:
        return f"unsupported extension '{suffix}'"

    # Ignore-dir check: any path component in the ignore set
    ignore_dirs = get_ignore_dirs()
    parts = abs_path.split(os.sep)
    for part in parts:
        if part in ignore_dirs:
            return f"path contains ignored dir '{part}'"

    # Size check
    try:
        if os.path.getsize(abs_path) > get_max_file_size():
            return f"exceeds max file size ({get_max_file_size()} bytes)"
    except OSError as _size_err:
        # File was path-valid but stat failed. Without size-check, a
        logger.error(f"size probe FAILED for {abs_path} -- downstream read may OOM: {type(_size_err).__name__}: {_size_err}")
        return f"size probe failed: {type(_size_err).__name__}"

    return None


def _reindex_files(files: list[str]) -> dict:
    """Trigger immediate mini-reindex of specific files via RAG engine.
    All files are validated against the file_walker indexing rules (supported
    extensions, ignore dirs, max size) so this endpoint cannot bypass the
    project's index whitelist."""
    from hme_http_store import _log_error
    if not _engine_ready.is_set():
        return {"indexed": [], "count": 0, "deferred": "engines starting"}
    if _project_engine is None:
        _log_error("reindex", "engines not ready -- cannot reindex files")
        return {"error": "engines not ready", "indexed": [], "count": 0}

    if _project_engine._bulk_indexing.is_set():
        return {"indexed": [], "count": 0, "deferred": "bulk index in progress"}

    indexed = []
    skipped = []
    # Budget: generous caps for batched reindex calls using bge-code-v1 fp16,
    import time as _time
    _budget = ENV.optional_int("RAG_REINDEX_BUDGET_S", 180)
    _per_file = ENV.optional_int("RAG_REINDEX_PER_FILE_CAP_S", 60)
    deadline = _time.monotonic() + _budget
    _per_file_cap = _per_file
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        for filepath in files[:20]:
            if _time.monotonic() >= deadline:
                skipped.extend(f for f in files[:20] if f not in indexed and f != filepath)
                skipped.append(filepath)
                break
            abs_path = filepath if os.path.isabs(filepath) else os.path.join(PROJECT_ROOT, filepath)
            abs_path = os.path.realpath(abs_path)
            if not abs_path.startswith(os.path.realpath(PROJECT_ROOT) + os.sep):
                skipped.append(filepath)
                continue
            reject = _is_indexable(abs_path)
            if reject:
                logger.info(f"reindex: rejected {filepath} ({reject})")
                skipped.append(filepath)
                continue
            if not os.path.exists(abs_path):
                basename = os.path.basename(abs_path)
                found = None
                _skip = {".git", "node_modules", "__pycache__", "venv", ".venv", "out", "lab"}
                for root, _dirs, fnames in os.walk(PROJECT_ROOT):
                    _dirs[:] = [d for d in _dirs if d not in _skip]
                    if basename in fnames:
                        candidate = os.path.join(root, basename)
                        if os.path.realpath(candidate).startswith(os.path.realpath(PROJECT_ROOT) + os.sep):
                            found = candidate
                            break
                if found:
                    abs_path = os.path.realpath(found)
                    logger.info(f"reindex: resolved {filepath} -> {found}")
                    # Re-check resolved path against indexing rules
                    reject = _is_indexable(abs_path)
                    if reject:
                        logger.info(f"reindex: rejected resolved {abs_path} ({reject})")
                        skipped.append(filepath)
                        continue
                else:
                    _log_error("reindex", f"file not found: {filepath}")
                    skipped.append(filepath)
                    continue
            # Size gate: 128 KB default. Bigger than the old 32 KB so
            _size_gate = ENV.optional_int("RAG_REINDEX_SIZE_GATE_BYTES", 131072)
            if os.path.getsize(abs_path) > _size_gate:
                skipped.append(filepath)
                continue
            # Content gate: skip files with auto-generated markers at top.
            try:
                with open(abs_path, encoding="utf-8", errors="ignore") as _af:
                    _header = "".join(_af.readline() for _ in range(5))
                if "AUTO-GENERATED" in _header or "GENERATED FILE" in _header:
                    skipped.append(filepath)
                    continue
            except OSError as _ge:
                _log_error("reindex", f"auto-gen header probe failed for {filepath}: {_ge}")
                skipped.append(filepath)
                continue
            remaining = max(1, deadline - _time.monotonic())
            per_file_timeout = min(_per_file_cap, remaining)
            future = executor.submit(_project_engine.index_file, abs_path)
            try:
                future.result(timeout=per_file_timeout)
                indexed.append(filepath)
            except concurrent.futures.TimeoutError:
                _log_error("reindex", f"timeout indexing {filepath} ({per_file_timeout:.0f}s)")
                skipped.append(filepath)
            except Exception as e:
                # silent-ok: optional fallback path.
                _log_error("reindex", f"index_file failed for {filepath}: {e}")
                skipped.append(filepath)
    result = {"indexed": indexed, "count": len(indexed)}
    if skipped:
        result["skipped"] = skipped
    return result


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



# Re-exports -- enrich_prompt + post_audit extracted.
from hme_http_enrich_audit import _enrich_prompt, _post_audit  # noqa: F401, E402
