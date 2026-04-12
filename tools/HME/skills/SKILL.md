---
name: HME
description: Hypermeta evolutionary intelligence. 11 MCP mega-tools for semantic search, KB, architectural analysis, and evolutionary composition.
allowed-tools: mcp__HME__*
---

First session? Read `doc/AGENT_PRIMER.md` for full onboarding.

# 11 Mega-Tools

| Tool | When to Use |
|------|-------------|
| `read(target)` | Before editing a file. Pre-edit briefing (mode='before'), file structure, module story/impact |
| `find(query)` | Any search. Auto-routes: callers, boundary, grep, semantic, coupling, symbols, diagnosis |
| `review(mode)` | After changes (mode='forget'), pipeline digest, regime, trust, health, convention, docs |
| `learn(...)` | KB: search, add, remove, list, compact, export, graph, dream, health |
| `evolve(focus)` | Evolution intelligence: LOC offenders, coupling gaps, leverage, pipeline suggestions |
| `status(mode)` | System health: pipeline, health, coupling, trust, perceptual, hme selftest |
| `trace(target)` | Signal flow: L0 cascade traces, module chains, causal chains |
| `hme_admin(action)` | Maintenance: selftest, reload, index, clear_index, warm, introspect |
| `beat_snapshot(beat)` | Composition state cross-section at a specific beat |
| `warm_pre_edit_cache()` | Pre-populate before_editing caches for all src/ files |
| `todo(action)` | Task tracking: list, add, done, undo, remove, clear |

## Mandatory Pattern

```
read("moduleName", mode="before")   # BEFORE any edit
[make changes]
review(mode='forget')               # AFTER changes (auto-detects from git)
learn(title='...', content='...')    # PERSIST confirmed learnings
```

## Auto-Routing

`find()` detects intent from query text:
- "callers of X" → caller search
- "X should use Y" → boundary check
- regex pattern → grep
- natural language → semantic search

`read()` detects from target format:
- `src/path/file.js` → file structure + KB
- `src/path/file.js:10-50` → line range
- `functionName` → function body lookup
- `moduleName` with mode → module intel
