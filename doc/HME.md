# Hypermeta Ecstasy

> Master executive for hypermeta evolutionary intelligence. The cognitive substrate that makes self-evolving composition possible — not a code search tool but an evolutionary nervous system. Continually evolving to remove the ceiling on coherence through intelligently managed context-efficiency.

HME is five layers integrated into one executive. **11 MCP tools** (7 mega-tools + 4 operational) provide the entire interface — every sub-capability routes through them. CLAUDE.md encodes rules and boundaries. Skills load cognitive frameworks per session. Hooks enforce workflow automatically. The Evolver and lab run the evolution loop.

No layer is optional. Removing any one collapses the executive.

## The Five Layers

| Layer | Location | What It Does |
|-------|----------|-------------|
| **MCP Server** | `tools/HME/` | 11 tools: 7 mega-tools (evolve/find/review/read/learn/status/trace) + 4 operational (hme_admin/beat_snapshot/warm_pre_edit_cache/fix_antipattern) |
| **CLAUDE.md** | `CLAUDE.md` | Rules, boundaries, mandatory workflow, hard constraints |
| **Skills** | `~/.claude/skills/HME/` | Cognitive frameworks loaded per session via `/HME` |
| **Hooks** | `hooks/` (6 scripts, referenced from `.claude/settings.json`) | Automated workflow enforcement (pre/post tool use) |
| **Evolver + Lab** | `.github/agents/Evolver.agent.md` + `lab/` | 7-phase evolution loop + experimental harness |

## Self-Evolution

HME evolves alongside Polychron. Every confirmed evolution round feeds back into HME's own intelligence:

```
Observe (tools surface patterns)
    -> Diagnose (KB constrains interpretation)
        -> Evolve (code changes + new KB entries)
            -> Persist (add_knowledge, compact_knowledge, doc updates)
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
      tools_analysis/                   All 11 registered tools live here:
        evolution_evolve.py               evolve — evolution planning hub
        search_unified.py                 find — universal search + analysis
        review_unified.py                 review — post-pipeline review hub
        read_unified.py                   read — smart code reader
        learn_unified.py                  learn — unified KB interface
        status_unified.py                 status — system health hub
        trace_unified.py                  trace — signal flow tracing
        evolution_admin.py                hme_admin + fix_antipattern
        runtime.py                        beat_snapshot
        workflow.py                       warm_pre_edit_cache + before_editing
        (+ 20 internal modules: coupling, reasoning, symbols, etc.)
      tools_search.py                   Internal: grep, search_code, find_callers, file_lines
      tools_knowledge.py                Internal: add/search/list/compact/export/graph/dream/health
      tools_index.py                    Internal: index_codebase, clear_index
    rag_engine/                         LanceDB + BM25 + RRF fusion + cross-encoder reranking
    watcher.py                          Auto-reindex on file changes (5s debounce, 5min cooldown)
    chunker.py, lang_registry.py        IIFE-aware code chunking
  skills/                               Skill definitions (symlinked from ~/.claude/skills/)
  config/
    project-rules.json                  Declarative project rules (boundary violations,
                                          L0 channels, registration patterns, etc.)
  hooks/                                Hook scripts (14 hooks across 7 lifecycle events)
  Evolver.agent.md                      -> .github/agents/Evolver.agent.md (symlink)
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
  knowledge.lance/       KB (68 entries with prediction error gating, FSRS-6 spaced repetition)
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
| **1. Perceive** | Surface patterns from metrics, KB context on changed files | `status()`, `learn(query='...')` |
| **2. Diagnose** | Trace causal chains with KB constraints, find anti-patterns | `find(query, mode='callers'/'boundary'/'think'/'diagnose')` |
| **3. Evolve** | Pre-edit briefing, constraint checking, boundary enforcement | `read(target, mode='before')`, `learn(query='module')` |
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
4. If confirmed: extract to `/src`, `add_knowledge` for the finding
5. If refuted: `add_knowledge category="pattern"` to prevent re-attempting

## Mandatory Workflow

### Before Editing Code

**`read("moduleName", mode="before")`** — ONE CALL gets everything: KB constraints, callers, boundary warnings, file structure, evolutionary potential. Accepts module names OR file paths — auto-resolves `crossLayerSilhouette` → `src/crossLayer/structure/form/crossLayerSilhouette.js`.

### After Code Changes

1. **`review(mode='forget')`** — auto-detects changed files from git. Checks against KB constraints, boundary rules, L0 channels, doc needs. Optionally pass `changed_files='file1.js,file2.js'` to override.
2. File watcher auto-reindexes on save (5s debounce, 5min cooldown between full reindexes)
3. For batch changes: `hme_admin(action='index')` once at the end

### After Confirmed Round

1. `learn(title='...', content='...', category='pattern')` for calibration anchors, decisions, anti-patterns
2. Use `related_to="<entry_id>"` with `relation_type` to link related entries
3. Update docs: CLAUDE.md, relevant doc/*.md files

### For Any Search

Use `find(query)` — NOT Grep. Auto-routes by intent: "callers of X" → call graph, regex → grep, natural language → semantic search. All searches add KB cross-referencing that Grep misses.

### When Pipeline Fails

`find("paste error text", mode="diagnose")` — traces source, finds similar KB bugs, suggests fix patterns.

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
| Is the pipeline OK? | `status()` or `status(mode='pipeline')` |
| Post-pipeline review | `review()` or `review(mode='full')` |
| Trace a signal through the system | `trace("emergentRhythm")` |
| Search the KB | `learn(query='coupling constraints')` |
| Add a KB entry | `learn(title='...', content='...', category='pattern')` |
| Search 2-3 specific files | Read tool (not HME — overkill) |

## The 11 Tools — Complete Reference

All capabilities route through 7 mega-tools + 4 operational tools. There are no other registered MCP tools. Internal functions (search_code, find_callers, module_intel, etc.) are called by these tools — never directly.

### 1. `evolve(focus)` — "What should I work on next?"

| focus | What it does |
|-------|-------------|
| `"all"` (default) | LOC offenders + coupling gaps + pipeline suggestions + synthesis |
| `"loc"` | Top oversized files in src/ |
| `"coupling"` | Dimension gaps + antagonism leverage points |
| `"pipeline"` | Pipeline-based evolution suggestions |
| `"patterns"` | Meta-patterns across journal rounds: confirm rates, subsystem receptivity |
| `"seed"` | Auto-generate starter KB entries for high-dependency modules with zero coverage |

### 2. `find(query, path, mode)` — Universal search + analysis

| mode | What it does |
|------|-------------|
| `"auto"` (default) | Detects intent: "callers of X" → callers, regex → grep, "X should use Y" → boundary, else → semantic |
| `"semantic"` | Natural language code search with KB enrichment |
| `"grep"` | Regex search (replaces Bash grep — adds KB cross-references) |
| `"callers"` | All call sites of a symbol (supports path filtering) |
| `"boundary"` | Find anti-pattern / boundary violations |
| `"think"` | Deep structured reasoning about a question |
| `"diagnose"` | Diagnose error text — traces source, finds similar KB bugs |
| `"blast"` | Transitive dependency chain (depth 1-3) for a symbol |
| `"coupling"` | Coupling intelligence (query=sub-mode: full/network/antagonists/gaps/leverage/channels/cascade:X/ledger/clusters) |
| `"symbols"` | Semantic symbol search (when you know purpose, not name) |
| `"lookup"` | Exact symbol lookup (where defined) |
| `"map"` | Module directory map with line counts (query=directory) |
| `"hierarchy"` | Type/class hierarchy |
| `"rename"` | Bulk rename preview (query='oldName→newName') |
| `"xref"` | Cross-language trace for a symbol |

### 3. `review(mode, ...)` — Post-pipeline review hub

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

### 4. `read(target, mode)` — Smart code reader

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

### 5. `learn(...)` — Unified KB interface

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

### 6. `status(mode)` — System health hub

| mode | What it does |
|------|-------------|
| `"all"` (default) | Pipeline status + selftest + auto-warm stale GPU contexts |
| `"pipeline"` | Pipeline status only |
| `"health"` | Codebase health sweep |
| `"coupling"` | Full coupling topology + antagonist tensions + dimension gaps |
| `"trust"` | Trust ecology leaderboard (all 27 systems) |
| `"perceptual"` | Perceptual stack analysis (EnCodec + CLAP) |
| `"hme"` | HME selftest (tool count, doc sync, index, Ollama, KB, symlinks) |
| `"introspect"` | Session introspection (tool usage patterns, musical context, journal, KB breakdown) |

### 7. `trace(target, mode, section, limit)` — Signal flow tracing

| mode | What it does |
|------|-------------|
| `"auto"` (default) | Detects: L0 channel name → cascade, module name → per-section trace |
| `"cascade"` | L0 channel cascade trace, 3 hops deep |
| `"module"` | Per-section trace: regime, tension, trust scores, value ranges |
| `"causal"` | Causal trace: constant → controller → metric → musical effect |
| `"interaction"` | Correlate two modules' trust scores: cooperative/competitive/independent |

### 8. `hme_admin(action, modules)` — HME maintenance

| action | What it does |
|--------|-------------|
| `"selftest"` (default) | Verify tool registration, doc sync, index, Ollama, KB, symlinks |
| `"reload"` | Hot-reload tool modules (modules='module1,module2' or 'all') |
| `"both"` | Reload then selftest |
| `"index"` | Reindex all code chunks + symbols |
| `"clear_index"` | Wipe hash cache + chunk store, rebuild from scratch |
| `"warm"` | Pre-populate all caches: Tier 1 callers+KB, Tier 2 synthesis, GPU KV contexts |
| `"introspect"` | Self-benchmarking: tool usage patterns, workflow discipline, KB health |

### 9. `beat_snapshot(beat_key)` — Single beat state capture

Returns full system state at one beat: regime, trust ecology, conductor snap, coupling labels, notes emitted. Use for deep-diving a specific moment.

### 10. `warm_pre_edit_cache(max_files, synthesis_hot)` — Cache warming

Two-tier warming: Tier 1 scans up to `max_files` src/ files for callers+KB (fast). Tier 2 synthesizes edit risks for top `synthesis_hot` recently modified files (slow, uses Ollama). After warming, `read(target, mode='before')` is instant for warmed files.

### 11. `fix_antipattern(antipattern, hook_target)` — Hook enforcement

Synthesizes bash detection logic for a behavioral anti-pattern and appends it to the target hook script. Use when a rule is repeatedly violated and needs automated enforcement. Valid targets: `pretooluse_bash`, `posttooluse_bash`, `stop`, `userpromptsubmit`, `pretooluse_edit`, `pretooluse_grep`, `pretooluse_write`.

## Knowledge KB

68 entries across 4 categories. FSRS-6 spaced repetition: frequently retrieved entries resist temporal decay.

| Category | Count | What to Store | Example |
|----------|-------|--------------|---------|
| `architecture` | 27 | Boundary rules, module profiles, system topology | "feedbackOscillator — 198 lines, highest hotspot rate 31.7%" |
| `decision` | 17 | Calibration anchors, threshold choices, confirmed rounds | "R80 LEGENDARY: complexity triple-bridge" |
| `pattern` | 15 | Anti-patterns, proven patterns, evolution recipes | "antagonism bridge: couple BOTH sides of antagonist pair" |
| `bugfix` | 9 | Root causes, fixes, prevention rules | "perceptual OOM: force CPU when Ollama warm contexts resident" |

## Hooks Integration

All hooks live in `tools/HME/hooks/` as standalone scripts, referenced from `.claude/settings.json`. This keeps hook logic version-controlled, testable, and visible from the HME directory.

### Hook Scripts (14 hooks across 7 lifecycle events)

All hooks share `_tab_helpers.sh` for deduped tab operations (`_append_file_to_tab`, `_extract_bg_output_path`).

| Script | Event | Matcher | What It Does |
|--------|-------|---------|-------------|
| `sessionstart.sh` | SessionStart | * | Reset compact tab, inject HME awareness, persist `$HME_ACTIVE` env var |
| `pretooluse_edit.sh` | PreToolUse | Edit | Remind: `before_editing` or `search_knowledge` for src/ files |
| `pretooluse_grep.sh` | PreToolUse | Grep | Soft warn: prefer HME `grep()` for KB enrichment |
| `pretooluse_write.sh` | PreToolUse | Write | Lab rules for `sketches.js`: audible postBoot, no empty sketches |
| `pretooluse_bash.sh` | PreToolUse | Bash | Block `rm run.lock` + suggest HME `file_lines`/`count_lines` |
| `posttooluse_bash.sh` | PostToolUse | Bash | Track background output files to tab + Evolver phase triggers |
| `posttooluse_pipeline_kb.sh` | PostToolUse | Bash | Append `KB:` trace summary to tab after `npm run main` |
| `posttooluse_write.sh` | PostToolUse | Write | Track `.md`/`.txt` note files (outside `tmp/`) to tab |
| `posttooluse_agent.sh` | PostToolUse | Agent | Track subagent background output files to tab |
| `posttooluse_addknowledge.sh` | PostToolUse | add_knowledge | Clear `KB:` entries from tab after save |
| `userpromptsubmit.sh` | UserPromptSubmit | * | Inject Evolver context on evolution-related prompts |
| `precompact.sh` | PreCompact | * | Surface `KB:`/`FILE:` entries from tab + untracked `tmp/` files |
| `postcompact.sh` | PostCompact | * | Re-surface the same tab state after compaction |
| `stop.sh` | Stop | * | Verify all work is implemented in code, not just documented |

### Plugin-Ready

`hooks/hooks.json` defines hooks in Claude Code plugin format using `${CLAUDE_PLUGIN_ROOT}`. When Claude Code supports project-level plugin auto-discovery, HME hooks will load automatically. Until then, `.claude/settings.json` calls the scripts directly.

### Adding a New Hook

1. Create `tools/HME/hooks/your_hook.sh` (read JSON from stdin, write to stderr for messages, exit 0 for allow / exit 2 for block)
2. Add entry to `.claude/settings.json` hooks section
3. Add entry to `hooks/hooks.json` (plugin format)
4. Document in this table

## Polychron-Specific Features

### IIFE-Aware Chunking

Polychron's primary module pattern: `globalName = (() => { function tick() {...} })()` (473 files). The chunker creates named function chunks per IIFE.

### Embedding Model

`BAAI/bge-base-en-v1.5` (768-dim, 110M params). 3x better code similarity than previous mpnet model. Cross-encoder reranking via `cross-encoder/ms-marco-MiniLM-L-6-v2`. Configurable via `RAG_MODEL` env var.

### Symbol Indexing

321 IIFE globals + 1914 inner functions = 3848+ total symbols. `lookup_symbol` and `find_callers` work with Polychron's global-assignment pattern.

### Three-Model Ollama Fleet

HME runs a three-model local synthesis fleet. No external API. All synthesis is local on two dedicated GPUs + CPU RAM.

**GPU0 — Extractor** (`qwen3-coder:30b`, 18.6GB VRAM, `/api/generate`):
- Specialized persona: "expert code extractor — facts, file paths, module names, no speculation"
- Runs Stage 1A in parallel two-stage synthesis
- Default model for `_local_think`, `before_editing` edit risks, `blast_radius`, `codebase_health`, `knowledge_graph`, `memory_dream`
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
- Warm context is embedded in the PROMPT field (not `system=`), so Ollama's KV cache captures it
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
- Every `think` call (via `store_think_history`)
- Every `add_knowledge` call (new calibration anchor logged)
- Every `_resolve_complex_conflict` call (COMPLEX arbiter resolution logged)

**Injection points:** Every `_local_think(system=_THINK_SYSTEM)` call (GPU0, GPU1) and every `_arbiter_check` prompt — so all three models share the same session thread.

**API:**
- `append_session_narrative(event, content)` — external callers (pipeline hooks, evolution tools) can push events
- `get_session_narrative()` — returns formatted narrative block for injection anywhere
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

`add_knowledge` supports `related_to="<entry_id>"` with `relation_type`: `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`. Creates typed graph edges for `knowledge_graph()` traversal.

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
1. `status(mode='hme')` — selftest + introspection
2. `learn(action='health')` — find stale or conflicting KB entries
3. `learn(action='compact')` — deduplicate
4. `review(mode='docs')` — verify docs match reality
5. `hme_admin(action='reload', modules='all')` — hot-reload all tool modules
6. Check hooks in `.claude/settings.json` — are they triggering?
