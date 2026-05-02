# Polychron-Specific RAG, Synthesis & Memory Stack

> IIFE chunking, embedding model, symbol indexing, two-local arbiter fleet, warm KV contexts, five-stage synthesis pipeline, think-session memory, unified narrative, context-budget awareness, temporal decay, knowledge relationships. Linked from [HME.md](HME.md).

## Polychron-Specific Features

### IIFE-Aware Chunking

Polychron's primary module pattern: `globalName = (() => { function tick() {...} })()` (487 files). The chunker creates named function chunks per IIFE.

### Embedding Model

`BAAI/bge-base-en-v1.5` (768-dim, 110M params). 3x better code similarity than previous mpnet model. Cross-encoder reranking via `cross-encoder/ms-marco-MiniLM-L-6-v2`. Configurable via `RAG_MODEL` env var.

### Symbol Indexing

321 IIFE globals + 1914 inner functions = 3848+ total symbols. Internal helpers `lookup_symbol` and `find_callers` (callable via `trace(target)` for callers and `read(target)` internally for symbol lookup) work with Polychron's global-assignment pattern.

### Two-Local + Ranked-API Synthesis Fleet

HME splits synthesis across two local llama-server instances (Vulkan) and a
ranked cascade of free-tier API providers. Reasoning tasks prefer the API
cascade (better quality, faster time-to-first-token); coder tasks and the
arbiter triage stay local.

**GPU0 -- Arbiter** (`phi-4-Q4_K_M.gguf`, served as `hme-arbiter`):
- Port 8080, Vulkan1 (Tesla M40), full-offload invariant enforced by the daemon
- Specialized persona: domain-aware hallucination guard -- auto-discovers real module names via `src/crossLayer/**/*.js` glob, lists known signal fields
- Runs Stage 1.5: triages GPU0/GPU1 output for conflicts
- Three severity levels: `ALIGNED` (pass through), `MINOR` (advisory note injected), `COMPLEX` (escalate to Stage 1.75)
- Configured via `HME_ARBITER_MODEL` (default alias `hme-arbiter`)

**GPU1 -- Coder** (`qwen3-coder-30b-Q4_K_M.gguf`, served as `qwen3-coder:30b`):
- Port 8081, Vulkan2 (Tesla M40), full-offload invariant enforced
- Specialized persona: "expert code extractor -- facts, file paths, module names, no speculation"
- Runs Stage 1A in parallel two-stage synthesis
- Default model for `_local_think` with the `coder` profile -- structural code extraction, caller analysis, `review(mode='health')`, `learn(action='graph')`
- Configured via `HME_CODER_MODEL` (alias `qwen3-coder:30b`)

**Reasoning -- API cascade** (`synthesis_reasoning.call(profile='reasoning')`):
- Ranked list: Gemini 2.5-pro -> Groq -> OpenRouter -> Cerebras -> Gemini flash tiers
- Each slot has its own quota/RPM/circuit-breaker; walks best->worst until one succeeds
- Used by `reasoning.py`, `reasoning_think.py`, `digest_analysis.py`, `enrich_prompt.py`, `evolution_strategies.py`, `runtime.py`, `workflow_audit.py`
- Local fallback: the coder instance above when every ranked slot is exhausted

**Failure recovery:** Each local instance has a 3-state circuit breaker (CLOSED -> OPEN -> HALF_OPEN) that replaces fixed cooldowns. 3 failures within 60s opens the circuit (blocks calls for 15s recovery). Every API provider enforces its own daily quota and RPM via `synthesis_reasoning`.

**Env-load invariant** (fail-fast at `hme_env.py` import): `HME_ARBITER_MODEL != HME_CODER_MODEL`. The two local aliases must be distinct so the fallback chain always has an independent last resort.

**No model needed:**
- All hooks (pure bash), all search/grep/index operations, `hme_admin(action='introspect')`

**Configuration** (in `.env`, loaded via `hme_env.py`):
```
HME_ARBITER_MODEL=hme-arbiter             # GPU0 arbiter (phi-4)
HME_CODER_MODEL=qwen3-coder:30b           # GPU1 coder
HME_LLAMACPP_ARBITER_URL=http://127.0.0.1:8080
HME_LLAMACPP_CODER_URL=http://127.0.0.1:8081
GEMINI_API_KEY=...                        # ranked reasoning cascade
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

### Warm KV Context System

Each model maintains an independent pre-tokenized KV context cache. The system prompt + KB prefix (~1000 tokens) is pre-processed once and reused across calls -- subsequent calls skip re-tokenization entirely.

**How it works:**
- On the first interactive synthesis call, `_ensure_warm()` spawns a background daemon thread that primes all three models in parallel via `_prime_all_gpus()`
- Each model gets a *different* warm context tailored to its persona -- not a shared global cache
- Warm context is embedded in the PROMPT field (not `system=`), so llama.cpp's KV cache captures it
- On subsequent `_local_think` calls with `system=_THINK_SYSTEM`, the system auto-swaps `system=` for `context=warm_ctx` transparently -- no caller changes needed
- Arbiter passes `payload["context"] = arbiter_warm_ctx` for every conflict check

**Staleness detection:**
- Every warm context stores `_kb_version` at prime time
- KB writes increment the global KB version counter
- If `ctx._kb_version < current_version`, the context is stale and auto-reprimed
- `warm_context_status()` returns per-model: primed, tokens cached, age (seconds), kb_fresh flag

**Manual control:**
- `hme_admin(action='warm')` -- prime all three GPU warm contexts + Tier 1/2 pre-edit cache
- `warm_context_status()` -- inspect current state of all three contexts

### Five-Stage Synthesis Pipeline

`_parallel_two_stage_think` runs a five-stage pipeline for maximum quality:

```
Stage 1A (GPU0 extract)  +
                            + parallel > Stage 1.5: Arbiter triage
Stage 1B (GPU1 analyze) +
        |
        + ALIGNED  -> proceed to Stage 2
        + MINOR    -> inject advisory note, proceed to Stage 2
        + COMPLEX  -> Stage 1.75: GPU1 deep resolution -> Stage 2

Stage 2 (GPU1 final synthesis)  ->  result + pipeline trace
```

Every output from `_parallel_two_stage_think` ends with a pipeline trace line:
```
*pipeline: 1A:Xc -> 1B:Xc -> arbiter:SEVERITY -> 2:Xc*
```
(where `Xc` = token count per stage)

Structured traces are logged to `log/synthesis-traces.jsonl` and arbiter decisions to `log/synthesis-arbiter.jsonl` for telemetry analysis.

**Arbiter escalation (Stage 1.75):** When arbiter detects COMPLEX conflicts (hallucinated module names, contradictory architectural claims, boundary violations), it escalates to GPU1 for authoritative reconciliation before Stage 2. The resolved brief replaces the conflicted input.

### Think Session Memory

HME maintains a rolling window of the last 3 think Q&A pairs within a session. These are injected as "Previous think exchanges this session" at the top of every subsequent `think` call -- giving the reasoning model continuity across calls without bloating individual prompts.

- `store_think_history(about, answer)` -- persists a Q&A pair (auto-called after each successful think)
- `get_think_history_context()` -- returns formatted history block for injection
- Max 3 pairs (`_THINK_HISTORY_MAX=3`) -- oldest pair drops when window is full
- History survives across tool calls within a session; resets on server restart

### Unified Session Narrative (4th Context Layer)

A running prose thread of what's happening this session -- orthogonal to KB (static facts), warm KV context (static persona), and think history (narrow Q&A).

**What it provides:** session direction, key decisions, pipeline verdicts, arbiter resolutions -- a coherent "what we're building and what was decided" context available to ALL models.

**Architecture:** NOT baked into warm KV cache (too dynamic). A live string prepended to every synthesis call's prompt. Updated automatically by:
- Every `evolve(focus='think')` call (via `store_think_history`)
- Every `learn(title=, content=)` add call (new calibration anchor logged)
- Every `_resolve_complex_conflict` call (COMPLEX arbiter resolution logged)

**Injection points:** Every `_local_think(system=_THINK_SYSTEM)` call (GPU0, GPU1) and every `_arbiter_check` prompt -- so all three models share the same session thread.

**API:**
- `append_session_narrative(event, content)` -- external callers (pipeline hooks, evolution tools) can push events
- `get_session_narrative(categories=['think','edit','search'])` -- returns formatted narrative block, optionally filtered by category (commit/pipeline/think/search/edit/review/kb/other)
- Max 10 events (`_SESSION_NARRATIVE_MAX=10`); oldest drops when full
- `hme_admin(mode='selftest')` shows event count under "session narrative"

### Context-Budget Awareness

Composite tools auto-scale output via `/tmp/claude-context.json`:

| Context Remaining | Budget | KB Entries | Callers | Local model max_tokens |

| >75% | greedy | 10 | 20 | 4096 |
| 50-75% | moderate | 5 | 10 | 2048 |
| 25-50% | conservative | 3 | 6 | 1024 |
| <25% | minimal | 1 | 3 | 256 |

### Temporal Relevance Decay

KB entries < 1 day: 1.05x boost. > 7 days: gradual decay (0.7x at 37 days). Recent decisions stay prominent.

### Knowledge Relationships

`learn(title=, content=)` supports `related_to="<entry_id>"` with `relation_type`: `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`. Creates typed graph edges for `learn(action='graph')` traversal.

