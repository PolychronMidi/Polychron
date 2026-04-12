"""RAG proxy — delegates engine calls to the persistent HTTP shim on localhost:7734.

Drop-in replacement for RAGEngine. The MCP server uses this instead of loading
its own SentenceTransformer + RAGEngine, eliminating the duplicate model loading
that wasted ~500MB RAM and ~10s startup time per restart.
"""
import json
import logging
import os
import subprocess
import time
import threading
import urllib.request

logger = logging.getLogger("HME")

_DEFAULT_PORT = 7734
_DISPATCH_TIMEOUT = 30
_HEALTH_TIMEOUT = 2


def _shim_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "hme_http.py")


def check_shim_health(port=_DEFAULT_PORT):
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=_HEALTH_TIMEOUT) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "ready" and data.get("kb_ready", False)
    except Exception:
        return False


def ensure_shim_running(port=_DEFAULT_PORT, max_wait=20):
    if check_shim_health(port):
        return True
    env = os.environ.copy()
    env["PROJECT_ROOT"] = os.environ.get("PROJECT_ROOT", os.getcwd())
    try:
        subprocess.Popen(
            ["python3", _shim_path(), "--port", str(port), "--daemon"],
            env=env, start_new_session=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        logger.warning(f"Failed to start HTTP shim: {e}")
        return False
    for _ in range(max_wait):
        time.sleep(1)
        if check_shim_health(port):
            return True
    return False


class RAGProxy:
    """Drop-in proxy for RAGEngine that routes through the HTTP shim."""

    def __init__(self, engine_name: str, port: int = _DEFAULT_PORT):
        self._engine = engine_name
        self._base = f"http://127.0.0.1:{port}"
        self._bulk_indexing = _FalseEvent()

    def _call(self, method: str, timeout=_DISPATCH_TIMEOUT, **kwargs):
        body = json.dumps({
            "engine": self._engine,
            "method": method,
            "kwargs": kwargs,
        }).encode()
        req = urllib.request.Request(
            f"{self._base}/rag", data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read()).get("result")
        except Exception as e:
            logger.warning(f"RAG proxy {self._engine}.{method}: {e}")
            return None

    # ── Knowledge methods ────────────────────────────────────────────────────

    def search_knowledge(self, query, top_k=10, category=None):
        return self._call("search_knowledge", query=query, top_k=top_k, category=category) or []

    def add_knowledge(self, title, content, category="general", tags=None, related_to="", relation_type=""):
        return self._call("add_knowledge", title=title, content=content, category=category,
                          tags=tags or [], related_to=related_to, relation_type=relation_type) or {}

    def remove_knowledge(self, entry_id):
        return self._call("remove_knowledge", entry_id=entry_id)

    def list_knowledge(self, category=None):
        return self._call("list_knowledge", category=category) or []

    def list_knowledge_full(self, category=None):
        return self._call("list_knowledge_full", category=category) or []

    def get_knowledge_status(self):
        return self._call("get_knowledge_status") or {}

    def compact_knowledge(self, similarity_threshold=0.85):
        return self._call("compact_knowledge", similarity_threshold=similarity_threshold) or {}

    def export_knowledge(self, category=None):
        return self._call("export_knowledge", category=category) or ""

    # ── Code search methods ──────────────────────────────────────────────────

    def search(self, query, top_k=10, language=None):
        return self._call("search", query=query, top_k=top_k, language=language) or []

    def search_budgeted(self, query, max_tokens=8000, language=None):
        return self._call("search_budgeted", query=query, max_tokens=max_tokens, language=language) or []

    def get_status(self):
        return self._call("get_status") or {}

    # ── Index methods ────────────────────────────────────────────────────────

    def index_directory(self, directory):
        return self._call("index_directory", directory=directory, timeout=120) or {}

    def index_symbols(self, symbols):
        return self._call("index_symbols", symbols=symbols, timeout=60) or {}

    def index_file(self, path):
        return self._call("index_file", path=path, timeout=10) or {}

    def clear(self):
        return self._call("clear", timeout=30)

    # ── Symbol methods ───────────────────────────────────────────────────────

    def lookup_symbol(self, name, kind="", language=""):
        return self._call("lookup_symbol", name=name, kind=kind, language=language) or []

    def search_symbols(self, query, top_k=20, kind=""):
        return self._call("search_symbols", query=query, top_k=top_k, kind=kind) or []

    def get_symbol_status(self):
        return self._call("get_symbol_status") or {}

    # ── Attribute proxies ────────────────────────────────────────────────────

    @property
    def symbol_table(self):
        return _SymbolTableProxy(self._engine, self._base)

    @property
    def model(self):
        return _ModelProxy(self._base)

    @property
    def _file_hashes(self):
        return self._call("_get_file_hashes") or {}


class _FalseEvent:
    def is_set(self):
        return False

    def set(self):
        pass

    def clear(self):
        pass


class _SymbolTableProxy:
    def __init__(self, engine, base_url):
        self._engine = engine
        self._base = base_url
        self._data = None

    def to_arrow(self):
        return self

    def to_pylist(self):
        if self._data is None:
            body = json.dumps({"engine": self._engine, "method": "_symbol_table_list"}).encode()
            req = urllib.request.Request(
                f"{self._base}/rag", data=body,
                headers={"Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    self._data = json.loads(resp.read()).get("result", [])
            except Exception:
                self._data = []
        return self._data


class _ModelProxy:
    def __init__(self, base_url):
        self._base = base_url

    def encode(self, texts, **kwargs):
        body = json.dumps({"method": "_encode", "kwargs": {"texts": list(texts) if not isinstance(texts, list) else texts}}).encode()
        req = urllib.request.Request(
            f"{self._base}/rag", data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                import numpy as np
                return np.array(json.loads(resp.read()).get("result", []))
        except Exception:
            return None
