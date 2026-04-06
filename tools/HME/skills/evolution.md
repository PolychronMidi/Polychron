# Evolution — HME as Evolver Backbone

HME is not a passive tool collection. It is the cognitive substrate of the Evolver loop — the intelligence that makes self-evolving composition possible.

## Evolver Phase Integration

| Phase | HME Role | Tools |
|-------|----------|-------|
| 1. Perceive | KB context on changed files, surface patterns | `recent_changes`, `search_knowledge`, `knowledge_graph` |
| 2. Diagnose | Trace causal chains with constraints, find anti-patterns | `search_code`, `find_callers`, `find_anti_pattern`, `think` |
| 3. Evolve | Pre-edit briefing, constraint checking, boundary enforcement | `before_editing`, `search_knowledge`, `module_intel` |
| 4. Run | Pipeline; file watcher auto-reindexes | (automatic) |
| 5. Verify | Post-change audit, missed constraints | `what_did_i_forget`, `convention_check`, `codebase_health` |
| 6. Journal | Persist findings as KB entries | `add_knowledge`, `knowledge_graph`, `compact_knowledge` |
| 7. Maintain | Reindex, health checks, doc sync | `reindex`, `kb_health`, `doc_sync_check` |

## Self-Evolution Cycle

HME evolves alongside Polychron:

1. **After confirmed rounds:** `add_knowledge` persists calibration anchors, decisions, anti-patterns
2. **Periodically:** `compact_knowledge` deduplicates, `memory_dream` discovers hidden connections
3. **When docs drift:** `doc_sync_check` flags; update CLAUDE.md and doc/*.md
4. **When hooks miss:** Add new PreToolUse/PostToolUse hooks for emerging anti-patterns
5. **When skills grow:** Add new skill pages for new cognitive frameworks
6. **When the Evolver loop itself needs improving:** KB entries about phase effectiveness guide refinement

## Mandatory Before/After Pattern

```
before_editing "src/path/to/file.js"   -- BEFORE any edit
[make changes]
what_did_i_forget "src/path/to/file.js" -- AFTER changes
[confirm round]
add_knowledge title="..." content="..." -- PERSIST learnings
```

## KB Categories for Evolution

| Category | Use For |
|----------|---------|
| `architecture` | Boundary rules, system topology, L0 channels |
| `decision` | Calibration anchors, threshold choices, confirmed constraints |
| `pattern` | Anti-patterns, proven patterns, regime alignment |
| `bugfix` | Root causes, fixes, prevention rules |
