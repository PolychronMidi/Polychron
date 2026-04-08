"""HME HTTP shim — full enrichment server for the HME chat ecosystem.

Endpoints:
  POST /enrich       — KB + transcript context for message enrichment
  POST /validate     — pre-send anti-pattern/constraint check
  POST /audit        — post-response changed-file constraint audit
  POST /reindex      — immediate mini-reindex of specific files
  GET  /transcript   — read recent session transcript entries (JSONL)
  POST /transcript   — append entries to session transcript
  GET  /health       — readiness check
  GET  /narrative    — latest narrative digest from transcript

Usage:
  PROJECT_ROOT=/path/to/project python hme_http.py [--port 7734]
"""
import os
import sys
import json
import logging
import argparse
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HME.http")
logger.setLevel(logging.INFO)

PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "HME")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HME", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "BAAI/bge-base-en-v1.5")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")

_engine_ready = threading.Event()
_project_engine = None
_global_engine = None


def _load_engines():
    global _project_engine, _global_engine
    try:
        from sentence_transformers import SentenceTransformer
        from rag_engine import RAGEngine
        from file_walker import init_config
        init_config(PROJECT_ROOT)
        os.makedirs(PROJECT_DB, exist_ok=True)
        os.makedirs(GLOBAL_DB, exist_ok=True)
        # Load model once, share across engines (same as MCP main.py)
        try:
            shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
        except Exception as e:
            logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
            shared_model = SentenceTransformer(MODEL_NAME)
        _project_engine = RAGEngine(PROJECT_DB, model_name=MODEL_NAME, model=shared_model)
        _global_engine = RAGEngine(GLOBAL_DB, model_name=MODEL_NAME, model=shared_model)
        logger.info("HME HTTP: engines ready")
    except Exception as e:
        logger.error(f"HME HTTP: engine load failed: {e}")
    finally:
        _engine_ready.set()


threading.Thread(target=_load_engines, daemon=True).start()

# ── Transcript store (server-side mirror of the JSONL log) ──────────────────

_TRANSCRIPT_PATH = os.path.join(PROJECT_ROOT, "log", "session-transcript.jsonl")
_transcript_lock = threading.Lock()
_MAX_TRANSCRIPT_MEMORY = 500
_transcript_entries: list[dict] = []
_latest_narrative: str = ""


def _load_transcript():
    """Load existing transcript from JSONL file into memory."""
    global _transcript_entries
    try:
        if not os.path.exists(_TRANSCRIPT_PATH):
            return
        with open(_TRANSCRIPT_PATH, "r") as f:
            lines = f.readlines()
        recent = lines[-_MAX_TRANSCRIPT_MEMORY:] if len(lines) > _MAX_TRANSCRIPT_MEMORY else lines
        entries = []
        for line in recent:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    pass
        with _transcript_lock:
            _transcript_entries = entries
    except Exception:
        pass

_load_transcript()


def _append_transcript(entries: list[dict]) -> int:
    """Append entries to transcript JSONL and memory. Returns count appended."""
    global _transcript_entries
    os.makedirs(os.path.dirname(_TRANSCRIPT_PATH), exist_ok=True)
    count = 0
    with _transcript_lock:
        with open(_TRANSCRIPT_PATH, "a") as f:
            for entry in entries:
                entry.setdefault("ts", int(time.time() * 1000))
                f.write(json.dumps(entry) + "\n")
                _transcript_entries.append(entry)
                count += 1
        if len(_transcript_entries) > _MAX_TRANSCRIPT_MEMORY:
            _transcript_entries = _transcript_entries[-_MAX_TRANSCRIPT_MEMORY:]
    return count


def _get_transcript(minutes: int = 30, max_entries: int = 50) -> list[dict]:
    """Get recent transcript entries within time window."""
    cutoff = (time.time() - minutes * 60) * 1000  # ms
    with _transcript_lock:
        filtered = [e for e in _transcript_entries if e.get("ts", 0) >= cutoff]
        return filtered[-max_entries:]


def _get_transcript_context(query: str = "", max_chars: int = 3000) -> str:
    """Build a context string from recent transcript for injection into messages."""
    recent = _get_transcript(minutes=60, max_entries=40)
    if not recent:
        return ""
    lines = ["[Session Transcript — recent activity]"]
    chars = len(lines[0])

    # Narratives first (most compact summary)
    for e in recent:
        if e.get("type") == "narrative":
            n = f"[Digest] {e.get('content', '')[:500]}"
            lines.append(n)
            chars += len(n)

    # Then summaries
    for e in recent:
        if e.get("type") == "narrative":
            continue
        ts = e.get("ts", 0)
        ts_str = time.strftime("%H:%M:%S", time.gmtime(ts / 1000)) if ts else "??:??:??"
        summary = e.get("summary", e.get("content", "")[:120])
        line = f"[{ts_str}] {summary}"
        if chars + len(line) > max_chars:
            break
        lines.append(line)
        chars += len(line)

    return "\n".join(lines)


def _reindex_files(files: list[str]) -> dict:
    """Trigger immediate mini-reindex of specific files via RAG engine."""
    _engine_ready.wait(timeout=10)
    if _project_engine is None:
        return {"error": "engines not ready", "indexed": []}

    indexed = []
    for filepath in files[:20]:
        abs_path = filepath if os.path.isabs(filepath) else os.path.join(PROJECT_ROOT, filepath)
        if not os.path.exists(abs_path):
            continue
        try:
            _project_engine.index_file(abs_path)
            indexed.append(filepath)
        except Exception as e:
            logger.warning(f"reindex failed for {filepath}: {e}")
    return {"indexed": indexed, "count": len(indexed)}


def _enrich(query: str, top_k: int = 5) -> dict:
    """Pull KB hits for query. Returns {kb: [...], warm: str}."""
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
    _engine_ready.wait(timeout=45)
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
    import subprocess
    _engine_ready.wait(timeout=10)
    if _project_engine is None:
        return {"violations": [], "error": "engines not ready"}

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
        except Exception:
            pass

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


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info(fmt % args)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            ready = _engine_ready.is_set() and _project_engine is not None
            self._send_json(200, {
                "status": "ready" if ready else "loading",
                "transcript_entries": len(_transcript_entries),
                "kb_ready": _project_engine is not None,
            })
        elif self.path.startswith("/transcript"):
            # Parse ?minutes=N&max=M from query string
            import urllib.parse
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            minutes = int(params.get("minutes", [30])[0])
            max_entries = int(params.get("max", [50])[0])
            entries = _get_transcript(minutes, max_entries)
            self._send_json(200, {"entries": entries, "count": len(entries)})
        elif self.path == "/narrative":
            global _latest_narrative
            self._send_json(200, {"narrative": _latest_narrative})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            self._send_json(400, {"error": f"bad request: {e}"})
            return

        if self.path == "/enrich":
            query = body.get("query", "")
            top_k = int(body.get("top_k", 5))
            if not query:
                self._send_json(400, {"error": "query required"})
                return
            self._send_json(200, _enrich(query, top_k=top_k))

        elif self.path == "/validate":
            query = body.get("query", "")
            if not query:
                self._send_json(400, {"error": "query required"})
                return
            self._send_json(200, _validate(query))

        elif self.path == "/audit":
            changed_files = body.get("changed_files", "")
            self._send_json(200, _post_audit(changed_files))

        elif self.path == "/transcript":
            entries = body.get("entries", [])
            if not isinstance(entries, list):
                self._send_json(400, {"error": "entries must be a list"})
                return
            count = _append_transcript(entries)
            self._send_json(200, {"appended": count})

        elif self.path == "/reindex":
            files = body.get("files", [])
            if not isinstance(files, list) or not files:
                self._send_json(400, {"error": "files must be a non-empty list"})
                return
            result = _reindex_files(files)
            self._send_json(200, result)

        elif self.path == "/narrative":
            # Store a narrative digest
            global _latest_narrative
            _latest_narrative = body.get("narrative", "")
            _append_transcript([{
                "type": "narrative",
                "content": _latest_narrative,
                "summary": f"📋 {_latest_narrative[:100]}",
            }])
            self._send_json(200, {"ok": True})

        else:
            self._send_json(404, {"error": "not found"})


def main():
    parser = argparse.ArgumentParser(description="HME HTTP enrichment shim")
    parser.add_argument("--port", type=int, default=7734)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), _Handler)
    logger.info(f"HME HTTP shim listening on {args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
