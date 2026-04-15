# Hypermeta Ecstasy

> Master executive for hypermeta evolutionary intelligence. The cognitive substrate that makes self-evolving composition possible — not a code search tool but an evolutionary nervous system. Continually evolving to remove the ceiling on coherence through intelligently managed context-efficiency.

HME is five layers integrated into one executive. **6 MCP tools** (agent-facing) plus a self-coherence substrate of **37 verifiers** at weight 0-5 each, producing an aggregate HME Coherence Index (HCI) on a 0-100 scale. CLAUDE.md encodes rules and boundaries. Skills load cognitive frameworks per session. Hooks enforce workflow automatically. The Evolver and lab run the evolution loop. A local-LLM subagent pipeline (Explore + Plan modes) with a domain-specialized QLoRA-fine-tuned arbiter handles code research at amateur-hardware speeds.

No layer is optional. Removing any one collapses the executive.

**See also:** [HME_SELF_COHERENCE.md](HME_SELF_COHERENCE.md) for the HCI verifier substrate + LIFESAVER no-dilution rule + detector calibration philosophy. Every session evolution lives there in the "Session evolutions log" section as an append-only rolling history.

## The Five Layers

| Layer | Location | What It Does |
|-------|----------|-------------|
| **MCP Server** | `tools/HME/` | 6 tools: evolve / review / read / learn / trace / hme_admin |
| **CLAUDE.md** | `CLAUDE.md` | Rules, boundaries, mandatory workflow, hard constraints |
| **Skills** | `~/.claude/skills/HME/` | Single-page mega-tool reference loaded per session via `/HME` |
| **Hooks** | `hooks/` (22 scripts, registered in `hooks/hooks.json`) | Automated workflow enforcement (pre/post tool use) |
| **Evolver + Lab** | `agents/Evolver.agent.md` + `lab/` | 7-phase evolution loop + experimental harness |

## Self-Evolution

HME evolves alongside Polychron. Every confirmed evolution round feeds back into HME's own intelligence:

```
Observe (tools surface patterns)
    -> Diagnose (KB constrains interpretation)
        -> Evolve (code changes + new KB entries)
            -> Persist (learn add/compact, doc updates)
                -> Repeat (next session starts smarter)
```

**What self-evolution looks like in practice:**
- After a confirmed round, `learn(title='...', content='...')` persists calibration anchors — the KB grows with each cycle
- `learn(action='compact')` periodically deduplicates, keeping the KB sharp
- `learn(action='dream')` discovers hidden connections between distant entries
- `review(mode='docs')` verifies docs match implementation — when they diverge, docs get updated
- `learn(action='health')` finds stale references, aged entries, dead file pointers
- Hooks can be extended when new anti-patterns emerge — `fix_antipattern` synthesizes enforcement
- The Evolver's own phases can be refined based on KB entries about what works

**The ecstatic principle:** Intelligence that makes working with it genuinely pleasurable. Every tool should feel like it reads your mind. Every constraint should prevent a mistake you'd regret. Every hook should arrive at exactly the right moment. When the system achieves this, using it is not just productive — it's ecstatic.

## Installation Topology

### Unified Directory
```
tools/HME/               The single source of truth
  .claude-plugin/
    plugin.json                         Plugin metadata (name, version, description)
  mcp/                                  Python MCP server
    server/
      main.py                           FastMCP entry point, background model loading
      context.py                        Shared engine references (project_engine, etc.)
      helpers.py                        Budget limits, formatters; loads project-rules.json
      tools_analysis/                   Public tool surface (6 agent-callable) lives here:
        evolution_evolve.py               evolve — evolution planning hub
        review_unified.py                 review — post-pipeline review hub
        learn_unified.py                  learn — unified KB interface
        trace_unified.py                  trace — signal flow tracing
        evolution_admin.py                hme_admin — selftest / reload / index / warm / fix_antipattern
        todo.py                           hme_todo — hierarchical todo (hidden utility, merged into TodoWrite)
        read_unified.py                   read — smart code reader (HIDDEN: auto-chained into Edit hooks, not agent-callable)
        status_unified.py                 status — lifecycle surfacer (HIDDEN: used by internal banners)
        tools_passthru.py                 grep / glob_search / edit (HIDDEN: enriched passthrus of native tools)
        runtime.py                        beat_snapshot helper (called by trace)
        workflow.py                       before_editing briefing (called by Edit hook)
        enrich_prompt.py                  enrich_prompt — local prompt enrichment
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
    verify-coherence.py                   Unified HCI engine (37 verifiers, 0-100 score)
    verify-doc-sync.py                    Stale tool name drift detector
    verify-onboarding-flow.py             18-test dry run of onboarding state machine
    verify-states-sync.py                 Python↔shell STATES list diff
    snapshot-holograph.py                 Time-travel snapshot + --diff + --replay
    analyze-hci-trajectory.py             HCI trend + linear-regression forecast
    analyze-tool-effectiveness.py         Multi-window (1h/6h/24h) session stats
    build-hme-coupling-matrix.py          Tool co-occurrence + antagonist bridges
    stress-test-subagent.py               5-case adversarial battery for agent_local
    suggest-verifiers.py                  Verifier-that-invents-verifiers (H13)
    memetic-drift.py                      CLAUDE.md rule violation scanner (H16)
    promote-global-kb.py                  Cross-project KB promotion (H12)
    build-dashboard.py                    Interactive plotly.js dashboard
    emit-hci-signal.py                    HCI → composition-layer signal (H15 scaffold)
    finetune-arbiter.py                   QLoRA training entry (H10)
    learn-stopwords.py                    Self-improving stopwords (H7)
    predict-hci.py                        Predictive HCI model (H9)
  doc                                   -> doc/ (symlink)
```

### Symlinks
```
~/.claude/mcp/HME     -> tools/HME/mcp/
~/.claude/skills/HME  -> tools/HME/skills/
```

### Databases
```
Polychron/.claude/mcp/HME/
  code_chunks.lance/     Semantic code chunks (~3000 from 610+ files)
  knowledge.lance/       KB (68 entries with prediction error gating, FSRS-6 spaced repetition with persistent access log)
  symbols.lance/         Symbol index (3848+ symbols: 321 IIFE globals + inner functions)
  file_hashes.json       Content hash cache for incremental reindex
  global_kb/             Cross-project shared KB
```

### MCP Registration (`.mcp.json`)
```json
{
  "mcpServers": {
    "HME": {
      "type": "stdio",
      "command": "python3",
      "args": ["/home/jah/Polychron/tools/HME/mcp/server/main.py"],
      "env": {
        "PROJECT_ROOT": "/home/jah/Polychron",
        "RAG_DB_PATH": "/home/jah/Polychron/.claude/mcp/HME",
        "HME_LOCAL_MODEL": "qwen3-coder:30b",
        "HME_LOCAL_URL": "http://localhost:11434/api/generate",
        "HME_ARBITER_MODEL": "qwen3:4b"
      }
    }
  }
}
```

## Setup

Source tracked in `tools/HME/`. MCP server at `mcp/`, symlinked from `~/.claude/mcp/`. Skills at `skills/`, symlinked from `~/.claude/skills/`. Run `scripts/setup-mcp.sh` after cloning to create symlinks. Load the skill before first use: `/HME`

## Evolver Integration

HME is the cognitive backbone of every Evolver phase. The Evolver doesn't just *use* HME tools — it *thinks through* HME.

| Phase | HME Role | Tools |
|-------|----------|-------|
| **1. Perceive** | Surface patterns from metrics, KB context on changed files | `learn(query='...')` |
| **2. Diagnose** | Trace causal chains with KB constraints, find anti-patterns | `trace(target)`, `evolve(focus='blast', query='...')` |
| **3. Evolve** | KB briefing auto-chained into Edit hook (no explicit call needed) | `Edit` (hook surfaces KB constraints), `learn(query='module')` |
| **4. Run** | Pipeline executes; file watcher auto-reindexes (5min cooldown) | (automatic) |
| **5. Verify** | Post-change audit, missed constraint detection | `review(mode='forget')`, `review(mode='convention')`, `review(mode='health')` |
| **6. Journal** | Persist findings as KB entries, link related knowledge | `learn(title='...', content='...')`, `learn(action='graph')` |
| **7. Maintain** | Reindex, KB health check, doc sync | `hme_admin(action='index')`, `learn(action='health')`, `review(mode='docs')` |

**After every confirmed round:**
1. File watcher auto-reindexes (or `hme_admin(action='index')` for batch changes)
2. `learn(title='...', content='...', category='pattern')` — persist calibration anchors
3. `learn(action='compact')` — if KB > 30 entries, deduplicate
4. Update CLAUDE.md and relevant doc files if architectural rules changed

## Lab Governance

The lab (`lab/run.js` + `lab/sketches.js`) is HME's experimental substrate. Lab sketches prototype behavior via monkey-patching before integration into `/src`.

**Lab rules (enforced by hooks):**
- Every `postBoot()` must create AUDIBLE behavior via real monkey-patching
- No empty sketches (just calling `setActiveProfile` tests nothing)
- No `V` (validator) in lab — use `Number.isFinite` directly
- No `crossLayerHelpers` — use inline layer logic
- Don't return values from void functions

**Lab + KB cycle:**
1. Write sketch with real implementation code
2. Run via `node lab/run.js`
3. Listen to output, compare with baseline
4. If confirmed: extract to `/src`, `learn(title=, content=, category='pattern')` for the finding
5. If refuted: `learn(title=, content=, category='pattern')` to prevent re-attempting

## Mandatory Workflow

The per-session walkthrough that enforces this workflow is specified in [HME_ONBOARDING_FLOW.md](HME_ONBOARDING_FLOW.md) — a linear state machine driven by a chain-decider middleman ([onboarding_chain.py](../tools/HME/mcp/server/onboarding_chain.py)) living inside the MCP server. New sessions start in state `boot` and graduate only after one full loop (selftest → evolve → edit → review → pipeline → commit → learn). The KB briefing that used to be a separate `read(target, mode='before')` step is now auto-chained into every `Edit` via the pretooluse hook.

### Before Editing Code

The `pretooluse_edit.sh` hook surfaces KB constraints automatically whenever you call the native `Edit` tool on a file under `/src/`. You do NOT need to call any HME tool first — the briefing is auto-chained into every Edit. KB constraints appear as `systemMessage` on the permission-allow response before the edit runs.

The full-briefing internal function (`read(target, mode='before')`) still exists as a hidden utility for scripted use, but agents never call it directly — hooks handle everything transparently.

### After Code Changes

1. **`review(mode='forget')`** — auto-detects changed files from git. Checks against KB constraints, boundary rules, L0 channels, doc needs. Optionally pass `changed_files='file1.js,file2.js'` to override.
2. File watcher auto-reindexes on save (5s debounce, 5min cooldown between full reindexes)
3. For batch changes: `hme_admin(action='index')` once at the end

### After Confirmed Round

1. `learn(title='...', content='...', category='pattern')` for calibration anchors, decisions, anti-patterns
2. Use `related_to="<entry_id>"` with `relation_type` to link related entries
3. Update docs: CLAUDE.md, relevant doc/*.md files

### For Any Search

Use `learn(query='...')` for KB semantic search, `trace(target)` for signal flow / caller chains, or the native `Grep` tool (which is passthru-enriched with KB context via the HME hook). All searches add KB cross-referencing that bare Grep misses.

### When Pipeline Fails

Read pipeline output, then `evolve(focus='blast', query='<symbol>')` for dependency traces or `learn(query='<error text>')` for similar-KB-bug lookup.

## Autonomous Evolver Loop

The Stop hook implements the **ralph-loop pattern**: when `.claude/hme-evolver.local.md` exists, the Stop hook blocks session exit and injects the next evolution directive, creating an autonomous multi-round evolution cycle.

### Setup

Create `.claude/hme-evolver.local.md` (gitignored):

```markdown
---
enabled: true
iteration: 1
max_iterations: 5
done_signal: "EVOLUTION COMPLETE"
---

Continue simultaneous synergistic evolution of src/, doc/, and HME.
Run npm run main after each round of changes. After a STABLE or EVOLVED pipeline,
auto-commit and move to the next evolution opportunity. When you have completed
all outstanding evolutions and the system is in a good state, output "EVOLUTION COMPLETE".
```

The loop drives until `max_iterations` is reached or `done_signal` appears in the transcript.

### Fields

| Field | Description |
|-------|-------------|
| `enabled` | `true` to activate (set `false` to pause without deleting) |
| `iteration` | Auto-incremented by the hook — do not set manually |
| `max_iterations` | Hard cap (0 = unlimited) |
| `done_signal` | String Claude outputs to signal completion |

The prompt body (everything after the second `---`) is injected verbatim as the next user prompt.

**Note:** Hook changes require `claude plugin update HME@polychron-local` to refresh the plugin cache.

## When to Use What

| I want to... | Use |
|---|---|
| Find code by intent | `find("where does convergence happen")` |
| Find all callers of a function | `find("callers of convergenceDetector")` |
| Find boundary violations | `find("X should use Y", mode="boundary")` |
| Check if a change is safe | `read("symbolName", mode="impact")` |
| Audit a file for conventions | `review(mode='convention', file_path='path')` |
| Check constraints before editing | `read("path/to/file.js", mode="before")` |
| Find exact variable name | `find("varName", mode="grep")` |
| Check KB for stale entries | `learn(action='health')` |
| Understand a module deeply | `read("moduleName", mode="story")` |
| Preview rename impact | `find("oldName→newName", mode="rename")` |
| What should I work on next? | `evolve()` |
| Post-pipeline review | `review()` or `review(mode='full')` |
| Trace a signal through the system | `trace("emergentRhythm")` |
| Search the KB | `learn(query='coupling constraints')` |
| Add a KB entry | `learn(title='...', content='...', category='pattern')` |
| Enrich a prompt with project context | `enrich_prompt(prompt='...', frame='focus on...')` |
| Search 2-3 specific files | Read tool (not HME — overkill) |

## The Public Tool Surface — Complete Reference

Six agent-callable MCP tools route every public capability: `evolve`, `review`, `learn`, `trace`, `hme_admin`, and `hme_todo` (hierarchical todo). Internal helpers (`search_code`, `find_callers`, `module_intel`, `before_editing`, etc.) are called BY these tools — agents never invoke them directly. The `read` tool exists as a hidden utility auto-chained into the Edit hook.

### 1. `evolve(focus)` — "What should I work on next?"

| focus | What it does |
|-------|-------------|
| `"all"` (default) | LOC offenders + coupling gaps + pipeline suggestions + synthesis |
| `"loc"` | Top oversized files in src/ |
| `"coupling"` | Dimension gaps + antagonism leverage points |
| `"pipeline"` | Pipeline-based evolution suggestions |
| `"patterns"` | Meta-patterns across journal rounds: confirm rates, subsystem receptivity |
| `"seed"` | Auto-generate starter KB entries for high-dependency modules with zero coverage |
| `"contradict"` | Full KB pairwise contradiction scan — finds conflicting entries, suggests resolution |
| `"stress"` | Adversarial self-play — 35 enforcement probes across LIFESAVER, hooks, ESLint, feedback graph, selftest |
| `"invariants"` | Declarative invariant battery — loads checks from `config/invariants.json`. 10 check types, extensible without Python changes |

### 2. `review(mode, ...)` — Post-pipeline review hub

| mode | Extra params | What it does |
|------|-------------|-------------|
| `"digest"` (default) | `critique=True/False` | Pipeline digest with evolution suggestions. Auto-drafts KB entry on STABLE |
| `"regime"` | | ASCII regime timeline + transitions |
| `"trust"` | `system_a`, `system_b` | Trust ecology. Empty = leaderboard. Two systems = rivalry with overtakes |
| `"sections"` | `section_a`, `section_b` (0-indexed) | Side-by-side section comparison |
| `"audio"` | | Perceptual analysis (EnCodec + CLAP). 15% confidence |
| `"composition"` | | Section arc biographies + drama moments + hotspot leaderboard |
| `"health"` | | Full-repo convention sweep, prioritized by severity |
| `"forget"` | `changed_files` (auto-detects from git) | Post-change audit: missed constraints, boundaries, doc needs |
| `"convention"` | `file_path` (required) | Audit single file against conventions |
| `"symbols"` | | Dead code detection + importance ranking |
| `"docs"` | | Verify docs match implementation |
| `"full"` | | Sequential: digest + regime + trust |

### 3. `read(target, mode)` — Smart code reader

**Auto-detection** (mode="auto", default): format determines behavior.

| target format | What happens |
|--------------|-------------|
| `"src/path/file.js"` | File structure + KB context |
| `"src/path/file.js:10-50"` | Extract lines 10-50 |
| `"src/path/file.js:42"` | Line 42 ± 10 lines context |
| `"functionName"` (camelCase) | Get function body, or module story if it's a src/ module |
| `"anything else"` | Semantic code search (top 5) |

**Explicit modes:**

| mode | What it does |
|------|-------------|
| `"before"` | **Pre-edit briefing**: KB constraints + callers + boundaries + evolutionary potential |
| `"story"` | Module living biography (definition, evolution, callers, neighbors) |
| `"impact"` | Callers + KB constraints (blast radius) |
| `"both"` | Story + impact combined |
| `"lines"` | Line range extraction |
| `"function"` | Function body extraction |
| `"structure"` | File structure (symbols, functions, globals) |
| `"callers"` | All call sites of the target |
| `"deps"` | Dependency graph for a file |

### 4. `learn(...)` — Unified KB interface

**Auto-detection** from parameters (no mode needed):

| What you pass | What happens |
|--------------|-------------|
| `query='coupling constraints'` | Search KB (semantic + BM25 + cross-encoder reranking) |
| `title='R94 fix', content='...'` | Add KB entry. Optional: `category`, `tags`, `related_to`, `listening_notes` |
| `remove='entry_id'` | Delete KB entry |

**Explicit actions** (override auto-detection):

| action | What it does |
|--------|-------------|
| `"list"` | List all entries (filter by `category`) |
| `"compact"` | Deduplicate similar entries (threshold=0.85) |
| `"export"` | Export entire KB as markdown |
| `"graph"` | Spreading-activation knowledge graph (uses `query`) |
| `"dream"` | Pairwise similarity pass — discover hidden connections |
| `"health"` | KB staleness check (stale file refs, wrong line counts) |

**Categories:** `architecture`, `decision`, `pattern`, `bugfix`, `general`
**Relation types:** `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`

### 5. `trace(target, mode, section, limit)` — Signal flow tracing

| mode | What it does |
|------|-------------|
| `"auto"` (default) | Detects: beat key (S3/2:1:3:0/400) → snapshot; L0 channel → cascade; else → module |
| `"snapshot"` | Full state at one beat: regime, trust, coupling labels, notes. Beat key formats: `S3`, `2:1:3:0`, `400` |
| `"cascade"` | L0 channel cascade trace, 3 hops deep |
| `"module"` | Per-section trace: regime, tension, trust scores, value ranges |
| `"causal"` | Causal trace: constant → controller → metric → musical effect |
| `"interaction"` | Correlate two modules' trust scores: cooperative/competitive/independent |
| `"delta"` | Compare current vs previous pipeline run: feature deltas, regime shifts, trust changes |

### 6. `hme_admin(action, modules, antipattern, hook_target)` — HME maintenance

| action | What it does |
|--------|-------------|
| `"selftest"` (default) | Verify tool registration, doc sync, index, llama.cpp, KB, symlinks |
| `"reload"` | Hot-reload tool modules (modules='module1,module2' or 'all') |
| `"both"` | Reload then selftest |
| `"index"` | Reindex all code chunks + symbols |
| `"clear_index"` | Wipe hash cache + chunk store, rebuild from scratch |
| `"warm"` | Pre-populate all caches: Tier 1 callers+KB, Tier 2 synthesis, GPU KV contexts |
| `"introspect"` | Self-benchmarking: tool usage patterns, workflow discipline, KB health |
| `"fix_antipattern"` | Synthesize bash snippet to enforce a behavioral rule in a hook (antipattern=, hook_target=) |

`hook_target` options: `pretooluse_bash`, `pretooluse_edit`, `pretooluse_read`, `pretooluse_grep`, `pretooluse_write`, `posttooluse_bash`, `stop`, `userpromptsubmit`.

`enrich_prompt` is an internal function accessible via HTTP shim (`/enrich_prompt`) and HME Chat UI — not an MCP tool.

## Knowledge KB

68 entries across 4 categories. FSRS-6 spaced repetition: frequently retrieved entries resist temporal decay.

| Category | Count | What to Store | Example |
|----------|-------|--------------|---------|
| `architecture` | 27 | Boundary rules, module profiles, system topology | "feedbackOscillator — 198 lines, highest hotspot rate 31.7%" |
| `decision` | 17 | Calibration anchors, threshold choices, confirmed rounds | "R80 LEGENDARY: complexity triple-bridge" |
| `pattern` | 15 | Anti-patterns, proven patterns, evolution recipes | "antagonism bridge: couple BOTH sides of antagonist pair" |
| `bugfix` | 9 | Root causes, fixes, prevention rules | "perceptual OOM: force CPU when llama.cpp warm contexts resident" |

## Hooks Integration

All hooks live in `tools/HME/hooks/` as standalone scripts, registered in `hooks/hooks.json` (Claude Code plugin format). This keeps hook logic version-controlled, testable, and visible from the HME directory.

### Activity Bridge

Phase 1 of the [openshell feature mapping](openshell_features_to_mimic.md). Hooks emit structured events into `metrics/hme-activity.jsonl` (gitignored, append-only). Every line is one JSON object: `{event, ts, session, ...}`. The shared writer is `tools/HME/activity/emit.py` — a zero-dependency CLI invoked from bash hooks in the background.

| Event | Source hook | Fields |
|-------|-------------|--------|
| `edit_pending` | `pretooluse_edit.sh` | file, module, hme_read_prior |
| `file_written` | `posttooluse_edit.sh` | file, module, hme_read_prior |
| `coherence_violation` | `posttooluse_edit.sh` | file, module, reason (only after onboarding graduation) |
| `pipeline_run` | `posttooluse_bash.sh` | verdict, passed, wall_s, hci |
| `round_complete` | `stop.sh` | session |

Query the stream via `status(mode='activity')` — surfaces event counts, coherence ratio (writes with vs. without prior HME read), pipeline runs, and recent writes. Window defaults to "round" (events since last `round_complete`).

The bridge is additive: no state is kept outside the JSONL itself, and `activity_digest.py` reads the tail lazily. Phases 2 and 3 share this event stream.

### Inference Proxy

Phase 2 of the feature mapping. `tools/HME/proxy/hme_proxy.js` is a Node.js HTTP chokepoint between Claude Code and the Anthropic API. Point Claude Code at it by setting `ANTHROPIC_BASE_URL=http://127.0.0.1:9099` and launching `node tools/HME/proxy/hme_proxy.js`.

Every request is scanned stateless-ly: the full `messages` array is walked for `tool_use` blocks, HME read calls (`mcp__HME__read`, `mcp__HME__before_editing`) are compared against write-bearing tool calls (`Edit`, `Write`, `NotebookEdit`, `mcp__HME__edit`). Every call emits one `inference_call` event into `metrics/hme-activity.jsonl`; write-intent without a prior read adds a `coherence_violation` event with `source=proxy` and the offending tool name.

Streaming SSE responses pipe through verbatim — no buffering, no latency penalty. The proxy never modifies request bodies in v1 (observability only). System-prompt injection is deliberately deferred to a future phase so the observation signal can be validated in isolation.

Test mode: `node tools/HME/proxy/hme_proxy.js --test < payload.json` prints the scan result and exits non-zero on violation. Used by unit tests without spinning up a listener.

### Pipeline Policy Gate

Phase 3 of the feature mapping. `scripts/pipeline/check-hme-coherence.js` runs as a PRE_COMPOSITION step in `main-pipeline.js` (after `check-registration-coherence`, before `check-safe-preboot-audit`). It reads the activity stream, slices to the current round (events since the last `round_complete`), and fails the pipeline with exit code 1 if any `coherence_violation` events fired.

Output: `metrics/hme-violations.json` — a full audit record with meta (window size, write coverage %), violations array (split by hook vs proxy source), and ISO timestamps. Picked up by `posttooluse_bash.sh`'s LIFESAVER scanner when the pipeline completes.

Because `coherence_violation` emission in `posttooluse_edit.sh` is gated on `_onb_is_graduated`, pre-graduation sessions never trip this check — the gate ramps in naturally once the agent has gone through one full onboarding loop.

### KB Staleness Index

Phase 2.2 of the feature mapping. `scripts/pipeline/build-kb-staleness-index.py` runs as a POST_COMPOSITION step, cross-references KB entry timestamps (lance `knowledge` table) against source-file mtimes and `file_written` events from the activity bridge, and writes `metrics/kb-staleness.json`. Every module lands in one of three buckets:

- **FRESH** — most recent KB entry touching the module is newer than (or within `HME_STALENESS_STALE_DAYS`, default 7d, of) the last file write.
- **STALE** — module has KB coverage but edits have outpaced it by > threshold.
- **MISSING** — no KB entry mentions the module at all.

Surfaced via `status(mode='staleness')`. Read by the inference proxy at request time to annotate jurisdiction injections (see below) and by the coherence-score computer.

Matching uses word-boundary regex on title/tags (primary) and content (only for stems ≥6 chars), so short names like "Motif" don't over-match generic prose.

### Round Coherence Score

Phase 2.3 of the feature mapping. `scripts/pipeline/compute-coherence-score.js` computes a single 0..100 metric per round from three components:

```
coherence_score = read_coverage * violation_penalty * staleness_penalty
```

- `read_coverage` = `file_written` events with `hme_read_prior=true` / total writes
- `violation_penalty` = `max(0, 1 − violation_count × 0.1)`
- `staleness_penalty` = 1 − (touches on STALE/MISSING modules / touches with index info)

Output: `metrics/hme-coherence.json` with score, delta vs previous round, and per-component breakdown. Surfaced via `status(mode='coherence')`.

### Evolver Blind-Spot Surfacing

Phase 2.4 of the feature mapping. `tools_analysis/blindspots.py` walks the full activity-bridge history, splits events into closed rounds at each `round_complete`, and over the last N rounds (default 10, `HME_BLINDSPOT_WINDOW` env var) computes three coverage gaps:

- Subsystems (utils/conductor/rhythm/time/composers/fx/crossLayer/writer/play) with zero `file_written` events in the window
- Modules written chronically without a prior HME read (≥2 occurrences)
- Touched modules that have no KB coverage at all (cross-reference with the staleness index)

Surfaced via `status(mode='blindspots')`. Factual coverage data, not a critique — the decision about whether to rotate attention remains the Evolver's.

### Causal Cascade Indexing

Phase 2.5 of the feature mapping. `tools_analysis/cascade_analysis.py` merges `metrics/dependency-graph.json`, `metrics/feedback_graph.json`, and node provides/consumes registries into a forward BFS that answers *"if I change X, what does that trigger?"*.

Invoked via `trace(target='moduleName', mode='impact')`. Returns:

- Forward impact chain at depth 1..3 (file-level, with the global name bridging each edge)
- Blast-radius histogram grouped by subsystem
- Feedback loops the module participates in
- Firewall ports it touches
- Top reverse callers (1 hop) for centrality context

Also exposes `cascade_summary(target)` as a compact dict for the inference proxy to consume on hot paths.

### Real-Time Jurisdiction Injection

Phase 2.1 of the feature mapping, landing inside the inference proxy. On every request the proxy extracts the `file_path` / `path` / `target` field from every write-bearing tool_use block in the most recent assistant turn, then checks whether the target falls inside a tracked zone (`src/conductor/signal/meta/`, `src/conductor/signal/profiling/`) **or** matches any file in the 93-entry bias bounds manifest (`scripts/pipeline/bias-bounds-manifest.json`). Phase 3 extended the detection to also trigger on modules with **open hypotheses** (Phase 3.1) or **semantic drift warnings** (Phase 3.3).

If any target matches, the proxy builds a structured jurisdiction block containing:

- Zone tag (if the file is inside a controller authority boundary)
- Every locked bias registration for that file with exact `[lo, hi]` bounds
- KB staleness status for the module (FRESH/STALE/MISSING, delta days, match count)
- **Open hypotheses** whose `modules` list includes this file (id, claim, falsifier)
- **Semantic drift warning** if the module's structural signature has diverged from its KB baseline
- Remediation commands for re-snapshotting stale bounds and re-capturing drifted signatures

The block is appended to `payload.system` (supports both the string and array-of-content-blocks forms) before upstream dispatch. `Content-Length` is recomputed. An `injected=true` flag is attached to the `inference_call` activity event, and a separate `jurisdiction_inject` event is emitted so the activity digest and pipeline gate can observe how often injection fires.

Set `HME_PROXY_INJECT=0` to disable injection and run the proxy in pure observability mode. Default is on.

### Hypothesis Lifecycle Registry

Phase 3.1 of the feature mapping. Every causal claim the Evolver makes about the system gets a first-class machine-queryable record in `metrics/hme-hypotheses.json` — proposer round, claim, **falsification criterion**, list of rounds in which the hypothesis was tested, status (OPEN/CONFIRMED/REFUTED/INCONCLUSIVE/ABANDONED), and the modules it applies to.

CRUD via the existing `learn` tool (no new top-level tool):

- `learn(action='hypothesize', title=CLAIM, content=FALSIFIER, tags=[modules], query=ROUND, listening_notes=evidence)` — register
- `learn(action='hypothesis_test', remove=ID, content=VERDICT, query=ROUND, listening_notes=evidence)` — record a test
- `learn(action='hypotheses')` or `status(mode='hypotheses')` — list all, grouped by status

The proxy loads OPEN hypotheses at request time and injects them for any write target whose module appears in a hypothesis's modules list — so the Evolver sees relevant standing claims before it makes an edit that might confirm or refute them.

### Productive Incoherence Detection

Phase 3.2 of the feature mapping. The coherence score previously penalized every write-without-HME-read equally. `posttooluse_edit.sh` now cross-references the KB staleness index at emit time and splits the event stream:

- **Lazy violation** — module has FRESH KB coverage but the agent skipped `read(mode='before')`. Emits `coherence_violation` (penalized).
- **Productive incoherence** — module has MISSING KB coverage, so there was nothing meaningful to read first. Emits `productive_incoherence` (rewarded) plus a `learn_suggested` hint for the Evolver to capture findings afterward.

`compute-coherence-score.js` gains an `exploration_bonus` term:

```
score = read_coverage × violation_penalty × staleness_penalty × exploration_bonus
exploration_bonus = 1 + min(0.2, productive_incoherence_count × 0.05)
```

A round with 4+ productive explorations can gain up to +20% on top of the base score. Keeps HME disciplined in well-understood territory while actively rewarding the Evolver for pushing into uncharted ground.

### KB Semantic Drift Verification

Phase 3.3 of the feature mapping. Staleness says "the file was edited after the KB entry". Drift says "even if the KB entry is recent, the module's structural relationships have shifted enough that the description is likely wrong". Two scripts implement this:

- `scripts/pipeline/capture-kb-signatures.py` — bootstraps/refreshes `metrics/kb-signatures.json`. For every KB entry, picks a candidate module (from title → tags → content), then computes a mechanical structural signature: caller count (from dependency graph), provides/consumes globals, bias registration keys, firewall ports, L0 channel reads/writes, content hash prefix. Captured at learn time; re-run to refresh baselines.

- `scripts/pipeline/check-kb-semantic-drift.py` — runs every pipeline. Re-derives each module's current signature and diffs against the baseline. Entries with ≥2 structural differences (tunable via `HME_DRIFT_THRESHOLD`) are flagged in `metrics/hme-semantic-drift.json`. Surfaced via `status(mode='drift')`.

Parallel signature index, not an extension to the lance schema — works without touching existing KB entries.

### Prediction Accuracy Scoring

Phase 3.4 of the feature mapping. Every time `trace(target, mode='impact')` runs (either manually or via proxy injection), the cascade analyzer appends a prediction record to `metrics/hme-predictions.jsonl` containing the target module and the list of predicted affected modules (BFS depth 2 forward reach).

A post-composition reconciler (`scripts/pipeline/reconcile-predictions.js`) reads the log + `metrics/fingerprint-comparison.json` after the pipeline, then classifies each prediction:

- **Confirmed** — predicted module appears in the fingerprint delta
- **Refuted** — predicted but didn't shift
- **Missed** — shifted but was not in any prediction

Computes per-round accuracy + an exponential moving average (α=0.2) across 50 rounds into `metrics/hme-prediction-accuracy.json`. Surfaced via `status(mode='accuracy')`.

Rising EMA = HME's causal model is learning. Falling EMA = predictions diverging from reality, which is a stronger signal than staleness alone (staleness says a file changed, low accuracy says HME's understanding of what the file *does* is wrong).

### Pattern Crystallization

Phase 3.5 of the feature mapping. `tools_analysis/crystallizer.py` scans the KB every pipeline for multi-round patterns: groups entries by substantive tag membership (metadata tags like `legendary`/`stable`/`bugfix` blacklisted), then for each tag pools all `R\d+` round references from member content. Clusters with ≥3 members across ≥3 distinct rounds qualify as crystallized patterns and land in `metrics/hme-crystallized.json`.

Each pattern record includes: shared tags (strict intersection of member tag sets), pooled round list, synthesis (first sentence of the most recent member), and member KB entry ids for traceability.

Run on demand: `learn(action='crystallize')`. Read: `status(mode='crystallized')`.

Rule-based in v1 — no LLM synthesis. First run promoted 19 patterns from 116 entries (`emergentMelodicEngine` 8 members × 8 rounds, `antagonism-bridge` 6 × 7, `melodic-coupling` 6 × 6, etc.) — exactly the standing principles the Evolver previously had to reconstruct from journal archaeology each session.

### Musical Ground Truth Correlation

Phase 4.1 of the feature mapping — **the external anchor**. Every previous HME metric (coherence, prediction accuracy, staleness, drift, crystallization) is internally circular. `scripts/pipeline/compute-musical-correlation.js` runs post-composition to correlate HME's self-assessment signals against the actual musical output the pipeline produced:

- `hme_coherence` vs `fingerprint_verdict` (numeric: STABLE=1, EVOLVED=1.1, DRIFTED=0)
- `hme_coherence` vs `perceptual_complexity_avg` (EnCodec section tension)
- `hme_coherence` vs `clap_tension` (CLAP query peak)
- same triplet for `hme_prediction_accuracy`

Computes rolling-window Pearson correlation over the last 20 rounds, keeps 60 rounds of history in `metrics/hme-musical-correlation.json`. If the strongest correlation drops below 0.2 over ≥5 points, emits a FATAL warning: HME's self-model has decoupled from musical outcomes and is optimizing its own metrics without that optimization translating to emergence.

Surfaced via `status(mode='music_truth')`. The correlation trend is the ultimate validator for the entire HME architecture — a perfectly coherent HME that produces musically incoherent compositions has optimized the wrong thing entirely.

### Trust-Weighted KB

Phase 4.2 of the feature mapping. Every KB entry gains an epistemic trust weight derived from the round it was written in:

```
trust = 0.4 × coherence_at_write
      + 0.3 × accuracy_at_write
      + 0.2 × verdict_bonus
      + 0.1 × age_decay
```

`scripts/pipeline/compute-kb-trust-weights.py` matches each entry's timestamp against the musical-correlation and prediction-accuracy histories (within 14 days), falling back to a 0.5 uniform prior when history is too sparse or distant. Tiers: HIGH ≥ 0.75, MED ≥ 0.5, LOW < 0.5. Requires ≥3 history points before history-derived components activate (otherwise a single degenerate round would drag every entry's trust to the floor).

Output: `metrics/kb-trust-weights.json` keyed by entry id with trust score, tier, and per-component breakdown. Parallel index — no modifications to the lance schema.

Surfaced via `status(mode='kb_trust')`. The proxy reads this file at injection time and labels injected entries by tier so the Evolver sees *how well HME knows something*, not just *what HME knows*.

### Intention-Execution Gap Tracking

Phase 4.3 of the feature mapping. `scripts/pipeline/compute-intention-gap.js` reads the HME todo store (`.claude/mcp/HME/todos.json`) and cross-references each todo against `file_written` events from the activity bridge. Every trackable todo lands in one of three buckets:

- **fully_executed** — status=completed+done=true AND at least one file/module mentioned in the todo text appears in the round's write events
- **partially_executed** — status=completed but none of the expected targets were actually written
- **abandoned** — status=pending/in_progress at round end, with at least one trackable target

Untrackable todos (completed with no file references) are dropped from the gap metric.

Improvement vs doc: doc proposed parsing proposed evolutions out of the prose journal. The todo store gives the same signal in clean JSON form — no fuzzy text parsing. Every todo already has `text`, `status`, `done`, `ts`.

Rolling 30-round EMA in `metrics/hme-intention-gap.json`. Surfaced via `status(mode='intention_gap')`. Over many rounds, structural patterns emerge — certain subsystems consistently proposed-but-not-executed (blind spots with extra friction), certain file combinations consistently partial (boundary complexity underestimated).

### HME Self-Audit

Phase 4.4 of the feature mapping. `tools_analysis/self_audit.py` queries three utility signals and surfaces architectural inefficiencies as *evolution candidates*:

1. **KB category usage** — categories with ≥15 entries and zero retrievals (UNUSED), or ≥10 entries with retrievals < entries/10 (UNDER_QUERIED)
2. **Silent injections** — proxy `jurisdiction_inject` events not followed by `mcp__HME__read` in the same session before `round_complete`
3. **Cascade overconfidence** — prediction-accuracy EMA < 0.5 over ≥5 rounds

Data sources: `.claude/mcp/HME/knowledge_access.json`, `metrics/hme-activity.jsonl`, `metrics/hme-prediction-accuracy.json`. Read-only — never modifies anything, just reports.

Surfaced via `status(mode='self_audit')`. This is the first step toward HME being subject to the same "structural over parametric" and "never delete — implement" laws that govern Polychron itself: when HME identifies a part of its own architecture that isn't working, that becomes an evolution candidate alongside Polychron candidates in the Evolver's Phase 3 selection.

### Adversarial Self-Probing

Phase 4.5 of the feature mapping. `tools_analysis/probe.py` generates *candidate* probes — deliberately boundary-pushing evolution proposals targeting modules where HME's current model is most likely to be wrong.

Candidates are drawn from the intersection of:

1. **Subsystem intersection modules** — modules whose forward edges cross ≥3 distinct subsystems (from the dependency graph). These are structural intersection points where cascade confidence is most likely mis-calibrated.
2. **KB trust gaps** — modules with NONE or LOW trust-tier KB coverage (score multiplier ×2).
3. **Cascade accuracy** — if the prediction-accuracy EMA is unknown or below 0.5, everything gets a ×2 multiplier because the cascade model itself is suspect.

For each candidate, the probe carries a predicted cascade summary (depth-2 forward reach, direct callers, feedback loops) and a predicted_confidence tier. The Evolver runs the probe in a lab sketch (never `main`), observes the actual outcome, and feeds the delta back into HME's trust weights and cascade model.

Surfaced via `status(mode='probes')`. This module never *runs* a probe — it produces candidates and lets the Evolver decide which to execute. Controlled failure is more epistemically valuable than repeated success in familiar territory; the probe mechanism gives HME a way to actively stress-test its own model rather than waiting for the Evolver to accidentally discover blind spots.

### Compositional Trajectory

Phase 5.1 of the feature mapping. `scripts/pipeline/compute-compositional-trajectory.js` fits a linear trend to the last 20 rounds of perceptual signals from `metrics/hme-musical-correlation.json`:

- `perceptual_complexity_avg` — average EnCodec section tension
- `clap_tension` — CLAP tension-query peak similarity
- `encodec_entropy_avg` — mean codebook entropy

Per-signal slope is classified GROWING / PLATEAU / DECLINING against a per-signal threshold. Overall verdict is a majority vote with PLATEAU as the conservative tiebreaker.

Output: `metrics/hme-trajectory.json` with per-signal slope/intercept/variance and a rolling 60-round verdict history. Surfaced via `status(mode='trajectory')`. Feeds the coherence budget — when the trajectory shows PLATEAU or DECLINING, HME's guidance shifts toward structural novelty regardless of how well individual rounds are executed.

### Coherence Budget (Homeostatic Governance)

Phase 5.2 of the feature mapping — **the inversion point**. The previous phases all optimized HME toward more discipline. This one recognizes that maximum discipline may suppress the productive chaos that generates musical emergence — and instead *calibrates* coherence to an optimal band derived from history.

`scripts/pipeline/compute-coherence-budget.js` algorithm:

1. Read musical-correlation history and compute each round's composite musical-outcome score (`0.5 × perceptual_complexity + 0.3 × clap_tension + 0.2 × verdict_numeric`).
2. Take the top quartile of rounds by outcome — "the good rounds".
3. The optimal coherence band = [25th, 75th] percentile of `hme_coherence` values in those good rounds.
4. If history has <8 rounds, use a prior band of [0.55, 0.85].
5. Classify current coherence as BELOW / OPTIMAL / ABOVE the band and emit a prescription:
   - **BELOW**: TIGHTEN — proxy injects forcefully (full KB context + bias bounds + open hypotheses)
   - **OPTIMAL**: NORMAL injection
   - **ABOVE**: RELAX — proxy skips non-critical warnings, allows writes into low-coverage territory without emitting `coherence_violation`, flags the round as "emergence-licensed"

Output: `metrics/hme-coherence-budget.json` with band, current state, and prescription. Surfaced via `status(mode='budget')`. Stops maximizing coherence and starts *governing* it homeostatically — the same pattern Polychron's own conductors use for density, tension, and flicker.

### Architectural Negative Space Discovery

Phase 5.3 of the feature mapping. `tools_analysis/negative_space.py` finds structural gaps in Polychron's topology that aren't blind spots (the Evolver never considered them) but genuine theoretical absences the system's own structure predicts.

Two mechanical detectors (v1 deliberately avoids semantic similarity):

1. **Feedback loop near-misses** — for each registered feedback loop, compute the set of modules whose dependency-graph edges touch ≥⌊|loop|/2⌋ of the loop's participants but aren't themselves registered in the loop. Universal infrastructure modules (those with producer fan-out ≥30) are filtered out so `validator`/`clamps`/`index` don't dominate. Top candidate on first run: `stutterVariants → entropy-regulator` at 1.0 confidence (3/3 participants touched, not in loop).
2. **Co-consumed orphan pairs** — module pairs imported together by ≥5 shared consumers (excluding universal modules) with no direct producer→consumer edge between them. The architecture treats them as functionally related without explicit wiring. Top result: `stutterNotes ↔ stutterVariants` (20 shared consumers).

Surfaced via `status(mode='negative_space')`. These become first-class evolution candidates that the Evolver didn't have to think of — they emerge from HME's structural model of the system.

### Evolver Cognitive Load Modeling

Phase 5.4 of the feature mapping. HME models Polychron's architecture and its own KB. This module adds a model of the agent running the loop.

`tools_analysis/cognitive_load.py` walks the activity bridge and computes per-closed-round load signatures: total tool calls, file writes, edit pendings. Maintains a rolling distribution and classifies the current session:

- **LOW** — tool_calls below p50 of historical workload
- **MEDIUM** — tool_calls above p50
- **MEDIUM_HIGH** — tool_calls and file_writes both above p75
- **HIGH** — tool_calls above p90 (top decile of workloads)

Output: `metrics/hme-cognitive-load.json` with current signature, historical distribution, and load level. Surfaced via `status(mode='cognitive_load')`. Needs ≥5 closed rounds before percentile classification activates.

### Reflexivity Model — Injected vs Clean Predictions

Phase 6.1 of the feature mapping. HME's prediction accuracy scores have been contaminated by HME's own injections: when the cascade indexer predicts that editing X will affect Y and Z, and the proxy surfaces that prediction to the Evolver before the edit, the resulting "confirmation" is partly self-fulfilling — the Evolver knew the prediction and acted on it.

Fix: every `cascade_prediction` record carries an `injected: bool` flag. `reconcile-predictions.js` splits predictions into two buckets:

- **Clean bucket** — predictions made post-hoc with no injection influence. True accuracy test of the cascade model.
- **Injected bucket** — predictions the Evolver saw before acting. Measures *influence*, not *accuracy*.

A `reflexivity_ratio` per round records what fraction of predicted modules came from injected predictions. High injected-bucket confirmation but flat clean-bucket accuracy means HME is changing what the Evolver does without actually predicting better — influence without understanding. Surfaced via `status(mode='reflexivity')`.

### Constitutional Identity Layer

Phase 6.2 of the feature mapping. CLAUDE.md says what Polychron *can't be* (prohibitions). `metrics/hme-constitution.json` says what Polychron *fundamentally IS* (positive affirmations).

`scripts/pipeline/derive-constitution.py` extracts constitutional claims from three evidence sources:

1. **Structural** — every feedback loop and firewall port in `metrics/feedback_graph.json` is an architectural invariant. All confidence 1.0.
2. **Methodological** — crystallized patterns with ≥4 rounds and ≥3 members become standing architectural fixtures. Confidence scales with evidence breadth.
3. **Musical** — human ground truth entries with compelling/surprising/moving sentiment, grouped by (section, moment_type). Confidence scales with record count.

Each claim carries an evidence trail: rounds, pattern ids, ground-truth ids. Surfaced via `status(mode='constitution')`. First run produced **37 claims**: 20 structural + 16 methodological + 1 musical from 19 crystallized patterns and 1 ground-truth entry.

The distinction between rules and identity is the one that allows genuine evolution rather than endless constraint accumulation.

### Doc Drift Detection

Phase 6.3 of the feature mapping — living documentation as detection, not auto-generation. `scripts/pipeline/detect-doc-drift.py` cross-references the KB's architectural claims against the hand-maintained docs:

- KB entries referencing modules that no longer exist in `src/`
- Backtick-fenced module-name tokens in ARCHITECTURE.md / SUBSYSTEMS.md / HME.md / TUNING_MAP.md / CLAUDE.md that don't resolve to a source file
- Hard rules that have generated ≥5 productive_incoherence events (blocking exploration — refinement candidate)
- Hard rules with zero coherence_violation events over ≥10 closed rounds (consistently honored — constitutional promotion candidate)

Output: `metrics/hme-doc-drift.json`. v1 is deliberately noisy — checks only backtick-fenced tokens to avoid false positives from natural English. Surfaced via `status(mode='doc_drift')`. DETECTION signal only; human review required before claiming any doc change.

### Generalization Extraction

Phase 6.4 of the feature mapping. `scripts/pipeline/extract-generalizations.py` separates project-specific crystallized patterns from structurally general ones by scoring each pattern on `project_specificity`: the fraction of tokens (in tags + synthesis + seed) that match a Polychron-specific vocabulary list.

Patterns below the threshold (default 0.3) become generalization candidates. Each gets a templated DRAFT abstraction appended to `doc/hme-discoveries.md` — the system's externalized intellectual contribution. Templates require human polish before becoming claims. Over enough rounds this becomes the most valuable artifact the project produces: a body of knowledge about emergent musical systems design that exists nowhere else.

First run flagged 14 of 19 crystallized patterns as generalization candidates. Surfaced via `status(mode='generalizations')`.

### Multi-Agent Observability Scaffold

Phase 6.5 of the feature mapping. HME can't unilaterally split the Evolver into Perceiver / Proposer / Implementer agents — that's a process-level decision outside HME's jurisdiction. What HME provides is the scaffold so that IF the loop is run multi-agent, HME tracks inter-agent coherence.

Activity events gain an optional `role` field (perceiver / proposer / implementer / single). Hypotheses and todos gain an optional `agent_role` tag. `tools_analysis/multi_agent.py` computes:

- **perceiver → proposer coherence** — fraction of proposer-role hypotheses that share modules with recent perceiver-role activity
- **proposer → implementer coherence** — fraction of implementer-role file_written events targeting modules mentioned in proposer-role todos/hypotheses

When all events carry `role=single`, inter-agent coherence is N/A — single-agent operation isn't broken, it just can't be scored against the multi-agent ideal. Surfaced via `status(mode='multi_agent')`.

### Human Ground Truth — The Grounding Anchor

Phase 5.5 of the feature mapping — the answer to the circularity problem. Every HME metric eventually grounds out in HME's own outputs. Musical correlation was a partial external anchor but EnCodec and CLAP measure audio features, not musical meaning. The only complete anchor is a human listener finding the composition genuinely moving.

`tools_analysis/ground_truth.py` makes human feedback a first-class HME signal:

```
learn(action='ground_truth',
      title=SECTION,              # S0..S6 or 'all'
      tags=[moment_type, sentiment],
      content=COMMENT,
      query=round_tag)
```

Records land in two places:
1. `metrics/hme-ground-truth.jsonl` — append-only stream keyed by timestamp
2. The KB via `add_knowledge`, tagged `human_ground_truth`, category `decision`

**Trust override**: `compute-kb-trust-weights.py` detects the `human_ground_truth` tag and unconditionally assigns tier HIGH (trust=1.0). When an HME prediction conflicts with a ground-truth entry, the ground-truth wins and the conflict is surfaced. HME can be as sophisticated as it becomes, but the ultimate coherence validator is whether a human finds the music meaningful — and the system should never be able to optimize its way around that.

Surfaced via `status(mode='ground_truth')`.

### Hook Scripts (22 hooks across 7 lifecycle events)

All hooks share `_tab_helpers.sh` for deduped tab operations and `_safety.sh` for weighted streak counter (`_streak_tick WEIGHT` / `_streak_check` / `_streak_reset`) and HME HTTP enrichment helpers (`_hme_enrich` / `_hme_validate` / `_hme_kb_count` / `_hme_kb_titles`). Streak weights: Read=5, Edit=10, Write=10, Bash=15, Grep=20. Warns at 50, blocks at 70.

| Script | Event | Matcher | What It Does |
|--------|-------|---------|-------------|
| `sessionstart.sh` | SessionStart | * | Reset compact tab, capture previous session's nexus pending state before reset, inject HME awareness (pipeline verdict + wall time, last journal round, uncommitted changes, last commit), surface previous session unfinished items |
| `pretooluse_lifesaver.sh` | PreToolUse | * | **LIFESAVER**: stamp start time to `/tmp/hme_lifesaver_{session}_{tool}` for every tool call |
| `pretooluse_read.sh` | PreToolUse | Read | Block polling of task output files; **enrich** project source reads with KB titles via `systemMessage` (Read proceeds + KB injected, no extra turn) |
| `pretooluse_edit.sh` | PreToolUse | Edit | Surface live KB constraint warnings via shim for all project files; remind `read(mode="before")`; **emit `edit_pending`** activity event |
| `pretooluse_grep.sh` | PreToolUse | Grep | Surface live KB relevance via shim (titles only); multiline exempt |
| `pretooluse_write.sh` | PreToolUse | Write | Block memory writes, detect secrets, lab rules for `sketches.js` |
| `pretooluse_bash.sh` | PreToolUse | Bash | Block `rm run.lock`, anti-polling, anti-wait, FAILFAST enforcement; **correct** timeout via `updatedInput` (strips timeout silently, command proceeds) |
| `pretooluse_todowrite.sh` | PreToolUse | TodoWrite | **Silent capture** — writes tasks directly to HME todo store (todos.json), blocks native TodoWrite with no further action required |
| `pretooluse_hme_primer.sh` | PreToolUse | mcp__HME__ | **Enrich** — inject `AGENT_PRIMER.md` once per session via `systemMessage` on first HME tool call; appends mandatory boot check directive (run `hme_admin(action='selftest')` + `evolve(focus='invariants')`); clears flag so it only fires once |
| `pretooluse_check_pipeline.sh` | PreToolUse | mcp__HME__check_pipeline | **Redirect** — deny repeated check_pipeline calls (polling anti-pattern); pipeline status surfaces automatically via posttooluse hook |
| `pretooluse_agent.sh` | PreToolUse | Agent | **Intercept** Explore-type subagents → route to local llama.cpp agentic loop with RAG+KB context; other agent types pass through; falls back to Claude on llama.cpp unreachable or empty answer |
| `log-tool-call.sh` | PostToolUse | * | Log every tool to `session-transcript.jsonl` + shim; **LIFESAVER**: scan all `mcp__HME__*` tool output for FAIL lines → `hme-errors.log`; warn to stderr on 15-30s threshold |
| `posttooluse_bash.sh` | PostToolUse | Bash | Track background output files to tab + Evolver phase triggers (verdict + wall time in header) + **LIFESAVER**: scan pipeline-summary.json for error patterns after `npm run main`; **emit `pipeline_run`** activity event with verdict/wall/hci |
| `posttooluse_pipeline_kb.sh` | PostToolUse | Bash | Append `KB:` trace summary to tab after `npm run main` |
| `posttooluse_read.sh` | PostToolUse | Read | Silent KB enrichment after file reads of project source files; reset streak |
| `posttooluse_edit.sh` | PostToolUse | Edit | Track edited src/HME files to NEXUS backlog; warn when backlog ≥ 3/5 files; **emit `file_written`** + **split into `coherence_violation` (lazy) vs `productive_incoherence` (exploratory)** using the KB staleness index |
| `posttooluse_write.sh` | PostToolUse | Write | Track `.md`/`.txt` note files (outside `tmp/`) to tab |
| `posttooluse_agent.sh` | PostToolUse | Agent | Track subagent background output files to tab |
| `posttooluse_hme_read.sh` | PostToolUse | mcp__HME__read | Track briefed files to NEXUS; reset streak |
| `posttooluse_hme_review.sh` | PostToolUse | mcp__HME__review | Clear NEXUS edit backlog on `forget` mode; point to next step (pipeline / commit) |
| `posttooluse_addknowledge.sh` | PostToolUse | mcp__HME__learn | Clear `KB:` entries from tab after `learn(title=, content=)` add call |
| `userpromptsubmit.sh` | UserPromptSubmit | * | Inject Evolver context on evolution-related prompts |
| `precompact.sh` | PreCompact | * | Surface `KB:`/`FILE:` entries from tab + untracked `tmp/` files |
| `postcompact.sh` | PostCompact | * | Re-surface the same tab state after compaction |
| `stop.sh` | Stop | * | Verify all work is implemented in code, not just documented; **emit `round_complete`** activity event |

### Adding a New Hook

1. Create `tools/HME/hooks/your_hook.sh` (read JSON from stdin, write hookSpecificOutput JSON to stdout, exit 0)
2. Add entry to `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}/hooks/your_hook.sh`
3. Document in this table

## Polychron-Specific Features

### IIFE-Aware Chunking

Polychron's primary module pattern: `globalName = (() => { function tick() {...} })()` (487 files). The chunker creates named function chunks per IIFE.

### Embedding Model

`BAAI/bge-base-en-v1.5` (768-dim, 110M params). 3x better code similarity than previous mpnet model. Cross-encoder reranking via `cross-encoder/ms-marco-MiniLM-L-6-v2`. Configurable via `RAG_MODEL` env var.

### Symbol Indexing

321 IIFE globals + 1914 inner functions = 3848+ total symbols. Internal helpers `lookup_symbol` and `find_callers` (callable via `trace(target)` for callers and `read(target)` internally for symbol lookup) work with Polychron's global-assignment pattern.

### Three-Model llama.cpp Fleet

HME runs a three-model local synthesis fleet. No external API. All synthesis is local on two dedicated GPUs + CPU RAM.

**GPU0 — Extractor** (`qwen3-coder:30b`, 18.6GB VRAM, `/api/generate`):
- Specialized persona: "expert code extractor — facts, file paths, module names, no speculation"
- Runs Stage 1A in parallel two-stage synthesis
- Default model for `_local_think` (evolve focus=think), `before_editing` edit risks (hook-chained), `evolve(focus='blast')` dependency tracing, `review(mode='health')`, `learn(action='graph')`, `learn(action='dream')`
- Configured via `HME_LOCAL_MODEL` + `HME_LOCAL_URL`

**GPU1 — Reasoner** (`qwen3:30b-a3b`, 18.6GB VRAM, `/api/chat` streaming):
- Specialized persona: full `_THINK_SYSTEM` prompt + synthesis guidance ("synthesizer for a self-evolving music composition system")
- Runs Stage 1B (parallel) + Stage 1.75 (complex conflict resolution) + Stage 2 (final synthesis)
- All deep architectural reasoning routes here
- Configured via `HME_DEEP_MODEL` + `HME_DEEP_CHAT_URL`

**Arbiter** (`qwen3:4b`, ~2.5GB, CPU/GPU hybrid from 64GB RAM):
- Specialized persona: domain-aware hallucination guard — auto-discovers real module names via `src/crossLayer/**/*.js` glob, lists known signal fields
- Runs Stage 1.5: triages GPU0/GPU1 output for conflicts
- Three severity levels: `ALIGNED` (pass through), `MINOR` (advisory note injected), `COMPLEX` (escalate to Stage 1.75)
- Configured via `HME_ARBITER_MODEL` (default: `qwen3:4b`)

**Failure recovery:** Each model has a 3-state circuit breaker (CLOSED → OPEN → HALF_OPEN) that replaces fixed cooldowns. 3 failures within 60s opens the circuit (blocks calls for 15s recovery). HALF_OPEN allows one probe call — success resets, failure reopens.

**No model needed:**
- All hooks (pure bash), all search/grep/index operations, `hme_inspect(mode='introspect')`, `doc_sync_check`

**Configuration** (in `.mcp.json` env):
```
HME_LOCAL_MODEL=qwen3-coder:30b               # GPU0 extractor
HME_LOCAL_URL=http://localhost:11434/api/generate
HME_DEEP_MODEL=qwen3:30b-a3b                  # GPU1 reasoner
HME_DEEP_CHAT_URL=http://localhost:11434/api/chat
HME_ARBITER_MODEL=qwen3:4b                    # Arbiter (CPU/GPU hybrid)
```

### Warm KV Context System

Each model maintains an independent pre-tokenized KV context cache. The system prompt + KB prefix (~1000 tokens) is pre-processed once and reused across calls — subsequent calls skip re-tokenization entirely.

**How it works:**
- On the first interactive synthesis call, `_ensure_warm()` spawns a background daemon thread that primes all three models in parallel via `_prime_all_gpus()`
- Each model gets a *different* warm context tailored to its persona — not a shared global cache
- Warm context is embedded in the PROMPT field (not `system=`), so llama.cpp's KV cache captures it
- On subsequent `_local_think` calls with `system=_THINK_SYSTEM`, the system auto-swaps `system=` for `context=warm_ctx` transparently — no caller changes needed
- Arbiter passes `payload["context"] = arbiter_warm_ctx` for every conflict check

**Staleness detection:**
- Every warm context stores `_kb_version` at prime time
- KB writes increment the global KB version counter
- If `ctx._kb_version < current_version`, the context is stale and auto-reprimed
- `warm_context_status()` returns per-model: primed, tokens cached, age (seconds), kb_fresh flag

**Manual control:**
- `hme_admin(action='warm')` — prime all three GPU warm contexts + Tier 1/2 pre-edit cache
- `warm_context_status()` — inspect current state of all three contexts

### Five-Stage Synthesis Pipeline

`_parallel_two_stage_think` runs a five-stage pipeline for maximum quality:

```
Stage 1A (GPU0 extract)  ──┐
                            ├── parallel ──> Stage 1.5: Arbiter triage
Stage 1B (GPU1 analyze) ──┘
        │
        ├── ALIGNED  → proceed to Stage 2
        ├── MINOR    → inject advisory note, proceed to Stage 2
        └── COMPLEX  → Stage 1.75: GPU1 deep resolution → Stage 2

Stage 2 (GPU1 final synthesis)  →  result + pipeline trace
```

Every output from `_parallel_two_stage_think` ends with a pipeline trace line:
```
*pipeline: 1A:Xc → 1B:Xc → arbiter:SEVERITY → 2:Xc*
```
(where `Xc` = token count per stage)

Structured traces are logged to `log/synthesis-traces.jsonl` and arbiter decisions to `log/synthesis-arbiter.jsonl` for telemetry analysis.

**Arbiter escalation (Stage 1.75):** When arbiter detects COMPLEX conflicts (hallucinated module names, contradictory architectural claims, boundary violations), it escalates to GPU1 for authoritative reconciliation before Stage 2. The resolved brief replaces the conflicted input.

### Think Session Memory

HME maintains a rolling window of the last 3 think Q&A pairs within a session. These are injected as "Previous think exchanges this session" at the top of every subsequent `think` call — giving the reasoning model continuity across calls without bloating individual prompts.

- `store_think_history(about, answer)` — persists a Q&A pair (auto-called after each successful think)
- `get_think_history_context()` — returns formatted history block for injection
- Max 3 pairs (`_THINK_HISTORY_MAX=3`) — oldest pair drops when window is full
- History survives across tool calls within a session; resets on server restart

### Unified Session Narrative (4th Context Layer)

A running prose thread of what's happening this session — orthogonal to KB (static facts), warm KV context (static persona), and think history (narrow Q&A).

**What it provides:** session direction, key decisions, pipeline verdicts, arbiter resolutions — a coherent "what we're building and what was decided" context available to ALL models.

**Architecture:** NOT baked into warm KV cache (too dynamic). A live string prepended to every synthesis call's prompt. Updated automatically by:
- Every `evolve(focus='think')` call (via `store_think_history`)
- Every `learn(title=, content=)` add call (new calibration anchor logged)
- Every `_resolve_complex_conflict` call (COMPLEX arbiter resolution logged)

**Injection points:** Every `_local_think(system=_THINK_SYSTEM)` call (GPU0, GPU1) and every `_arbiter_check` prompt — so all three models share the same session thread.

**API:**
- `append_session_narrative(event, content)` — external callers (pipeline hooks, evolution tools) can push events
- `get_session_narrative(categories=['think','edit','search'])` — returns formatted narrative block, optionally filtered by category (commit/pipeline/think/search/edit/review/kb/other)
- Max 10 events (`_SESSION_NARRATIVE_MAX=10`); oldest drops when full
- `hme_admin(mode='selftest')` shows event count under "session narrative"

### Context-Budget Awareness

Composite tools auto-scale output via `/tmp/claude-context.json`:

| Context Remaining | Budget | KB Entries | Callers | Local model max_tokens |
|---|---|---|---|---|
| >75% | greedy | 10 | 20 | 4096 |
| 50-75% | moderate | 5 | 10 | 2048 |
| 25-50% | conservative | 3 | 6 | 1024 |
| <25% | minimal | 1 | 3 | 256 |

### Temporal Relevance Decay

KB entries < 1 day: 1.05x boost. > 7 days: gradual decay (0.7x at 37 days). Recent decisions stay prominent.

### Knowledge Relationships

`learn(title=, content=)` supports `related_to="<entry_id>"` with `relation_type`: `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`. Creates typed graph edges for `learn(action='graph')` traversal.

## HME Chat — Custom VS Code Chat Panel

A custom VS Code chat panel at `tools/HME/chat/` that surpasses Claude's built-in plugin by routing every message through the HME intelligence layer. Not a wrapper — a full orchestration hub.

### Architecture

```
tools/HME/chat/
  src/
    extension.ts          VS Code activation entrypoint (Ctrl+Shift+H)
    ChatPanel.ts          WebviewPanel with inline HTML/CSS/JS chat UI
    router.ts             Claude CLI, PTY, llama.cpp, Hybrid streaming + HME HTTP calls
    Arbiter.ts            Local qwen3:4b classifies message complexity for auto-routing
    TranscriptLogger.ts   Append-only JSONL session transcript (survives compaction)
    SessionStore.ts       Persistent session storage (~/.config/hme-chat/workspaces/)
    types.ts              Shared ChatMessage interface
  out/                    Compiled JS
  package.json            VS Code extension manifest
```

### Five Routes

| Route | Backend | HME Integration | Cost |
|-------|---------|----------------|------|
| **Auto** | Arbiter decides | Full: validation + enrichment + audit + transcript | Free classification, then Claude or Local |
| **Claude** | `claude` via PTY (hooks fire) | Hooks enforce constraints, PostToolUse logs to transcript | Subscription (Max/Pro) |
| **Local** | llama.cpp (qwen3-coder:30b) | Pre-send validation, post-response audit, transcript | Free |
| **Hybrid** | HME HTTP enrich → llama.cpp | KB + transcript context injected as system prompt | Free |
| _(fallback)_ | `claude -p` stream-json | No hooks, but pre/post validation still runs | Subscription |

### HME Integration Pipeline

Every message, regardless of route, passes through this pipeline:

```
User types message
    │
    ├─ POST /validate → KB anti-pattern check → ⛔ block or ⚠ warn notice
    │
    ├─ [Auto?] Arbiter (qwen3:4b) classifies → Claude or Local
    │
    ├─ TranscriptLogger.logUser() + POST /transcript (mirror to HTTP shim)
    │
    ├─ Dispatch to backend (PTY Claude / llama.cpp / Hybrid)
    │  └─ Tool calls logged to transcript in real-time
    │
    ├─ TranscriptLogger.logAssistant() + mirror to shim
    │
    ├─ Parse tool calls for file paths → POST /reindex (sub-second KB freshness)
    │
    ├─ POST /audit → git diff → KB constraint check → notice bar
    │
    ├─ Every 8 turns: qwen3:4b synthesizes narrative digest → POST /narrative
    │
    └─ Session saved to disk (messages + claudeSessionId + llamacppHistory)
```

### HME HTTP Shim

Standalone Python server that exposes the RAG engine over HTTP for the chat panel and hooks.

```bash
PROJECT_ROOT=/home/jah/Polychron python3 tools/HME/mcp/hme_http.py
# Listens on 127.0.0.1:7734
```

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Readiness + transcript count + KB status |
| `/enrich` | POST | KB hits + transcript context for message enrichment |
| `/enrich_prompt` | POST | Four-stage local prompt enrichment (arbiter triage → KB assembly → reasoning → compression) |
| `/validate` | POST | Pre-send anti-pattern/constraint check |
| `/audit` | POST | Post-response changed-file constraint audit |
| `/transcript` | GET | Read recent transcript entries (windowed) |
| `/transcript` | POST | Append entries to transcript |
| `/reindex` | POST | Immediate mini-reindex of specific files |
| `/narrative` | GET/POST | Read/store narrative digest |

### KB and Context Access

**Claude route** has full access: the PTY-spawned `claude` process connects to the MCP server (which holds the warm pre-edit cache, full KB, symbol index). Hooks from `hooks/hooks.json` fire — including the PostToolUse transcript logger.

**Local/Hybrid routes** access KB via the HTTP shim (`/enrich` pulls KB + transcript context). They do NOT have the warm pre-edit cache (that lives in the MCP server's memory). Transcript context partially compensates — recent tool calls and narrative digests provide session awareness.

**To maximize local route intelligence:**
1. Start the HTTP shim before opening the chat panel
2. KB search caches are pre-warmed automatically at server startup (no manual step needed)
3. Use Hybrid route — it injects KB context as a system prompt

### Session Persistence

Sessions stored at `~/.config/hme-chat/workspaces/{hash}/`:
- Auto-created on first message (title from first 60 chars)
- `claudeSessionId` persisted for `--resume` across VS Code restarts
- `llamacppHistory` persisted for local/hybrid conversation continuity
- Session sidebar: click to load, `+` for new, `×` to delete

### PostToolUse Transcript Hook

`tools/HME/hooks/log-tool-call.sh` — universal PostToolUse hook (matcher: `""`) that logs every tool call from the main Claude Code session to `log/session-transcript.jsonl` and mirrors to the HTTP shim. Also triggers `/reindex` for Edit/Write operations. **LIFESAVER**: reads the start timestamp written by `pretooluse_lifesaver.sh` and emits a stderr warning when any `mcp__HME__*` tool exceeds its expected duration (15s for most tools, 30s for `review`).

### Pipeline Error Scanning (LIFESAVER)

Three-layer defense against silent failures in non-fatal pipeline steps:

1. **Script-level**: Each pipeline script must exit non-zero when a critical subsystem fails (e.g., `snapshot-run.js` exits 1 if EnCodec analysis fails, even though the snapshot itself is saved). Errors must use `console.error()`, never `console.log()`.

2. **Pipeline-level**: `main-pipeline.js` captures stdout+stderr for all non-fatal steps and scans for error keywords: `Traceback`, `RuntimeError`, `CUDA error`, `OOM`, `MemoryError`, `FATAL`, `Segmentation fault`, `killed`. Detected errors are:
   - Printed immediately with `*** ERROR DETECTED ***` banner
   - Accumulated in `errorPatterns[]` array
   - Written to `metrics/pipeline-summary.json` under `errorPatterns` field
   - Displayed in the pipeline summary block

3. **Hook-level**: `posttooluse_bash.sh` fires after `npm run main` completes. Reads `pipeline-summary.json`, checks `errorPatterns` and failed steps. If any exist, emits a loud `!!!` banner to stderr forcing Claude to acknowledge and address the failures before proceeding.

**Scope clarification**: The LIFESAVER system has two distinct functions:
- **Tool timing** (pretooluse_lifesaver.sh + log-tool-call.sh): monitors MCP tool call durations for stuck synthesis
- **Pipeline error scanning** (main-pipeline.js + posttooluse_bash.sh): catches real failures hidden behind exit-0 non-fatal steps

Both are critical. A `(non-fatal)` pipeline step that exits 0 is NOT the same as "no errors occurred" — the error scanning layer ensures real failures (CUDA OOM, Python tracebacks, segfaults) are never silently swallowed.

### Installation

```bash
cd tools/HME/chat && npm install && npm run compile
ln -s /home/jah/Polychron/tools/HME/chat ~/.vscode/extensions/hme-chat
# Reload VS Code, then Ctrl+Shift+H to open
# Start the HTTP shim for hybrid/local KB enrichment:
PROJECT_ROOT=/home/jah/Polychron python3 tools/HME/mcp/hme_http.py &
```

## Maintenance

### Reindex
File watcher auto-reindexes on save (5s debounce, 5min cooldown). For batch changes:
```
hme_admin(action='index')    # incremental reindex
hme_admin(action='clear_index')  # full rebuild from scratch
```

### KB Maintenance
- Periodic: `learn(action='health')` — find stale refs, wrong line counts
- After 30+ entries: `learn(action='compact')` — deduplicate
- Backup: `learn(action='export')` — dump all entries as markdown
- Discovery: `learn(action='dream')` — find hidden connections

### Doc Sync
`review(mode='docs')` verifies docs match implementation.

### HME Self-Maintenance
When tools feel wrong (missing context, stale results, slow synthesis):
1. `hme_admin(action='selftest')` — selftest + introspection
2. `learn(action='health')` — find stale or conflicting KB entries
3. `learn(action='compact')` — deduplicate
4. `review(mode='docs')` — verify docs match reality
5. `hme_admin(action='reload', modules='all')` — hot-reload all tool modules
6. Check hooks in `tools/HME/hooks/hooks.json` — are they triggering?
