# HME as a reusable framework

HyperMeta Ecstasy (HME) is built for Polychron but the architecture is
portable. This doc enumerates the pieces, their dependencies, and the
minimum adoption surface for extracting HME into any other
agent-assisted project.

## Architecture: six concentric layers

```
    ┌──────────────────────────────────────────────────┐
    │  6. HCI verifier substrate (51+ verifiers)        │  ← invariants
    │  5. Detector chain (9+ antipattern detectors)     │  ← reactive gates
    │  4. Proxy middleware pipeline (15+ middlewares)    │  ← transparent enrichment
    │  3. Shell hook chain (Pre/Post/Stop/Session)      │  ← Claude Code boundary
    │  2. Hook-bridge forwarder (stateless)             │  ← plugin-cache proof
    │  1. Proxy core (hme_proxy.js)                     │  ← network layer
    └──────────────────────────────────────────────────┘
```

## Minimum adoption surface

A project wanting the HME pattern needs:

1. **Proxy core** (`tools/HME/proxy/`) — Node HTTP proxy on port 9099
   fronts Anthropic API. ~2kLOC.
2. **Hook bridge** (`tools/HME/hooks/_proxy_bridge.sh`) — single shell
   forwarder registered in Claude Code `settings.json`. Path-resilient
   (CLAUDE_PROJECT_DIR first, walk-up second, hardcoded last). ~200 LOC.
3. **One hook handler per event** (`tools/HME/hooks/lifecycle/`,
   `hooks/pretooluse/`, `hooks/posttooluse/`). Dispatcher pattern: each
   is a thin dispatcher that sources sub-files from a sibling dir, with
   `set +u +e` defense-in-depth so one sub-file's crash can't kill the
   chain silently.
4. **Activity bridge** (`tools/HME/activity/`) — JSONL event emit +
   consumer. Append-only with `common/bounded_log.maybe_trim_append`
   for bounded growth.
5. **One verifier dir** (`tools/HME/scripts/verify_coherence/`) with a
   REGISTRY. Each verifier is `{name, category, weight, run() → {status,
   score, summary, details}}`. Aggregated score = weighted mean.

## Dependencies (minimum)

- Node 18+ (proxy)
- Python 3.10+ (MCP worker, detectors, verifiers)
- bash 5+ (hooks)
- curl, jq

## What's Polychron-specific vs portable

**Polychron-specific** (must be re-implemented for another project):
- `src/` hypermeta controllers (music synthesis axes)
- `output/metrics/` pipeline artifacts (feedback graph, coupling)
- KB schema (Polychron-specific entry categories)
- `npm run main` pipeline

**Portable** (copy as-is):
- Everything in `tools/HME/` (~25kLOC)
- Hook patterns
- Proxy middleware pipeline
- Detector framework
- Verifier substrate
- LIFESAVER error-log convention
- Autocommit `direct/` loop
- Universal pulse active-probe layer
- Race-mode reasoning cascade (`_reasoning_think`)
- Bounded log helper
- Stop-chain auto-completeness injection + exhaust_check
- Agent-patterns DB

## Extraction plan (future work)

1. Split `tools/HME/` into a Git submodule or separate repo
   `hme-framework`.
2. Add `init-hme.sh` installer that: copies hooks into target
   project, registers with Claude Code `settings.json`, scaffolds
   `output/metrics/` and `tmp/`.
3. Publish as `@anthropic/hme-framework` npm/pypi pair.
4. Target project's adoption: clone framework → run installer →
   customize `config/coherence-registry.json` for project-specific
   subsystems.

## Compatibility boundaries

- Claude Code hook dispatcher: relies on `settings.json` hook wiring.
  Survives VS Code extension + terminal CLI.
- MCP layer: stdio transport. Compatible with the MCP spec.
- Proxy: pure HTTP, no Anthropic-client-library dependency. Can front
  any base URL.

Not yet packaged as a framework. This doc documents the shape that
extraction would take; the refactor itself is follow-up work.
