import lancedb
import pyarrow as pa
from sentence_transformers import SentenceTransformer
from pathlib import Path
from typing import Optional
import hashlib
import json
import logging
import os
import time
import uuid
from functools import lru_cache
from collections import OrderedDict
import threading

from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS
from file_walker import walk_code_files, get_max_file_size

logger = logging.getLogger(__name__)

BATCH_SIZE = 64
CACHE_TTL = 300  # 5 minutes


class _TTLCache:
    """Simple thread-safe LRU cache with TTL expiry."""

    def __init__(self, maxsize: int = 256, ttl: float = CACHE_TTL):
        self._maxsize = maxsize
        self._ttl = ttl
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._data:
                return None
            value, ts = self._data[key]
            if time.time() - ts > self._ttl:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key, value):
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = (value, time.time())
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def invalidate(self):
        with self._lock:
            self._data.clear()


def _chunk_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _bm25_search(corpus: list[str], query: str, top_k: int) -> list[tuple[int, float]]:
    """BM25 keyword search over corpus. Returns (index, score) pairs sorted by score desc."""
    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        return []
    tokenized_corpus = [doc.lower().split() for doc in corpus]
    bm25 = BM25Okapi(tokenized_corpus)
    scores = bm25.get_scores(query.lower().split())
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [(i, float(scores[i])) for i in top_indices if scores[i] > 0]


def _rrf_fuse(semantic_ranked: list[int], bm25_ranked: list[int], k: int = 60) -> list[int]:
    """Reciprocal Rank Fusion of two ranked lists. Returns merged indices by score desc."""
    scores: dict[int, float] = {}
    for rank, idx in enumerate(semantic_ranked):
        scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    for rank, idx in enumerate(bm25_ranked):
        scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda i: scores[i], reverse=True)

def _cross_encode_rerank(query: str, rows: list, text_key, fallback_score_key: str = "_distance") -> list[tuple]:
    """Cross-encoder reranking. Falls back to semantic score if model unavailable."""
    try:
        from sentence_transformers import CrossEncoder
        model = _get_cross_encoder()
        pairs = [(query, text_key(r)) for r in rows]
        scores = model.predict(pairs)
        ranked = sorted(zip(rows, scores.tolist()), key=lambda x: x[1], reverse=True)
        return [(r, float(s)) for r, s in ranked]
    except Exception:
        # Graceful fallback: return with semantic score
        return [(r, float(1.0 / (1.0 + r.get(fallback_score_key, 0)))) for r in rows]


_cross_encoder_instance = None
_cross_encoder_lock = threading.Lock()

def _get_cross_encoder():
    global _cross_encoder_instance
    if _cross_encoder_instance is None:
        with _cross_encoder_lock:
            if _cross_encoder_instance is None:
                from sentence_transformers import CrossEncoder
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                _cross_encoder_instance = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-12-v2", device=device)
    return _cross_encoder_instance



_VECTOR_DIM = 768  # updated by RAGEngine.__init__ from model.get_sentence_embedding_dimension()


def _code_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("content", pa.utf8()),
        pa.field("source", pa.utf8()),
        pa.field("start_line", pa.int32()),
        pa.field("end_line", pa.int32()),
        pa.field("language", pa.utf8()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _knowledge_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("title", pa.utf8()),
        pa.field("content", pa.utf8()),
        pa.field("category", pa.utf8()),
        pa.field("tags", pa.utf8()),
        pa.field("timestamp", pa.float64()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _symbol_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("name", pa.utf8()),
        pa.field("kind", pa.utf8()),
        pa.field("signature", pa.utf8()),
        pa.field("file", pa.utf8()),
        pa.field("line", pa.int32()),
        pa.field("language", pa.utf8()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _extract_signatures(text: str, language: str) -> list[str]:
    import re
    sigs = []
    if language in ("rust",):
        for m in re.finditer(r'^\s*(pub\s+)?(async\s+)?(fn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\))', text, re.MULTILINE):
            sigs.append(m.group(3).strip())
        for m in re.finditer(r'^\s*(pub\s+)?(struct|enum|trait|type|impl)\s+(\S+)', text, re.MULTILINE):
            sigs.append(f"{m.group(2)} {m.group(3)}")
    elif language in ("typescript", "javascript", "vue"):
        for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'(?:export\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
        for m in re.finditer(r'^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'else'):
                sigs.append(f".{name}(...)")
    elif language in ("python",):
        for m in re.finditer(r'^\s*(?:async\s+)?def\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}(...)")
        for m in re.finditer(r'^\s*class\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"class {m.group(1)}")
    elif language in ("c", "cpp"):
        for m in re.finditer(r'^\s*(?:virtual\s+|static\s+|inline\s+|extern\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'else'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum|union|namespace)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("csharp",):
        for m in re.finditer(r'^\s*(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'foreach', 'lock', 'using'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:public|private|protected|internal|static|abstract|sealed|\s)*(?:class|struct|enum|interface|record|namespace)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("go",):
        for m in re.finditer(r'^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"func {m.group(1)}(...)")
        for m in re.finditer(r'^\s*type\s+(\w+)\s+(struct|interface)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)} {m.group(2)}")
    elif language in ("php",):
        for m in re.finditer(r'^\s*(?:public|private|protected|static|\s)*function\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+|final\s+)?class\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"class {m.group(1)}")
        for m in re.finditer(r'^\s*(?:interface|trait|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("java",):
        for m in re.finditer(r'^\s*(?:public|private|protected|static|abstract|final|synchronized|native|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?(?:\s*[{;])', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'synchronized'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:public|private|protected|static|abstract|final|\s)*(?:class|interface|enum|@interface)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("kotlin",):
        for m in re.finditer(r'^\s*(?:(?:public|private|protected|internal|override|open|abstract|suspend|inline|infix|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"fun {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|enum|inner|annotation|value)\s+)*(?:class|interface|object)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("scala",):
        for m in re.finditer(r'^\s*(?:override\s+)?(?:private|protected)?\s*def\s+(\w+)\s*(?:\[[^\]]*\])?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+|sealed\s+|case\s+|final\s+)*(?:class|object|trait)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("ruby",):
        for m in re.finditer(r'^\s*def\s+(self\.)?(\w+[?!=]?)', text, re.MULTILINE):
            prefix = "self." if m.group(1) else ""
            sigs.append(f"def {prefix}{m.group(2)}")
        for m in re.finditer(r'^\s*(?:class|module)\s+(\w+(?:::\w+)*)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("lua",):
        for m in re.finditer(r'^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
    elif language in ("swift",):
        for m in re.finditer(r'^\s*(?:(?:public|private|internal|fileprivate|open|override|static|class|mutating)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"func {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|enum|protocol|extension|actor)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("dart",):
        for m in re.finditer(r'^\s*(?:(?:static|abstract|external|factory)\s+)*[\w<>\[\]?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+)?(?:class|mixin|enum|extension|typedef)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("elixir",):
        for m in re.finditer(r'^\s*(?:def|defp|defmacro|defmacrop)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}")
        for m in re.finditer(r'^\s*defmodule\s+([\w.]+)', text, re.MULTILINE):
            sigs.append(f"defmodule {m.group(1)}")
    elif language in ("haskell",):
        for m in re.finditer(r'^(\w+)\s*::\s*(.+)$', text, re.MULTILINE):
            sigs.append(f"{m.group(1)} :: {m.group(2).strip()[:60]}")
        for m in re.finditer(r'^\s*(?:data|newtype|type|class|instance)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("r",):
        for m in re.finditer(r'^(\w+)\s*(?:<-|=)\s*function\s*\(', text, re.MULTILINE):
            sigs.append(f"{m.group(1)} <- function(...)")
    elif language in ("julia",):
        for m in re.finditer(r'^\s*function\s+(\w+)\s*(?:\{[^}]*\})?\s*\(', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:mutable\s+)?(?:struct|abstract\s+type|module)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("perl",):
        for m in re.finditer(r'^\s*sub\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"sub {m.group(1)}")
        for m in re.finditer(r'^\s*package\s+([\w:]+)', text, re.MULTILINE):
            sigs.append(f"package {m.group(1)}")
    elif language in ("bash",):
        for m in re.finditer(r'^\s*(?:function\s+)?(\w+)\s*\(\s*\)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}()")
    elif language in ("zig",):
        for m in re.finditer(r'^\s*(?:pub\s+)?fn\s+(\w+)\s*\(', text, re.MULTILINE):
            sigs.append(f"fn {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:pub\s+)?const\s+(\w+)\s*=\s*struct\s*\{', text, re.MULTILINE):
            sigs.append(f"const {m.group(1)} = struct")
    elif language in ("nim",):
        for m in re.finditer(r'^\s*(?:proc|func|method|iterator|template|macro)\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(', text, re.MULTILINE):
            sigs.append(f"{m.group(0).split('(')[0].strip()}(...)")
        for m in re.finditer(r'^\s*type\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)}")
    elif language in ("ocaml",):
        for m in re.finditer(r'^\s*let\s+(?:rec\s+)?(\w+)', text, re.MULTILINE):
            sigs.append(f"let {m.group(1)}")
        for m in re.finditer(r'^\s*module\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"module {m.group(1)}")
        for m in re.finditer(r'^\s*type\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)}")
    elif language in ("erlang",):
        for m in re.finditer(r'^(\w+)\s*\([^)]*\)\s*->', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}(...)")
        for m in re.finditer(r'^-module\((\w+)\)', text, re.MULTILINE):
            sigs.append(f"-module({m.group(1)})")
    elif language in ("objective_c",):
        for m in re.finditer(r'^[-+]\s*\([^)]*\)\s*(\w+)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}")
        for m in re.finditer(r'^@(?:interface|implementation|protocol)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"@{m.group(0).split()[0][1:]} {m.group(1)}")
        for m in re.finditer(r'^\s*(?:virtual\s+|static\s+|inline\s+|extern\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'else'):
                sigs.append(f"{name}(...)")
    elif language in ("proto",):
        for m in re.finditer(r'^\s*(?:message|service|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
        for m in re.finditer(r'^\s*rpc\s+(\w+)\s*\(', text, re.MULTILINE):
            sigs.append(f"rpc {m.group(1)}(...)")
    elif language in ("sql",):
        for m in re.finditer(r'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)', text, re.MULTILINE | re.IGNORECASE):
            sigs.append(m.group(0).strip())
    elif language in ("glsl", "hlsl", "wgsl"):
        for m in re.finditer(r'^\s*(?:void|float|vec[234]|mat[234]|int|uint|bool|half[234]?|f(?:16|32))\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:struct|cbuffer|tbuffer)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"struct {m.group(1)}")
        if language == "wgsl":
            for m in re.finditer(r'^\s*fn\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
                sigs.append(f"fn {m.group(1)}(...)")
    elif language in ("asm",):
        for m in re.finditer(r'^(\w+):', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}:")
    seen = set()
    return [s for s in sigs if not (s in seen or seen.add(s))]


def summarize_chunk(content: str, language: str, max_context_lines: int = 3) -> str:
    sigs = _extract_signatures(content, language)
    if sigs:
        return " | ".join(sigs)
    lines = [l.rstrip() for l in content.split("\n") if l.strip() and not l.strip().startswith(("//", "#", "/*", "*", "<!--"))]
    return " | ".join(lines[:max_context_lines]) if lines else "(empty)"


def _chunk_by_lines(text: str, chunk_lines: int = 60, overlap_lines: int = 10) -> list[tuple[int, int, str]]:
    lines = text.split("\n")
    if len(lines) <= chunk_lines:
        return [(1, len(lines), text)]
    chunks = []
    step = chunk_lines - overlap_lines
    for i in range(0, len(lines), step):
        end = min(i + chunk_lines, len(lines))
        chunk = "\n".join(lines[i:end])
        chunks.append((i + 1, end, chunk))
        if end >= len(lines):
            break
    return chunks


def _file_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


class RAGEngine:
    def __init__(self, db_path: str, model_name: str = "all-mpnet-base-v2", model: Optional[SentenceTransformer] = None):
        self.db_path = db_path
        self.db = lancedb.connect(db_path)
        self.model = model or SentenceTransformer(model_name)
        # Dynamic vector dimension from the actual model
        self._dim = self.model.get_sentence_embedding_dimension()
        self._code_schema = _code_schema(self._dim)
        self._knowledge_schema = _knowledge_schema(self._dim)
        self._symbol_schema = _symbol_schema(self._dim)
        self.table: Optional[lancedb.table.Table] = None
        self.knowledge_table: Optional[lancedb.table.Table] = None
        self.symbol_table: Optional[lancedb.table.Table] = None
        self.hash_cache_path = os.path.join(db_path, "file_hashes.json")
        self._file_hashes: dict[str, str] = {}
        self._chunk_hashes: set[str] = set()  # chunk-level dedup
        self._search_cache = _TTLCache(maxsize=256, ttl=CACHE_TTL)
        self._knowledge_cache = _TTLCache(maxsize=128, ttl=CACHE_TTL)
        self._access_log: dict[str, int] = {}  # FSRS-6: per-entry retrieval count for spaced repetition
        self._load_hashes()
        self._try_open_table()
        self._try_open_knowledge_table()
        self._try_open_symbol_table()
        self._validate_cache()
        self._rebuild_chunk_hashes()

    def _load_hashes(self):
        if os.path.exists(self.hash_cache_path):
            try:
                with open(self.hash_cache_path, "r") as f:
                    self._file_hashes = json.load(f)
            except Exception:
                self._file_hashes = {}

    def _save_hashes(self):
        os.makedirs(os.path.dirname(self.hash_cache_path), exist_ok=True)
        with open(self.hash_cache_path, "w") as f:
            json.dump(self._file_hashes, f)

    def _try_open_table(self):
        try:
            self.table = self.db.open_table("code_chunks")
        except Exception:
            self.table = None

    def _validate_cache(self):
        if self._file_hashes and self.table is None:
            logger.info("Hash cache exists but code_chunks table missing - clearing cache for full re-index")
            self._file_hashes = {}
            self._save_hashes()
        elif self.table is not None and self._file_hashes:
            try:
                table_count = self.table.count_rows()
                if table_count == 0:
                    logger.info("code_chunks table empty but cache non-empty - clearing cache")
                    self._file_hashes = {}
                    self._save_hashes()
            except Exception:
                pass

    def _rebuild_chunk_hashes(self):
        """Populate in-memory chunk hash set from existing table to enable dedup on re-index."""
        if self.table is None:
            return
        try:
            rows = self.table.to_arrow().to_pylist()
            self._chunk_hashes = {_chunk_hash(r["content"]) for r in rows}
        except Exception:
            self._chunk_hashes = set()

    def _collect_files(self, directory: str) -> list[Path]:
        return list(walk_code_files(directory))

    def _batch_encode(self, texts: list[str]) -> list[list[float]]:
        results = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i:i + BATCH_SIZE]
            embeddings = self.model.encode(batch, show_progress_bar=False)
            results.extend(embeddings.tolist())
        return results

    def index_directory(self, directory: str) -> dict:
        files = self._collect_files(directory)
        logger.info(f"Collected {len(files)} source files")

        pending_chunks: list[dict] = []
        pending_texts: list[str] = []
        indexed_files = 0
        skipped_files = 0

        for file_path in files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            file_key = str(file_path)
            content_hash = _file_hash(content)

            if self._file_hashes.get(file_key) == content_hash:
                skipped_files += 1
                continue

            lang = ext_to_lang(file_path.suffix if file_path.suffix else file_path.name)
            from chunker import chunk_by_functions
            chunks = chunk_by_functions(content, lang)

            for chunk in chunks:
                if len(chunk["content"].strip()) < 10:
                    continue
                ch = _chunk_hash(chunk["content"])
                if ch in self._chunk_hashes:
                    continue  # identical chunk already indexed (cross-file dedup)
                self._chunk_hashes.add(ch)
                chunk_id = f"{file_key}:{chunk['start_line']}-{chunk['end_line']}"
                pending_chunks.append({
                    "id": chunk_id,
                    "content": chunk["content"],
                    "source": file_key,
                    "start_line": chunk["start_line"],
                    "end_line": chunk["end_line"],
                    "language": lang,
                })
                pending_texts.append(chunk["content"])

            self._file_hashes[file_key] = content_hash
            indexed_files += 1

        if pending_texts:
            logger.info(f"Encoding {len(pending_texts)} chunks...")
            vectors = self._batch_encode(pending_texts)
            for chunk, vec in zip(pending_chunks, vectors):
                chunk["vector"] = vec

        if pending_chunks:
            if self.table is not None:
                stale_sources = {c["source"] for c in pending_chunks}
                try:
                    existing = self.table.to_arrow()
                    source_col = existing.column("source").to_pylist()
                    keep_mask = [s not in stale_sources for s in source_col]
                    keep_table = existing.filter(keep_mask)
                    merged = keep_table.to_pylist()
                    merged.extend(pending_chunks)
                    self.table = self.db.create_table("code_chunks", data=merged, schema=self._code_schema, mode="overwrite")
                except Exception:
                    self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")
            else:
                self.table = self.db.create_table("code_chunks", data=pending_chunks, schema=self._code_schema, mode="overwrite")

        self._save_hashes()
        if pending_chunks:
            self._search_cache.invalidate()

        return {
            "total_files": len(files),
            "indexed": indexed_files,
            "skipped_unchanged": skipped_files,
            "chunks_created": len(pending_chunks),
        }

    @staticmethod
    def _sanitize(value: str) -> str:
        return value.replace("'", "''")

    def search(self, query: str, top_k: int = 10, language: Optional[str] = None) -> list[dict]:
        if self.table is None:
            return []

        cache_key = (query, top_k, language)
        cached = self._search_cache.get(cache_key)
        if cached is not None:
            return cached

        # Semantic search: fetch 2x candidates for RRF headroom
        fetch_k = min(top_k * 2, 60)
        query_vec = self.model.encode(query).tolist()
        builder = self.table.search(query_vec).limit(fetch_k)
        if language:
            builder = builder.where(f"language = '{self._sanitize(language)}'")
        try:
            sem_rows = builder.to_list()
        except Exception as e:
            logger.error(f"Semantic search failed: {e}")
            return []

        if not sem_rows:
            return []

        # BM25 search over same candidate set (avoids full-table BM25 cost)
        corpus = [r["content"] for r in sem_rows]
        bm25_hits = _bm25_search(corpus, query, top_k=fetch_k)
        bm25_ranked = [i for i, _ in bm25_hits]
        sem_ranked = list(range(len(sem_rows)))

        fused = _rrf_fuse(sem_ranked, bm25_ranked)[:top_k]

        results = []
        for i in fused:
            r = sem_rows[i]
            sem_score = float(1.0 / (1.0 + r.get("_distance", 0)))
            bm25_score = next((s for j, s in bm25_hits if j == i), 0.0)
            combined = 0.6 * sem_score + 0.4 * min(bm25_score / 10.0, 1.0)
            results.append({
                "content": r["content"],
                "source": r["source"],
                "start_line": r["start_line"],
                "end_line": r["end_line"],
                "language": r["language"],
                "score": combined,
            })

        # Auto-KB enrichment: tag each result with relevant knowledge constraints
        if self.knowledge_table is not None:
            for r in results:
                module = os.path.basename(r["source"]).replace(".js", "").replace(".ts", "")
                try:
                    kb_vec = self.model.encode(module).tolist()
                    kb_hits = self.knowledge_table.search(kb_vec).limit(2).to_list()
                    kb_tags = [h["title"] for h in kb_hits if h.get("_distance", 999) < 1.2]
                    if kb_tags:
                        r["kb_constraints"] = kb_tags
                except Exception:
                    pass

        self._search_cache.set(cache_key, results)
        return results

    def _count_tokens(self, text: str) -> int:
        """Count tokens using Anthropic API (free, precise) with char-estimate fallback."""
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        # Also check common key file locations
        if not api_key:
            for key_path in [os.path.expanduser("~/.anthropic/api_key"), os.path.expanduser("~/.config/anthropic/key")]:
                try:
                    api_key = open(key_path).read().strip()
                    if api_key:
                        break
                except Exception:
                    pass
        if api_key and len(text) > 50:
            try:
                import httpx
                resp = httpx.post(
                    "https://api.anthropic.com/v1/messages/count_tokens",
                    headers={"x-api-key": api_key, "content-type": "application/json", "anthropic-version": "2023-06-01"},
                    json={"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": text}]},
                    timeout=3.0
                )
                if resp.status_code == 200:
                    return resp.json().get("input_tokens", len(text) // 4)
            except Exception:
                pass
        return len(text) // 4  # fallback: ~4 chars per token

    def search_budgeted(self, query: str, max_tokens: int = 8000, language: Optional[str] = None) -> list[dict]:
        """Search and pack results into a token budget. Uses Anthropic token counting API when available."""
        # Fetch more candidates than typical to have packing options
        candidates = self.search(query, top_k=30, language=language)
        if not candidates:
            return []
        packed = []
        used_tokens = 0
        for r in candidates:
            chunk_tokens = self._count_tokens(r["content"])
            if used_tokens + chunk_tokens > max_tokens:
                # Try to fit a truncated version if it's high relevance
                if r["score"] > 0.3 and used_tokens + 200 < max_tokens:
                    remaining = max_tokens - used_tokens
                    r = dict(r)
                    r["content"] = r["content"][:remaining * 4] + "\n... (truncated)"
                    r["truncated"] = True
                    packed.append(r)
                    break
                # Skip this chunk but continue to smaller ones
                continue
            packed.append(r)
            used_tokens += chunk_tokens
        return packed

    def get_status(self) -> dict:
        self._try_open_table()
        if self.table is None:
            return {"indexed": False, "total_chunks": 0, "total_files": 0}
        try:
            count = self.table.count_rows()
            arrow_table = self.table.to_arrow()
            sources = len(set(arrow_table.column("source").to_pylist()))
        except Exception:
            count = 0
            sources = 0
        return {"indexed": True, "total_chunks": count, "total_files": sources}

    def clear(self):
        try:
            self.db.drop_table("code_chunks")
        except Exception:
            pass
        self.table = None
        self._file_hashes = {}
        self._save_hashes()

    def _try_open_knowledge_table(self):
        try:
            self.knowledge_table = self.db.open_table("knowledge")
        except Exception:
            self.knowledge_table = None

    def _try_open_symbol_table(self):
        try:
            self.symbol_table = self.db.open_table("symbols")
        except Exception:
            self.symbol_table = None

    def index_symbols(self, symbols: list[dict]) -> dict:
        if not symbols:
            return {"indexed": 0}

        records = []
        texts = []
        for s in symbols:
            embed_text = f"{s['kind']} {s['name']} {s['signature']}"
            records.append({
                "id": f"{s['file']}:{s['line']}:{s['name']}",
                "name": s["name"],
                "kind": s["kind"],
                "signature": s["signature"],
                "file": s["file"],
                "line": s["line"],
                "language": s["language"],
            })
            texts.append(embed_text)

        vectors = self._batch_encode(texts)
        for rec, vec in zip(records, vectors):
            rec["vector"] = vec

        self.symbol_table = self.db.create_table(
            "symbols", data=records, schema=self._symbol_schema, mode="overwrite"
        )
        return {"indexed": len(records)}

    def lookup_symbol(self, name: str, kind: str = "", language: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        try:
            rows = self.symbol_table.to_arrow().to_pylist()
            results = []
            name_lower = name.lower()
            for r in rows:
                if name_lower not in r["name"].lower():
                    continue
                if kind and r["kind"] != kind:
                    continue
                if language and r["language"] != language:
                    continue
                results.append({
                    "name": r["name"],
                    "kind": r["kind"],
                    "signature": r["signature"],
                    "file": r["file"],
                    "line": r["line"],
                    "language": r["language"],
                })
            results.sort(key=lambda x: (x["name"].lower() != name_lower, x["kind"], x["file"]))
            return results[:50]
        except Exception as e:
            logger.error(f"Symbol lookup failed: {e}")
            return []

    def search_symbols(self, query: str, top_k: int = 20, kind: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        query_vec = self.model.encode(query).tolist()
        builder = self.symbol_table.search(query_vec).limit(top_k)
        if kind:
            builder = builder.where(f"kind = '{self._sanitize(kind)}'")
        try:
            results = builder.to_list()
        except Exception as e:
            logger.error(f"Symbol search failed: {e}")
            return []
        return [
            {
                "name": r["name"],
                "kind": r["kind"],
                "signature": r["signature"],
                "file": r["file"],
                "line": r["line"],
                "language": r["language"],
                "score": float(1.0 / (1.0 + r.get("_distance", 0))),
            }
            for r in results
        ]

    def get_symbol_status(self) -> dict:
        self._try_open_symbol_table()
        if self.symbol_table is None:
            return {"indexed": False, "total_symbols": 0}
        try:
            count = self.symbol_table.count_rows()
            return {"indexed": True, "total_symbols": count}
        except Exception:
            return {"indexed": False, "total_symbols": 0}

    def add_knowledge(self, title: str, content: str, category: str = "general", tags: list[str] | None = None, related_to: str = "", relation_type: str = "") -> dict:
        # Prediction error gating: check if this knowledge is redundant, contradictory, or novel
        prediction_action = "store"  # default: novel -> store
        superseded_id = None
        if self.knowledge_table is not None:
            embed_text_check = f"{title}\n{content}"
            check_vec = self.model.encode(embed_text_check).tolist()
            try:
                existing = self.knowledge_table.search(check_vec).limit(3).to_list()
                for ex in existing:
                    similarity = 1.0 / (1.0 + ex.get("_distance", 999))
                    if similarity > 0.85:
                        # Very similar -> merge (redundant)
                        prediction_action = "merge"
                        superseded_id = ex["id"]
                        # Update the existing entry's content with merged info
                        merged_content = ex["content"] + "\n[Updated] " + content
                        try:
                            self.knowledge_table.delete(f"id = '{self._sanitize(ex['id'])}'")
                        except Exception:
                            pass
                        content = merged_content
                        title = ex["title"]  # keep original title
                        category = ex["category"]
                        break
                    elif similarity > 0.6 and category == ex.get("category", ""):
                        # Moderately similar + same category -> supersede
                        prediction_action = "supersede"
                        superseded_id = ex["id"]
                        try:
                            self.knowledge_table.delete(f"id = '{self._sanitize(ex['id'])}'")
                        except Exception:
                            pass
                        break
            except Exception:
                pass  # gating failure -> store normally

        entry_id = uuid.uuid4().hex[:12]
        tags_str = ",".join(tags) if tags else ""
        # Typed relationship: store as "type:id" for graph traversal
        if related_to:
            rel_tag = f"{relation_type}:{related_to}" if relation_type else related_to
            tags_str = f"{tags_str},{rel_tag}" if tags_str else rel_tag
        if superseded_id and prediction_action == "supersede":
            tags_str = f"{tags_str},supersedes:{superseded_id}" if tags_str else f"supersedes:{superseded_id}"
        embed_text = f"{title}\n{content}"
        vector = self.model.encode(embed_text).tolist()

        record = {
            "id": entry_id,
            "title": title,
            "content": content,
            "category": category,
            "tags": tags_str,
            "timestamp": time.time(),
            "vector": vector,
        }

        if self.knowledge_table is not None:
            self.knowledge_table.add([record])
        else:
            self.knowledge_table = self.db.create_table("knowledge", data=[record], schema=self._knowledge_schema, mode="overwrite")

        self._knowledge_cache.invalidate()
        return {"id": entry_id, "title": title, "category": category, "action": prediction_action, "superseded": superseded_id}

    def search_knowledge(self, query: str, top_k: int = 10, category: str | None = None) -> list[dict]:
        if self.knowledge_table is None:
            return []

        cache_key = ("kb", query, top_k, category)
        cached = self._knowledge_cache.get(cache_key)
        if cached is not None:
            return cached

        fetch_k = min(top_k * 3, 30)
        query_vec = self.model.encode(query).tolist()
        builder = self.knowledge_table.search(query_vec).limit(fetch_k)
        if category:
            builder = builder.where(f"category = '{self._sanitize(category)}'")
        try:
            sem_rows = builder.to_list()
        except Exception as e:
            logger.error(f"Knowledge search failed: {e}")
            return []

        if not sem_rows:
            return []

        # BM25 over combined title+content
        corpus = [f"{r['title']} {r['content']}" for r in sem_rows]
        bm25_hits = _bm25_search(corpus, query, top_k=fetch_k)
        bm25_ranked = [i for i, _ in bm25_hits]
        fused = _rrf_fuse(list(range(len(sem_rows))), bm25_ranked)[:top_k]

        candidates = [sem_rows[i] for i in fused]

        # Cross-encoder reranking for knowledge (prose queries benefit most)
        reranked = _cross_encode_rerank(query, candidates, text_key=lambda r: f"{r['title']} {r['content']}")

        # FSRS-6 inspired spaced repetition: entries decay based on access patterns, not just age.
        # Frequently retrieved entries stay strong; rarely accessed entries fade faster.
        # retrieval_strength = base_decay * access_boost
        now = time.time()
        results = []
        for r, score in reranked:
            age_days = (now - r.get("timestamp", now)) / 86400
            access_count = self._access_log.get(r["id"], 0)
            # Base decay: linear with age (same as before)
            base_decay = 1.05 if age_days < 1 else max(0.5, 1.0 - (age_days - 7) * 0.015) if age_days > 7 else 1.0
            # Access boost: frequently retrieved entries resist decay
            access_boost = min(1.3, 1.0 + access_count * 0.05) if access_count > 0 else 1.0
            # Combined: accessed entries can be up to 1.3x stronger than decay alone
            temporal_factor = base_decay * access_boost
            # Track this retrieval
            self._access_log[r["id"]] = access_count + 1
            results.append({
                "id": r["id"],
                "title": r["title"],
                "content": r["content"],
                "category": r["category"],
                "tags": r["tags"].split(",") if r["tags"] else [],
                "score": score * temporal_factor,
            })

        self._knowledge_cache.set(cache_key, results)
        return results

    def remove_knowledge(self, entry_id: str) -> bool:
        if self.knowledge_table is None:
            return False
        try:
            self.knowledge_table.delete(f"id = '{self._sanitize(entry_id)}'")
            self._knowledge_cache.invalidate()
            return True
        except Exception as e:
            logger.error(f"Knowledge remove failed: {e}")
            return False

    def list_knowledge_full(self, category: str | None = None) -> list[dict]:
        """Like list_knowledge but includes content + timestamp for health checks."""
        if self.knowledge_table is None:
            return []
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            return [
                {"id": r["id"], "title": r["title"], "content": r.get("content", ""),
                 "category": r["category"], "tags": r.get("tags", ""),
                 "timestamp": r.get("timestamp", 0)}
                for r in rows
            ]
        except Exception:
            return []

    def list_knowledge(self, category: str | None = None) -> list[dict]:
        if self.knowledge_table is None:
            return []
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "category": r["category"],
                    "tags": r["tags"].split(",") if r["tags"] else [],
                }
                for r in rows
            ]
        except Exception:
            return []

    def get_knowledge_status(self) -> dict:
        if self.knowledge_table is None:
            return {"has_knowledge": False, "total_entries": 0, "categories": []}
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            categories = list({r["category"] for r in rows})
            return {
                "has_knowledge": True,
                "total_entries": len(rows),
                "categories": categories,
            }
        except Exception:
            return {"has_knowledge": False, "total_entries": 0, "categories": []}

    def compact_knowledge(self, similarity_threshold: float = 0.85) -> dict:
        if self.knowledge_table is None:
            return {"removed": 0, "kept": 0}

        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
        except Exception:
            return {"removed": 0, "kept": 0}

        if len(rows) < 2:
            return {"removed": 0, "kept": len(rows)}

        import numpy as np
        vectors = np.array([r["vector"] for r in rows])
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normalized = vectors / norms

        remove_ids = set()
        for i in range(len(rows)):
            if rows[i]["id"] in remove_ids:
                continue
            for j in range(i + 1, len(rows)):
                if rows[j]["id"] in remove_ids:
                    continue
                sim = float(np.dot(normalized[i], normalized[j]))
                if sim >= similarity_threshold:
                    older = i if rows[i].get("timestamp", 0) < rows[j].get("timestamp", 0) else j
                    remove_ids.add(rows[older]["id"])

        if remove_ids:
            kept = [r for r in rows if r["id"] not in remove_ids]
            if kept:
                self.knowledge_table = self.db.create_table(
                    "knowledge", data=kept, schema=self._knowledge_schema, mode="overwrite"
                )
            else:
                try:
                    self.db.drop_table("knowledge")
                except Exception:
                    pass
                self.knowledge_table = None

        if remove_ids:
            self._knowledge_cache.invalidate()
        return {"removed": len(remove_ids), "kept": len(rows) - len(remove_ids)}

    def export_knowledge(self, category: str | None = None) -> str:
        if self.knowledge_table is None:
            return ""
        try:
            rows = self.knowledge_table.to_arrow().to_pylist()
            if category:
                rows = [r for r in rows if r["category"] == category]
            rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
        except Exception:
            return ""

        lines = []
        by_cat: dict[str, list] = {}
        for r in rows:
            by_cat.setdefault(r["category"], []).append(r)

        for cat, entries in sorted(by_cat.items()):
            lines.append(f"## {cat}")
            for e in entries:
                tags = e["tags"] if e["tags"] else ""
                lines.append(f"### {e['title']}" + (f" [{tags}]" if tags else ""))
                lines.append(e["content"])
                lines.append("")

        return "\n".join(lines)

