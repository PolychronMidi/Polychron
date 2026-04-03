# code-docs-rag: Setup, Usage, and Maintenance Guide

> Local semantic code + documentation RAG system for Polychron. 41 MCP tools across 3 intelligence layers: reactive search, architectural analysis, and collaborative reasoning. All search and file operations route through code-docs-rag for consistent KB enrichment.

## Full Installation Topology

### Server Source (Python)
```
~/.claude/mcp/code-docs-rag/
  server.py              FastMCP server (41 tools, name="code-docs-rag")
  rag_engine.py          LanceDB vector store + BM25 + cross-encoder reranking + prediction error gating
  chunker.py             IIFE-aware JS chunker + line fallback (tree-sitter not installed)
  symbols.py             Symbol index: TS_PATTERNS + JS_IIFE_PATTERNS (globals + inner functions)
  analysis.py            Dependency graph, similar code, cross-language trace
  structure.py           File summary, module map
  watcher.py             5s debounce file watcher for auto-reindex
  lang_registry.py       30+ language support
  file_walker.py         File discovery + .ragignore support
  complexity.py          Complexity analysis helpers
  patterns.py            Code pattern detection
```

### Project Databases
```
Polychron/.claude/mcp/code-docs-rag/
  code_chunks.lance/     Semantic code chunks (~3000 chunks from 610 files)
  knowledge.lance/       Knowledge KB (20+ entries with prediction error gating)
  symbols.lance/         Symbol index (3848+ symbols)
  file_hashes.json       Content hash cache for incremental reindex
```

### Skill Definition
```
~/.claude/skills/code-docs-rag/
  SKILL.md               Skill manifest (name, description, allowed-tools)
  search.md              Search & index tool docs
  knowledge.md           Knowledge management workflow
  symbols.md             Symbol lookup tool docs
  code-trace.md          Trace & dependency tool docs
```

### Settings (~/. claude/settings.json)
```json
{
  "mcpServers": {
    "code-docs-rag": {
      "command": "python3",
      "args": ["~/.claude/mcp/code-docs-rag/server.py"],
      "env": {
        "PROJECT_ROOT": "/home/jah/Polychron",
        "RAG_DB_PATH": "/home/jah/Polychron/.claude/mcp/code-docs-rag"
      }
    }
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit",  "...": "before_editing reminder for src/ files" },
      { "matcher": "Grep",  "...": "soft warn, prefer MCP grep()" },
      { "matcher": "Write", "...": "lab rules for sketches.js" },
      { "matcher": "Bash",  "...": "warn on grep/cat/head/tail/wc patterns" }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "...": "Evolver phases after npm run main, KB persist after snapshot, lab check after run" }
    ]
  },
  "permissions": {
    "deny": ["Bash(rm*run.lock*)", "Bash(*rm*tmp/run.lock*)"]
  }
}
```

### Project Doc References
```
Polychron/
  CLAUDE.md                   code-docs-rag section (mandatory workflow, 41 tools)
  .github/agents/Evolver.agent.md    code-docs-rag constraints in evolution loop
  .github/copilot-instructions.md    code-docs-rag reference
  .mcp.json                          MCP server registration
  doc/code-docs-rag.md               THIS FILE (comprehensive guide)
  doc/CALIBRATION_ANCHORS.md         KB entries merged into doc form
  doc/EVOLUTIONARY_ROADMAP.md        code-docs-rag improvements section
```

## Setup

Configured in `~/.claude/settings.json` under `mcpServers.code-docs-rag`. Load the skill before first use: `/code-docs-rag`

## When to Use What

| I want to... | Use | NOT |
|---|---|---|
| Find code by intent ("where does convergence happen") | `search_code` | Grep |
| Find all callers of a function | `find_callers` | Grep |
| Find callers in a specific directory | `find_callers path="src/crossLayer"` | Grep + manual filtering |
| Find boundary violations | `find_anti_pattern` or `find_callers exclude_path=` | Multi-step Grep |
| Check if a change is safe | `impact_analysis "symbolName"` | Reading code manually |
| Audit a file for convention issues | `convention_check "path/to/file.js"` | Manual review |
| Check for existing constraints before editing | `search_knowledge "module"` | Hoping you remember |
| Get optimal code for a query within token budget | `get_context "query" max_tokens=4000` | Reading files manually |
| Find exact variable name | `grep "varName" regex=True` | Built-in Grep |
| Search 2-3 specific files | Read tool | `search_code` (overkill) |
| Check KB for stale entries | `kb_health` | Manual review |

## Mandatory Workflow

### Before Editing Code

1. **`before_editing "path/to/file.js"`** -- ONE CALL gets everything: KB constraints, callers, boundary warnings, file structure. This replaces the multi-step research workflow.

### After Code Changes

1. **`what_did_i_forget "file1.js,file2.js"`** -- checks changed files against KB constraints, boundary rules, new L0 channels, doc update needs
2. File watcher auto-reindexes on save (5s debounce)
3. For batch changes: `index_codebase` once at the end

### After Confirmed Round

1. `add_knowledge` for new calibration anchors, decisions, anti-patterns, bugfixes
2. Use `related_to="<entry_id>"` to link related entries
3. Update docs: CLAUDE.md, relevant doc/*.md files

## Tool Reference

### Bash/Grep Replacements (use INSTEAD of Bash tools)

These wrap common shell operations with KB cross-referencing and convention warnings. Every result includes relevant knowledge context automatically.

| Tool | Replaces | Intelligence Added |
|------|----------|--------------------|
| `grep` | Bash `grep -rn` | KB cross-reference on pattern, boundary warnings |
| `file_lines` | Bash `cat`, `head`, `tail`, `sed -n` | KB context for the file's module |
| `count_lines` | Bash `wc -l`, `find \| wc` | Convention warnings (oversize flags) |
| `recent_changes` | `git diff --name-only` | KB context per changed file, great after compaction |

**Auto-KB enrichment:** Every `search_code` result automatically includes `[KB: constraint]` tags when the module has relevant knowledge entries. No separate search_knowledge call needed.

### Architectural Reasoning

| Tool | Use For | Example |
|------|---------|---------|
| `before_editing` | **START HERE.** Everything you need before touching a file | `before_editing "src/crossLayer/structure/form/crossLayerClimaxEngine.js"` |
| `what_did_i_forget` | Post-change audit: missed constraints, boundaries, doc needs | `what_did_i_forget "src/time/setBpm.js,src/time/setMeter.js"` |
| `module_story` | Living biography: definition, evolution, callers, neighbors | `module_story "crossLayerClimaxEngine"` |
| `diagnose_error` | Paste error, get: source, similar bugs, fix patterns | `diagnose_error "Error: playNotes: resolved.playProb must be finite"` |
| `codebase_health` | Full-repo convention sweep, prioritized by severity | `codebase_health` |
| `think` | Structured reflection before proceeding | `think "completeness"` or `think "constraints"` |
| `blast_radius` | Transitive dependency chain (depth 1-3) | `blast_radius "crossLayerClimaxEngine" max_depth=3` |
| `knowledge_graph` | Search KB and show connections between entries | `knowledge_graph "density suppression"` |
| `impact_analysis` | Callers + references + KB constraints in one shot | `impact_analysis "crossLayerClimaxEngine"` |
| `convention_check` | Audit file against conventions | `convention_check "src/crossLayer/dynamics/texturalMirror.js"` |
| `find_anti_pattern` | Find boundary violations | `find_anti_pattern wrong="systemDynamicsProfiler" right="conductorSignalBridge" path="src/crossLayer"` |

### Search & Discovery

| Tool | Use For | Example |
|------|---------|---------|
| `search_code` | Natural language code search | `search_code "where does convergence detection happen"` |
| `search_code` (scoped) | Directory-filtered search | `search_code "density" path="src/crossLayer"` |
| `find_callers` | All call sites for a symbol | `find_callers "crossLayerClimaxEngine"` |
| `find_callers` (scoped) | Callers in specific directory | `find_callers "systemDynamicsProfiler" path="src/crossLayer"` |
| `find_callers` (boundary) | Exclude legitimate callers | `find_callers "systemDynamicsProfiler" path="src/crossLayer" exclude_path="conductorSignalBridge"` |
| `find_similar_code` | Pattern matching by code snippet | `find_similar_code "if (regime === 'coherent') { scale *= 0.85; }"` |
| `lookup_symbol` | Find where a symbol is defined | `lookup_symbol "crossLayerClimaxEngine"` |
| `search_symbols` | Search symbols by name pattern | `search_symbols "density" kind="global"` |

### Structure & Navigation

| Tool | Use For | Example |
|------|---------|---------|
| `get_file_summary` | Functions + globals in a file | `get_file_summary "src/crossLayer/structure/form/crossLayerClimaxEngine.js"` |
| `get_module_map` | Directory structure with line counts | `get_module_map "src/crossLayer"` |
| `get_dependency_graph` | Import/require graph | `get_dependency_graph "src/conductor/globalConductor.js"` |
| `cross_language_trace` | All references across file types | `cross_language_trace "crossLayerClimaxEngine"` |
| `type_hierarchy` | Interface/class hierarchy | `type_hierarchy "CrossLayerClimaxEngineAPI"` |
| `get_function_body` | Extract exact function source | `get_function_body "tick"` |
| `list_libs` | Show indexed library directories | `list_libs` |
| `doc_sync_check` | Verify doc matches implementation | `doc_sync_check "doc/code-docs-rag.md"` |

### Knowledge Management

| Tool | Use For | Example |
|------|---------|---------|
| `search_knowledge` | Query persistent KB | `search_knowledge "density suppression"` |
| `add_knowledge` | Persist decision/anchor/pattern | `add_knowledge title="..." content="..." category="decision" tags="..."` |
| `list_knowledge` | Show all KB entries | `list_knowledge category="bugfix"` |
| `remove_knowledge` | Delete stale entry | `remove_knowledge "entry_id"` |
| `compact_knowledge` | Deduplicate similar entries | `compact_knowledge threshold=0.85` |
| `export_knowledge` | Export KB as markdown | `export_knowledge` |

### Index Management

| Tool | Use For | Example |
|------|---------|---------|
| `index_codebase` | Reindex all code chunks | `index_codebase` |
| `index_symbols` | Rebuild symbol index | `index_symbols` |
| `get_index_status` | Check index health | `get_index_status` |
| `clear_index` | Force full reindex | `clear_index` then `index_codebase` |

## Knowledge KB Categories

| Category | What to Store | Example |
|----------|--------------|---------|
| `architecture` | Boundary rules, system topology, L0 channels | "conductor cannot write to crossLayer" |
| `decision` | Calibration anchors, threshold choices, confirmed constraints | "coherent safety floor: 0.88 minimum" |
| `pattern` | Anti-patterns, proven design patterns, regime alignment rules | "compound suppression anti-pattern" |
| `bugfix` | Root causes, fixes, prevention rules | "L0 channel persistence caveat" |

## Polychron-Specific Features

### IIFE-Aware Chunking

Polychron uses `globalName = (() => { function tick() {...} ... })()` as its primary module pattern (473 files). The chunker detects this and creates named function chunks:

```
crossLayerClimaxEngine.js:
  1-77   [module_header] name='crossLayerClimaxEngine'
  78-147 [function] name='tick'
  148-234 [function] name='getModifiers'
  235-247 [function] name='isApproaching', 'isPeak', etc.
```

Note: tree-sitter is not installed. The IIFE regex chunker is the primary JS path.

### IIFE Global + Inner Function Symbol Indexing

321 IIFE globals + 1914 inner functions indexed (3848+ total). `lookup_symbol` and `find_callers` work for Polychron's global-assignment pattern and functions nested inside IIFEs.

### Temporal Relevance Decay

KB entries < 1 day old get 1.05x boost. Entries > 7 days get gradual decay (0.7x at 37 days). Recent decisions stay prominent.

### Knowledge Relationships

Use `related_to="<entry_id>"` to link entries. Related IDs stored in tags for cross-reference.

## Hooks Integration

| Hook | Trigger | Reminder |
|------|---------|----------|
| PreToolUse Edit | Any `src/` file edit | "search_knowledge before editing" |
| PreToolUse Write | `lab/sketches.js` | Lab rules (audible postBoot, no V, no crossLayerHelpers) |
| PostToolUse Bash | `npm run main` | Evolver phases 5-7 + index_codebase + add_knowledge |
| PostToolUse Bash | `npm run snapshot` | "persist calibration anchors to KB" |
| PostToolUse Bash | `node lab/run` | "check FAIL/PASS, diagnose failures" |

## Maintenance

### Reindex After Chunker Changes
```
clear_index
index_codebase
index_symbols
```

### Compact KB Periodically
After 30+ entries: `compact_knowledge threshold=0.85`

### Export for Backup
`export_knowledge` outputs all entries as markdown.

### Verify Index Health
`get_index_status` shows files, chunks, symbols counts.
