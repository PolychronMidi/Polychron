---
name: HME
description: Hypermeta evolutionary intelligence. 7 MCP tools for semantic search, KB, architectural analysis, and evolutionary composition.
allowed-tools: mcp__HME__*
---

# 7 Tools

| Tool | When to Use |
|------|-------------|
| `read(target)` | Before editing a file. Pre-edit briefing (mode='before'), file structure, module story/impact |
| `review(mode)` | After changes (mode='forget'), pipeline digest, regime, trust, health, convention, docs |
| `learn(...)` | KB: search, add, remove, list, compact, export, graph, dream, health |
| `evolve(focus)` | Evolution intelligence: LOC offenders, coupling gaps, leverage, pipeline suggestions |
| `status(mode)` | System health: pipeline, health, coupling, trust, perceptual, hme selftest |
| `trace(target)` | Signal flow: L0 cascade, module chains, causal chains; mode='snapshot' (S3/2:1:3:0/400) for beat state |
| `hme_admin(action)` | Maintenance: selftest, reload, index, clear_index, warm, introspect, fix_antipattern |

## Mandatory Pattern

```
read("moduleName", mode="before")   # BEFORE any edit
[make changes]
review(mode='forget')               # AFTER changes (auto-detects from git)
learn(title='...', content='...')    # PERSIST confirmed learnings
```

## Auto-Routing

`read()` detects from target format:
- `src/path/file.js` → file structure + KB
- `src/path/file.js:10-50` → line range
- `functionName` → function body lookup
- `moduleName` with mode → module intel
