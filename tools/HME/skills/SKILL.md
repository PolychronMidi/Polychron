---
name: HME
description: Hypermeta evolutionary intelligence. 5 MCP tools — evolutionary nervous system for self-evolving composition: KB, architectural analysis, enforcement, evolution planning.
allowed-tools: mcp__HME__*
---

# 5 Tools

| Tool | When to Use |
|------|-------------|
| `review(mode)` | mode='forget': post-edit audit. mode='full': digest+regime+trust. mode='composition': arc/drama/hotspot |
| `learn(action)` | action='search': KB query. action='add': new entry. action='health': coverage/staleness |
| `evolve(focus)` | focus: design / forge / curate / invariants / stress / contradict |
| `trace(target)` | Signal flow: L0 cascade, module chains, causal chains; mode='snapshot' (S3/2:1:3:0/400) for beat state |
| `hme_admin(action)` | selftest / reload / index / clear_index / warm / introspect / fix_antipattern |

## Mandatory Pattern

```
review(mode='forget')                   # AFTER changes (auto-detects from git)
  STABLE/EVOLVED -> auto-commit
  FAILED -> diagnose

evolve(focus='forge')                   # generate lab sketch
node lab/run.js sketches/<name>         # test (180s, isolated)
  confirmed -> learn(title='...', content='...')
```

## Auto-Routing

`evolve(focus)` values:
- `'design'` — antagonist bridge: dimension + code location + rationale
- `'forge'` — executable lab sketch for top unsaturated bridge
- `'curate'` — KB-worthy patterns from recent pipeline runs
- `'invariants'` — 40 declarative structural checks
- `'stress'` — 35 adversarial probes: hooks, ESLint, LIFESAVER, docs
- `'contradict'` — KB conflict scanner

`learn()` key calls:
- `learn(action='search', query='...')` — semantic KB search
- `learn(title='...', content='...', category='pattern')` — add calibration anchor
- `learn(action='health')` — KB staleness and coverage
