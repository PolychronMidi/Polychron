# mcp/rag_engine

Retrieval-augmented generation substrate. Owns the LanceDB tables (knowledge, code_chunks, symbols), their schemas, embedding model bindings, and the RAG query primitives (semantic, hybrid, BM25). Split across `engine.py` (top-level facade), `engine_indexing.py` (ingestion), `engine_persistence.py` (table I/O + hash caching), `engine_symbols.py` (symbol extraction), `knowledge.py` (KB CRUD + FSRS-6 access log), `utils.py`.

All public lookups flow through `ProjectEngine` / `GlobalEngine` instances held on `server.context` (`ctx.project_engine`, `ctx.global_engine`). Direct lance access from outside this dir is forbidden — the engine owns table connection state, dimension negotiation, and schema migration.

Silent failure discipline (R33): catch blocks here must log the exception type+message via `logger.warning`/`logger.debug` before returning a default. Silent `except Exception: return []` hid a broken `list_knowledge` path for unknown months while `search_knowledge` (different code path) kept working — the KB looked empty to `i/learn list` callers while actually holding 175+ entries.

<!-- HME-DIR-INTENT
rules:
  - All lance table access goes through ProjectEngine/GlobalEngine; never call lance.dataset() directly from outside this dir
  - Exception handlers returning a default MUST log the exception first; silent defaults hid the KB-empty bug for months
-->
