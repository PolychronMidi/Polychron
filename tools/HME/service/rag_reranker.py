"""RAG engine setup -- model loading, GPU/CPU routing, reranker adapters.

Extracted from hme_http.py. Contains:
  _RagDispatcher    -- routes embedding calls to GPU or CPU mirror
  _MxbaiRerankerAdapter -- wraps mxbai-rerank-base-v2 as CrossEncoder API
  _load_engines     -- background thread that loads all models + starts indexing
  _ensure_llamacpp_daemon / _ensure_vram_monitor -- daemon launchers
"""
import os
import sys
import json
import time
import logging
import threading
import subprocess

_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.http")

PROJECT_ROOT = ENV.require("PROJECT_ROOT")
PROJECT_DB = ENV.require("HME_RAG_DB_PATH")
GLOBAL_DB = ENV.require("HME_GLOBAL_KB_PATH")
MODEL_NAME = ENV.require("HME_MODEL_TEXT_EMBED")
MODEL_BACKEND = ENV.require("HME_RAG_BACKEND")

_engine_ready = threading.Event()
_project_engine = None
_global_engine = None
_shared_model_cpu = None
_shared_code_model_cpu = None
_shared_reranker_cpu = None
_lib_engines = {}


# RAG routing: GPU vs CPU mirror
_LLAMACPP_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_rag_route_cache = {"route": "gpu", "ts": 0.0}
_rag_route_ttl_s = 0.1
_rag_route_fail_count = 0




class _MxbaiRerankerAdapter:
    """Adapter exposing CrossEncoder.predict(pairs) on top of MxbaiRerankV2.

    mxbai-rerank-v2 is a Qwen2-based listwise reranker, NOT a standard
    CrossEncoder. Loading it via sentence_transformers.CrossEncoder leaves
    the score head randomly initialized (silent corruption -- outputs look
    plausible but are noise). The official mxbai_rerank library loads the
    real score head and exposes .rank(query, docs).

    Engine search code feeds pairs as [(query, doc1), (query, doc2), ...]
    where the query is constant across the batch. We split, call .rank(),
    then map results back to input order. Returns raw logits (~[-10, +10])
    so downstream batch min-max normalization works the same as bge-reranker.
    """

    def __init__(self, model_name: str, device: str, dtype=None):
        from mxbai_rerank import MxbaiRerankV2
        kwargs = {"device": device}
        if dtype is not None:
            kwargs["dtype"] = dtype
        self._inner = MxbaiRerankV2(model_name, **kwargs)
        self._device = device

    @property
    def device(self):
        return self._device

    def predict(self, pairs, show_progress_bar=False, **kwargs):
        if not pairs:
            return []
        query = pairs[0][0]
        for q, _ in pairs:
            if q != query:
                raise ValueError("_MxbaiRerankerAdapter.predict requires constant query across pairs")
        docs = [d for _, d in pairs]
        results = self._inner.rank(query, docs, return_documents=False, top_k=len(docs))
        scores = [0.0] * len(docs)
        for r in results:
            scores[r.index] = float(r.score)
        return scores

    def __getattr__(self, name):
        return getattr(self._inner, name)


CODE_MODEL_NAME = ENV.require("HME_MODEL_CODE_EMBED")
RERANKER_NAME = ENV.require("HME_MODEL_RERANKER")

# Initialise stores with paths before any request can arrive
from hme_http_store import init_store
init_store(PROJECT_ROOT)
