# HME Installation, Worker HTTP, Operator Commands & Maintenance

> Source-of-truth detail for HME runtime topology. Linked from [HME.md](HME.md).

## Installation Topology

### Unified Directory
```
tools/HME/               The single source of truth
  .claude-plugin/
    plugin.json                         Plugin metadata (name, version, description)
  mcp/                                  Python MCP server
    server/
      (main.py removed -- worker.py is the entry point since the MCP decoupling)
      context.py                        Shared engine references (project_engine, etc.);
                                          holds _NullMCP default so daemon-side imports don't crash
      lifecycle_writers.py              Single-writer registry (6 domains: llama-server, embedders,
                                          kb, hme-todo-store, lifesaver-registry, onboarding-state)
      probe_witness.py                  Witness/falsification structure for selftest probes
      coherence_timeseries.py           Per-run probe history for temporal drift detection
      health_summary.py                 Operator-facing health command (hme_admin action=health)
      helpers.py                        Budget limits, formatters; loads project-rules.json
      tools_analysis/                   Public tool surface (6 agent-callable) lives here:
        evolution_evolve.py               evolve -- evolution planning hub
        review_unified.py                 review -- post-pipeline review hub
        learn_unified.py                  learn -- unified KB interface
        trace_unified.py                  trace -- signal flow tracing
        evolution_admin.py                hme_admin -- selftest / reload / index / warm / fix_antipattern
        todo.py                           hme_todo -- hierarchical todo (hidden utility, merged into TodoWrite)
        read_unified.py                   read -- smart code reader (HIDDEN: auto-chained into Edit hooks, not agent-callable)
        status_unified.py                 status -- lifecycle surfacer (HIDDEN: used by internal banners)
        tools_passthru.py                 grep / glob_search / edit (HIDDEN: enriched passthrus of native tools)
        runtime.py                        beat_snapshot helper (called by trace)
        workflow.py                       before_editing briefing (called by Edit hook)
        enrich_prompt.py                  enrich_prompt -- local prompt enrichment
        (+ ~20 internal modules: coupling, reasoning, symbols, etc.)
      tools_search.py                   Internal: low-level search helpers (used by learn/trace)
      tools_knowledge.py                Internal: KB CRUD (used by learn)
      tools_index.py                    Internal: index_codebase, clear_index (used by hme_admin)
    rag_engine/                         LanceDB + BM25 + RRF fusion + cross-encoder reranking
    watcher.py                          Auto-reindex on file changes (5s debounce, 5min cooldown)
    chunker.py, lang_registry.py        IIFE-aware code chunking
  skills/                               Skill definitions (symlinked from ~/.claude/skills/)
  config/
    project-rules.json                  Declarative project rules (boundary violations,
                                          L0 channels, registration patterns, etc.)
  hooks/                                Hook scripts (hooks.json plugin manifest)
  agents/
    Evolver.agent.md                    7-phase evolution loop agent
  scripts/                              Verifier engine, stress tests, analyzers:
    verify-coherence.py                   Unified HCI engine (65 verifiers, 0-100 score)
    verify-doc-sync.py                    Stale tool name drift detector
    verify-onboarding-flow.py             18-test dry run of onboarding state machine
    verify-states-sync.py                 Python<->shell STATES list diff
    snapshot-holograph.py                 Time-travel snapshot + --diff + --replay
    analyze-hci-trajectory.py             HCI trend + linear-regression forecast
    analyze-tool-effectiveness.py         Multi-window (1h/6h/24h) session stats
    build-hme-coupling-matrix.py          Tool co-occurrence + antagonist bridges
    stress-test-subagent.py               5-case adversarial battery for agent_local
    suggest-verifiers.py                  Verifier-that-invents-verifiers (H13)
    memetic-drift.py                      CLAUDE.md rule violation scanner (H16)
    promote-global-kb.py                  Cross-project KB promotion (H12)
    build-dashboard.py                    Interactive plotly.js dashboard
    emit-hci-signal.py                    HCI -> composition-layer signal (H15 scaffold)
    finetune-arbiter.py                   QLoRA training entry (H10)
    learn-stopwords.py                    Self-improving stopwords (H7)
    predict-hci.py                        Predictive HCI model (H9)
  doc                                   -> doc/ (symlink)
```

### Symlinks
```
~/.claude/skills/HME  -> tools/HME/skills/
```
(The former `~/tools/HME/KB -> tools/HME/service/` symlink was removed when HME
decoupled from Claude Code's MCP system -- see "Tool Invocation" below.)

### Databases
```
Polychron/tools/HME/KB/
  code_chunks.lance/     Semantic code chunks (~3000 from 610+ files)
  knowledge.lance/       KB (68 entries with prediction error gating, FSRS-6 spaced repetition with persistent access log)
  symbols.lance/         Symbol index (3848+ symbols: 321 IIFE globals + inner functions)
  file_hashes.json       Content hash cache for incremental reindex
  global_kb/             Cross-project shared KB (path configurable via HME_GLOBAL_KB_PATH in .env)
```

### Tool Invocation (`i/<tool>` shell wrappers)
HME tools used to be exposed as MCP tools (`mcp__HME__review`, etc.) registered
in `.mcp.json`. After the MCP decoupling they're invoked as executable shell
wrappers in `i/` (project root) that hit the worker's HTTP endpoint directly.
Each wrapper is a one-line `exec node scripts/hme-cli.js <tool> "$@"`, so
there's no `npm run` preamble and no caller-side flag boilerplate:

```
i/review  mode=forget
i/learn   title="..." content="..."
i/trace   target=<module> mode=impact
i/evolve  focus=<axis>
i/status                              # pipeline status
i/state                               # unified state-machine snapshot (Horizon II seed)
i/timeline                            # chronological audit trail of silent automations
i/why     mode=<...>                    # 14 causality modes (see AGENT_PRIMER.md)
i/hme-admin action=selftest
i/todo    action=list
i/hme-read target=<module>
i/hme     <any-tool> key=value ...    # generic dispatcher
```

The `i/state` + `i/why` + `i/timeline` triad covers three orthogonal observability questions: *what state am I in* (snapshot), *why did this fire* (causality), *what just happened* (chronology). Three commands span the entire "what's happening in HME right now" question space. See [doc/HME_HORIZONS.md](HME_HORIZONS.md) for the architectural trajectory each tool advances.

All routes go through `scripts/hme-cli.js`, which POSTs `/tool/<name>` on the
worker (`tools/HME/service/worker.py`, default port 9098). RAG config lives in
`tools/HME/config/rag.json` (migrated from the former `mcpServers.HME` block).
The proxy at port 9099 still intercepts inference calls for observability and
injection -- it just no longer speaks MCP to Claude Code.


## HME Worker HTTP

The Python worker at `mcp/worker.py` exposes endpoints used by hooks and other HME components:
- `POST /enrich` -- KB top-k retrieval for hybrid context injection
- `POST /enrich_prompt` -- Full reasoning-model prompt enrichment (200s timeout)
- `POST /validate` -- Rule validation + constraint warnings
- `POST /audit` -- Post-change boundary audit
- `POST /transcript` -- Session narrative mirroring into KB
- `GET /health` -- Readiness check


## Setup

Source tracked in `tools/HME/`. Knowledge base at `tools/HME/KB/` (lance tables, todos, file hashes). The worker (`tools/HME/service/worker.py`) spawns under the proxy (`tools/HME/proxy/hme_proxy.js`); HME tools are invoked via the shell wrappers in `i/` (`i/review`, `i/trace`, `i/learn`, etc.). Skills at `skills/`, symlinked from `~/.claude/skills/`. Load the skill before first use: `/HME`


## Operator Commands

| Command | Purpose |
| --- | --- |
| `i/hme-admin action=selftest` | Full self-check; ~15 probes covering tool registration, docs, index, KB, llamacpp, version consistency, single-writer invariants, timeseries drift |
| `i/hme-admin action=health` | Operator triage view: daemon PID+uptime, worker PID+uptime, llama aliases, /health states, per-GPU VRAM, recent errors, version banner, single-writer domain snapshot |
| `i/hme-admin action=reload modules=<name>` | Hot-reload one or more tool modules without restarting the worker (runs against `tool_registry._TOOLS`) |
| `i/hme-admin action=index` | Incremental reindex. R97: now routes through the daemon's GPU-orchestrated `indexing-mode` (same path as `clear_index`) instead of calling `_index_main` directly -- eliminates the coder-on-GPU1 race that used to corrupt CUDA context every reindex. |
| `i/hme-admin action=clear_index` | Full reindex via daemon's GPU-orchestrated indexing-mode (suspends coder -> moves embedders to cuda:1 -> indexes -> restores) |

### Indexing-mode: pinned, no migration (R97)

Prior incarnations of indexing-mode suspended coder, migrated embedders
cuda:0 -> cuda:1 for dedicated throughput, ran the index, and migrated
them back. That migration dance repeatedly triggered "CUDA error: illegal
memory access" because M40 Maxwell + PyTorch's caching allocator don't
survive frequent `model.to(device)` churn. Every prior session's "implement
model pinning" effort was quietly defeated by this function migrating
the models anyway.

**R97**: indexing-mode no longer migrates or suspends anything. Embedders
stay pinned to their boot-time device (`HME_RAG_GPU=0`, cuda:0). Indexing
runs in-place on whatever GPU they occupy. Coder stays up throughout.

The ~30% embedder throughput cost from sharing cuda:0 with arbiter during
indexing is accepted -- it's orders of magnitude cheaper than the 45+
minutes of manual recovery each migration-caused CUDA corruption used to
cost. If cuda:0's VRAM pressure becomes a real problem in the future,
lower `HME_CODE_EMBED_BATCH` or `max_seq_length` rather than reintroducing
migration.

**Enforcement**: [rag_engines.reload_on_device](../tools/HME/service/rag_engines.py)
refuses migration requests unless `HME_ALLOW_EMBEDDER_MIGRATION=1` is set
in env. The escape hatch exists for humans doing one-off experiments; no
automated code path should set it.

**Separately kept**: the worker CUDA-corruption auto-restart at
[rag_engines.py:reload_on_device](../tools/HME/service/rag_engines.py). If
a migration ever does happen (via the escape hatch) and corrupts CUDA,
the worker self-exits via `os._exit(98)` and the proxy supervisor
respawns it with a fresh CUDA context -- zero manual intervention.
| `i/hme --version` | Print cli / proxy / worker versions and warn on drift |

**KB entries worth querying when working on HME internals:**

The 2026-04-22 indexing-mode incident ([7 root causes](../tools/HME/KB/)) was persisted as KB entries. Retrieve with `i/learn query="<topic>"`:

| Topic | KB entry (short id) | Query hint |
| --- | --- | --- |
| dotenv inline-comment parse bug | `a8b4eeb6d3fa` | `i/learn query="dotenv inline comment"` |
| duplicate supervisor race | `54e18b372699` | `i/learn query="duplicate supervisor"` |
| PyTorch cuda context residual | `e8c883ae6af1` | `i/learn query="cuda context residual"` |
| SentenceTransformer.to() NaN trap | `042eda002c1f` | `i/learn query="sentence transformer to nan"` |
| attention matrix OOM | `b071e13f523f` | `i/learn query="attention matrix oom"` |
| PYTORCH_CUDA_ALLOC_CONF timing | `2a6479eb0877` | `i/learn query="PYTORCH_CUDA_ALLOC_CONF"` |
| planned-restart cooldown bypass | `743b9ddea0a2` | `i/learn query="planned restart cooldown"` |

These entries document the root-cause chain end-to-end, not just the symptoms. Before touching `llamacpp_daemon.py`, `rag_engines.py`, or the indexing-mode flow, query the relevant entry -- tonight's 6-hour investigation is a one-liner away.

**Programmatic arbiter health** (from `Arbiter.ts`):

```ts
import { getArbiterHealth } from "./Arbiter";
const h = getArbiterHealth();
// { healthy: boolean, consecutiveFailures: number, lastOkMs: number }
```

Call when you need to distinguish "arbiter classified as claude" from "arbiter daemon was down, we defaulted to claude." The latter has `healthy=false` after 3 consecutive failures.


## Maintenance

### Reindex
File watcher auto-reindexes on save (5s debounce, 5min cooldown). For batch changes:
```
hme_admin(action='index')    # incremental reindex
hme_admin(action='clear_index')  # full rebuild from scratch
```
**Concurrent reindex coalesces.** The watcher, scheduled refresh, and manual `hme_admin(action='index')` triggers all fire independently and regularly overlap. The daemon's `/indexing-mode` endpoint serializes them through a single lock and the second caller waits for the first to finish, then returns the in-flight result tagged `coalesced=True`. No "already in progress" error, no warning log; overlap is the design. User-visible output renders the coalesced case as `[main] files=N indexed=N ... (coalesced into in-progress reindex)`. See `tools/HME/service/llamacpp_daemon/indexing.py` and the regression test at `tools/HME/tests/specs/indexing_mode_coalesce.test.js`.

### KB Maintenance
- Periodic: `learn(action='health')` -- find stale refs, wrong line counts
- After 30+ entries: `learn(action='compact')` -- deduplicate
- Backup: `learn(action='export')` -- dump all entries as markdown
- Discovery: `learn(action='dream')` -- find hidden connections

### Doc Sync
`review(mode='docs')` verifies docs match implementation.

### HME Self-Maintenance
When tools feel wrong (missing context, stale results, slow synthesis):
1. `hme_admin(action='selftest')` -- selftest + introspection
2. `learn(action='health')` -- find stale or conflicting KB entries
3. `learn(action='compact')` -- deduplicate
4. `review(mode='docs')` -- verify docs match reality
5. `hme_admin(action='reload', modules='all')` -- hot-reload all tool modules
6. Check hooks in `tools/HME/hooks/hooks.json` -- are they triggering?
