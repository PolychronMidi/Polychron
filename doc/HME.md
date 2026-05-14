# HME

Hypermeta Ecstasy is Polychron's self-coherence substrate. It wraps agent
workflows with a proxy, event kernel, lifecycle hooks, KB retrieval, verifiers,
metrics, and a small `i/` command surface.

Read this before changing `tools/HME/`. Use [hme_full.md](hme_full.md) for the
full architecture, event-kernel contract, state ownership registry, LIFESAVER
rules, RAG stack, local LLM notes, and testing runbook.

## What It Owns

- **Proxy:** inference and native-tool middleware in `tools/HME/proxy/`.
- **Event kernel:** portable lifecycle/tool dispatcher in
  `tools/HME/event_kernel/`.
- **Hooks:** Claude Code lifecycle entrypoints in `tools/HME/hooks/`, routed
  through the event kernel.
- **Worker and tools:** HME service and `i/` wrappers in `tools/HME/service/`
  and project-root `i/`.
- **KB:** Lance-backed knowledge in `tools/HME/KB/`.
- **Coherence:** HCI verifiers, invariants, activity logs, and holograph
  snapshots under `tools/HME/scripts/` and `output/metrics/`.

## Current Command Surface

Use native Read/Edit/Grep/Glob/TodoWrite first; proxy middleware enriches or
replaces those where HME needs to participate. Use `i/` commands for explicit
HME workflows:

```bash
i/hme admin action=selftest
i/review mode=forget
i/learn query="coupling"
i/learn title="..." content="..." category=pattern
i/trace target=<module> mode=impact
i/status state
i/status timeline window=30m
i/why mode=block
i/policies list
```

Commands that only duplicated automatic native-tool enrichment have been
retired. Do not add an `i/` wrapper unless the user or agent needs to invoke
the behavior deliberately.

## Working Loop

1. Check state with `i/status state` when context is unclear.
2. Edit through native tools; HME enriches reads and edits automatically.
3. Run `i/review mode=forget` after meaningful changes.
4. Run the project pipeline when code behavior changed.
5. Persist confirmed learning with `i/learn`.
6. Run `i/hme admin action=selftest` after HME substrate changes.

## Hard Style

- Single source of truth first. If a string, route, rule, or tool invocation is
  repeated, consolidate it before expanding it.
- Fail fast. Silent fallback is a bug unless the caller explicitly accepts
  best-effort behavior.
- Hooks are host adapters, not business logic. Shared behavior belongs in the
  event kernel, proxy middleware, policies, or service modules.
- Filesystem state must have an owner. Update the state registry in
  [hme_full.md](hme_full.md) before adding a shared state writer.

## Fast Links

- Project orientation: [README.md](../README.md)
- Agent rules: [CLAUDE.md](../CLAUDE.md)
- Full HME reference: [hme_full.md](hme_full.md)
- Composition reference: [SRC.md](SRC.md)
