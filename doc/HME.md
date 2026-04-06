# Hypermeta Ecstasy

> Master executive for hypermeta evolutionary intelligence. Not a code search tool — the cognitive substrate that makes self-evolving composition possible. Agents are encouraged to continually evolve HME to always be a tool that is not just exciting to use, but ecstatic to even think about, removing the ceiling on coherence, through intelligently managed context-efficiency!

HME is the integration of five layers that together form Polychron's evolutionary nervous system. The MCP server provides 50+ intelligence tools. CLAUDE.md encodes the rules and boundaries. Skills load cognitive frameworks per session. Hooks enforce intelligent workflow automatically. The Evolver and lab run the evolution loop that grows both Polychron and HME itself.

No layer is optional. Removing any one collapses the executive.

## The Five Layers

| Layer | Location | What It Does |
|-------|----------|-------------|
| **MCP Server** | `tools/HME/` | 50+ tools: semantic search, KB, architectural analysis, Claude synthesis |
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
- After a confirmed round, `add_knowledge` persists calibration anchors, decisions, anti-patterns — the KB grows with each cycle
- `compact_knowledge` periodically deduplicates, keeping the KB sharp
- `memory_dream` discovers hidden connections between distant entries
- `doc_sync_check` verifies docs match implementation — when they diverge, docs get updated
- `kb_health` finds stale references, aged entries, dead file pointers
- Hooks can be extended when new anti-patterns emerge from KB patterns
- Skills grow new pages as new cognitive frameworks are discovered
- The Evolver's own phases can be refined based on KB entries about what works

**The ecstatic principle:** Intelligence that makes working with it genuinely pleasurable. Every tool should feel like it reads your mind. Every constraint should prevent a mistake you'd regret. Every hook should arrive at exactly the right moment. When the system achieves this, using it is not just productive — it's ecstatic.

## Installation Topology

### Unified Directory
```
tools/HME/               The single source of truth
  .claude-plugin/
    plugin.json                         Plugin metadata (name, version, description)
  mcp/                                  Python MCP server (symlinked from ~/.claude/mcp/)
    server/
      main.py                           FastMCP entry point (50+ tools)
      tools_analysis.py                 Architectural reasoning + Claude synthesis (20 tools)
      tools_search.py                   Search, grep, file, context assembly (6 tools)
      tools_knowledge.py                KB CRUD + memory_dream + knowledge_graph (9 tools)
      tools_index.py                    Index management + recent_changes (5 tools)
      context.py                        Shared engine references
      helpers.py                        Budget limits, formatters; loads project-rules.json
    rag_engine/                         LanceDB + BM25 + RRF fusion
    chunker.py, symbols.py, etc.        IIFE-aware indexing
  skills/                               Skill definitions (symlinked from ~/.claude/skills/)
    SKILL.md                            Master skill index
    analysis.md, search.md, etc.        Tool reference pages
    evolution.md                        Evolver integration guide
  config/
    project-rules.json                  Project-specific declarations (not logic):
                                          crosslayer_boundary_violations, known_l0_channels,
                                          dry_patterns, doc_update_triggers,
                                          known_non_tool_identifiers (incl. relation_type
                                          enum values + KB categories),
                                          registration_patterns,
                                          coupling_matrix_exempt_paths,
                                          coupling_matrix_legacy_paths,
                                          subsystem_names,
                                          line_count_thresholds
                                        Logic stays in Python; only DATA lives here.
                                        Loaded at MCP server import time by helpers.py.
  hooks/                                Hook scripts (referenced from .claude/settings.json)
    hooks.json                          Plugin-format hook definitions
    pretooluse_edit.sh                  before_editing reminder for src/ files
    pretooluse_grep.sh                  Prefer HME grep() over built-in
    pretooluse_write.sh                 Lab rules for sketches.js
    pretooluse_bash.sh                  Block run.lock deletion + suggest HME tools
    posttooluse_bash.sh                 Evolver phase triggers after pipeline/snapshot/lab
    stop.sh                             Verify completeness; drive autonomous Evolver loop
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
  code_chunks.lance/     Semantic code chunks (~3000 from 610 files)
  knowledge.lance/       KB (20+ entries with prediction error gating)
  symbols.lance/         Symbol index (3848+ symbols)
  file_hashes.json       Content hash cache for incremental reindex
  global_kb/             Cross-project shared KB
```

### MCP Registration (`.mcp.json`)
```json
{
  "mcpServers": {
    "HME": {
      "command": "python3",
      "args": ["tools/HME/mcp/server/main.py"],
      "env": {
        "PROJECT_ROOT": "/home/jah/Polychron",
        "RAG_DB_PATH": "/home/jah/Polychron/.claude/mcp/HME"
      }
    }
  }
}
```

## Setup

Source tracked in `tools/HME/`. MCP server at `mcp/`, symlinked from `~/.claude/mcp/`. Skills at `skills/`, symlinked from `~/.claude/skills/`. Run `scripts/setup-mcp.sh` after cloning to create symlinks. Load the skill before first use: `/HME`

## Evolver Integration

HME is the cognitive backbone of every Evolver phase. The Evolver doesn't just *use* HME tools — it *thinks through* HME.

| Phase | HME Role | Key Tools |
|-------|----------|-----------|
| **1. Perceive** | Surface patterns from metrics, KB context on changed files | `recent_changes`, `search_knowledge`, `knowledge_graph` |
| **2. Diagnose** | Trace causal chains with KB constraints, find anti-patterns | `search_code`, `find_callers`, `find_anti_pattern`, `think` |
| **3. Evolve** | Pre-edit briefing, constraint checking, boundary enforcement | `before_editing`, `search_knowledge`, `module_intel` |
| **4. Run** | Pipeline executes; file watcher auto-reindexes | (automatic) |
| **5. Verify** | Post-change audit, missed constraint detection | `what_did_i_forget`, `convention_check`, `codebase_health` |
| **6. Journal** | Persist findings as KB entries, link related knowledge | `add_knowledge`, `knowledge_graph`, `compact_knowledge` |
| **7. Maintain** | Reindex, KB health check, doc sync | `hme_admin(action='index')`, `kb_health`, `doc_sync_check` |

**After every confirmed round:**
1. `hme_admin(action='index')` — refresh embeddings for changed files
2. `add_knowledge` — persist calibration anchors, decisions, anti-patterns
3. `compact_knowledge` — if KB > 30 entries, deduplicate
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

**`before_editing "path/to/file.js"`** — ONE CALL gets everything: KB constraints, callers, boundary warnings, file structure. Replaces multi-step research.

### After Code Changes

1. **`what_did_i_forget "file1.js,file2.js"`** — checks against KB constraints, boundary rules, L0 channels, doc needs
2. File watcher auto-reindexes on save (5s debounce)
3. For batch changes: `hme_admin(action='index')` once at the end

### After Confirmed Round

1. `add_knowledge` for new calibration anchors, decisions, anti-patterns, bugfixes
2. Use `related_to="<entry_id>"` to link related entries
3. Update docs: CLAUDE.md, relevant doc/*.md files

### For Any Search

Use `search_code`, `find_callers`, or `find_anti_pattern` — NOT Grep. HME tools add KB cross-referencing that Grep misses.

### When Pipeline Fails

`diagnose_error "paste error text"` — traces source, finds similar KB bugs, suggests fix patterns.

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

| I want to... | Use | NOT |
|---|---|---|
| Find code by intent ("where does convergence happen") | `search_code` (`response_format="concise"` saves tokens) | Grep |
| Find all callers of a function | `find_callers` | Grep |
| Find callers in a specific directory | `find_callers path="src/crossLayer"` | Grep + manual filtering |
| Find boundary violations | `find_anti_pattern` or `find_callers exclude_path=` | Multi-step Grep |
| Check if a change is safe | `module_intel "symbolName" mode="impact"` | Reading code manually |
| Audit a file for convention issues | `convention_check "path/to/file.js"` | Manual review |
| Check constraints before editing | `before_editing "path"` or `search_knowledge "module"` | Hoping you remember |
| Get optimal code within token budget | `get_context "query" max_tokens=4000` | Reading files manually |
| Find exact variable name | `grep "varName" regex=True` | Built-in Grep |
| Search 2-3 specific files | Read tool | `search_code` (overkill) |
| Check KB for stale entries | `kb_health` | Manual review |
| Understand a module deeply | `module_intel "moduleName"` | Multi-file reading |
| Preview rename impact | `bulk_rename_preview "old" "new"` | Manual grep |

## Tool Reference (50+ tools)

### Shell Replacements (use INSTEAD of Bash)

| Tool | Replaces | Intelligence Added |
|------|----------|--------------------|
| `grep` | Bash `grep -rn` | KB cross-reference, boundary warnings |
| `file_lines` | Bash `cat`, `head`, `tail` | KB context for the module |
| `count_lines` | Bash `wc -l` | Convention warnings (oversize flags) |
| `recent_changes` | `git diff --name-only` | KB context per changed file |

### Architectural Reasoning (10 tools)

| Tool | Use For |
|------|---------|
| `before_editing` | **START HERE.** Pre-edit briefing: KB + callers + boundaries + structure |
| `what_did_i_forget` | Post-change audit: missed constraints, boundaries, doc needs |
| `module_intel(target, mode)` | mode='story': living biography (definition, evolution, callers, neighbors). mode='impact': callers + KB constraints. mode='both': biography + blast radius. |
| `diagnose_error` | Error source + similar bugs + fix patterns |
| `codebase_health` | Full-repo convention sweep, prioritized by severity |
| `think` | Structured reflection (`completeness`, `constraints`, `impact`, `conventions`, `recent_changes`) |
| `blast_radius` | Transitive dependency chain (depth 1-3) |
| `knowledge_graph` | KB search with spreading activation + Claude cluster analysis |
| `convention_check` | Audit file against conventions |
| `find_anti_pattern` | Find boundary violations |

### Search & Discovery (7 tools)

| Tool | Use For |
|------|---------|
| `search_code` | Natural language semantic code search |
| `find_callers` | All call sites (supports path/exclude_path filtering) |
| `find_similar_code` | Pattern matching by code snippet |
| `lookup_symbol` | Find where a symbol is defined |
| `search_symbols` | Semantic symbol search (when you know purpose, not name) |
| `file_intel(path, mode)` | mode='both' (default): structure + dependency graph. mode='summary': symbols/functions/globals. mode='deps': import/require graph. |
| `get_module_map` | Directory tree with line counts |
| `get_function_body` | Extract exact function source |

### Structure & Navigation (4 tools)

| Tool | Use For |
|------|---------|
| `cross_language_trace` | All references across file types |
| `type_hierarchy` | Interface/class hierarchy |
| `bulk_rename_preview` | Preview rename impact |
| `doc_sync_check` | Verify doc matches implementation |

### Knowledge Management (9 tools)

| Tool | Use For |
|------|---------|
| `search_knowledge` | Query persistent KB |
| `add_knowledge` | Persist decision/anchor/pattern/bugfix |
| `list_knowledge` | Show all KB entries (filter by category) |
| `remove_knowledge` | Delete stale entry |
| `compact_knowledge` | Deduplicate similar entries |
| `export_knowledge` | Export KB as markdown |
| `knowledge_graph` | Search with spreading activation + connections |
| `memory_dream` | Discover hidden KB connections via pairwise similarity |
| `kb_health` | Check for stale refs and aged entries |

### Evolution & Causal Intelligence (6 tools)

| Tool | Use For |
|------|---------|
| `evolution_patterns` | Meta-patterns across journal rounds: confirm rates, subsystem receptivity, stabilization timelines |
| `causal_trace` | Trace constant -> controller -> metric -> musical effect chain |
| `hme_inspect(mode)` | mode='introspect': usage patterns, system health, musical context. mode='selftest': 8-point health check. mode='both' (default). |
| `fix_antipattern(antipattern, hook_target)` | Permanently enforce a rule by synthesizing bash detection logic and appending it to the target hook script. Use when a behavioral rule is repeatedly violated and needs hook-level enforcement. |
| `trace_query` | Query trace.jsonl for what a module ACTUALLY DID: trust scores, regime transitions, value ranges |
| `interaction_map` | Correlate two modules' trust scores and hotspot co-occurrence: cooperative/competitive/independent |
| `kb_seed` | Auto-generate starter KB entries for top-N highest-dependency modules with zero KB coverage |

### Coupling Intelligence (1 tool)

| Tool | Use For |
|------|---------|
| `coupling_intel(mode)` | mode='full' (default): all four views — topology + antagonist tensions + cluster biographies + dimension gaps. Use before planning a coupling round. mode='network': melodic/rhythmic topology, uncoupled modules by trust. mode='antagonists': negative correlation pairs (creative tensions). mode='personalities': cluster biographies (members, dims, bonds, antagonists). mode='gaps': underused melodic/rhythmic dims sorted by coverage. |

### Runtime Intelligence (7 tools)

| Tool | Use For |
|------|---------|
| `pipeline_digest` | **ONE-CALL post-pipeline summary**: arc + hotspots + drama + regime health |
| `composition_events(mode)` | mode='arc': per-section biography (regime, tension, trust, coupling). mode='drama': top-N dramatic moments. mode='both' (default). |
| `regime_report(mode)` | mode='timeline': ASCII regime visualization. mode='anomaly': regime health. mode='both' (default). |
| `hotspot_leaderboard` | Rank trust systems by hotspot frequency and pressure |
| `trust_report(system_a, system_b)` | system_b empty: career arc with sparklines. system_b provided: head-to-head rivalry with overtakes. |
| `section_compare` | Two sections side-by-side: tension delta, trust winners/losers |
| `beat_snapshot` | Full system state at one beat: trust ecology, snap, coupling, notes |

### Analysis (2 tools)

| Tool | Use For |
|------|---------|
| `symbol_audit(mode)` | mode='dead': IIFE globals with 0 callers. mode='importance': rank by caller count. mode='both' (default). |
| `list_libs` | Show indexed library directories |

### Perceptual Intelligence (1 tool)

| Tool | Use For |
|------|---------|
| `audio_analyze(analysis, queries)` | analysis='encodec': per-section token entropy (complexity), codebook activation. analysis='clap': text↔audio similarity with natural language queries. analysis='both' (default). EnCodec 24kHz + CLAP HTSAT-tiny on GPU. |

Starts at **15% confidence** — verify against listening before trusting. Confidence earns trust through verdict correlation, like any trust system.

### Index Management (3 tools)

| Tool | Use For |
|------|---------|
| `hme_admin(action='index')` | Reindex all code chunks + symbols. Use after batch changes when file watcher hasn't caught up. |
| `get_index_status` | Check index health |
| `clear_index` | Wipe index for full rebuild |

## Knowledge KB Categories

| Category | What to Store | Example |
|----------|--------------|---------|
| `architecture` | Boundary rules, system topology, L0 channels | "conductor cannot write to crossLayer" |
| `decision` | Calibration anchors, threshold choices, constraints | "coherent safety floor: 0.88 minimum" |
| `pattern` | Anti-patterns, proven patterns, regime alignment | "compound suppression anti-pattern" |
| `bugfix` | Root causes, fixes, prevention rules | "L0 channel persistence caveat" |

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

### Tiered Model Architecture

HME routes synthesis to the right model for each task — Claude for high-value architectural insight, local models for mechanical analysis:

**Claude API** (when `ANTHROPIC_API_KEY` is set):
- `before_editing`, `what_did_i_forget`, `module_intel`, `diagnose_error`, `causal_trace`, `think` — these need deep architectural reasoning
- Adaptive thinking, prompt caching (system 5-min, KB corpus 1-hour), agentic tool use

**Local model** (Ollama, configurable via `HME_LOCAL_MODEL`):
- `evolution_patterns`, `codebase_health`, `blast_radius`, `knowledge_graph`, `memory_dream` — mechanical analysis that doesn't need Claude tokens
- Falls back to Claude if Ollama unavailable, falls back to no synthesis if neither available
- Default model: `qwen2.5-coder:7b` at `http://localhost:11434/api/generate`

**No model needed:**
- All hooks (pure bash), all search/grep/index operations, `hme_inspect(mode='introspect')`, `doc_sync_check`

**Configuration** (in `.mcp.json` env):
```
HME_LOCAL_MODEL=qwen2.5-coder:7b     # Ollama model name
HME_LOCAL_URL=http://localhost:11434/api/generate  # Ollama endpoint
```

### Context-Budget Awareness

Composite tools auto-scale output via `/tmp/claude-context.json`:

| Context Remaining | Budget | KB Entries | Callers | Claude max_tokens | Claude effort |
|---|---|---|---|---|---|
| >75% | greedy | 10 | 20 | 4096 | high (think: max) |
| 50-75% | moderate | 5 | 10 | 2048 | medium (think: high) |
| 25-50% | conservative | 3 | 6 | 1024 | low (think: medium) |
| <25% | minimal | 1 | 3 | 256 | low |

### Temporal Relevance Decay

KB entries < 1 day: 1.05x boost. > 7 days: gradual decay (0.7x at 37 days). Recent decisions stay prominent.

### Knowledge Relationships

`add_knowledge` supports `related_to="<entry_id>"` with `relation_type`: `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`. Creates typed graph edges for `knowledge_graph()` traversal.

## Maintenance

### Reindex After Code Changes
```
reindex
```

### Full Rebuild
```
clear_index
reindex
```

### KB Maintenance
- After 30+ entries: `compact_knowledge threshold=0.85`
- Periodic: `kb_health` to find stale refs
- Backup: `export_knowledge` outputs all entries as markdown

### Doc Sync
`doc_sync_check "doc/HME.md"` verifies tool counts, file references, and section completeness.

### HME Self-Maintenance
When HME tools feel wrong (missing context, stale results, slow synthesis):
1. `get_index_status` — verify chunk/symbol counts
2. `kb_health` — find stale or conflicting entries
3. `compact_knowledge` — deduplicate
4. `doc_sync_check` — verify this doc matches reality
5. Check hooks in `~/.claude/settings.json` — are they triggering correctly?
6. Check skill files — do they reflect current tool signatures?
