# HME

Hypermeta Ecstasy is Polychron's self-coherence substrate. It wraps agent
workflows with a proxy, event kernel, lifecycle hooks, KB retrieval, verifiers,
metrics, and a small `i/` command surface.

Read this before changing `tools/HME/`. Use [self-coherence-full.md](self-coherence-full.md) for the
full architecture, event-kernel contract, state ownership registry, LIFESAVER
rules, RAG stack, local LLM notes, and testing runbook.

## What It Owns

- **Proxy:** Claude/Anthropic and Codex/Responses middleware in
  `tools/HME/proxy/`.
- **Event kernel:** portable lifecycle/tool dispatcher in
  `tools/HME/event_kernel/`.
- **Hooks:** Claude Code and Codex lifecycle entrypoints in
  `tools/HME/hooks/`, routed through the event kernel.
- **Worker and tools:** HME service and `i/` wrappers in `tools/HME/service/`
  and project-root `i/`.
- **KB:** Lance-backed knowledge in `tools/HME/KB/`.
- **Coherence:** HCI verifiers, invariants, activity logs, and holograph
  snapshots under `tools/HME/scripts/` and `output/metrics/`.

## Current Command Surface

Use native Read/Edit/Grep/Glob/TodoWrite first; proxy middleware enriches or
replaces those where HME needs to participate. Claude `TodoWrite` and Codex
`update_plan` both sync into `doc/templates/TODO.md`; the Codex path runs
through the `codex_proxy` Responses service when configured, with universal
pulse as the fallback scanner. There is no manual Codex TODO sync command in
normal operation; failures belong in proxy/pulse repair, not operator ritual. Use `i/`
commands for explicit HME workflows:

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

If hooks, statusline, or autocommit look stale, run:

```bash
scripts/hme-doctor.py --hooks
scripts/sync-codex-settings.py
```

Codex hooks installed through `~/.codex/hooks.json` are user hooks. If Codex
reports that they need review, open `/hooks` once in the interactive CLI; the
`hme_codex` provider proxy remains active for Codex traffic either way.
`sync-codex-settings.py` also generates
`runtime/hme/codex-model-catalog.json`, points Codex at it with
`model_catalog_json`, and sets `model_context_window = 1050000`. The generated
catalog replaces Codex model `base_instructions` and
`model_messages.instructions_template` with
`doc/templates/canonical-system-prompt.md`, replaces
`personality_pragmatic` with `AGENTS.md`, and sets every model
`context_window`/`max_context_window` to `1050000`.

## Hard Style

- Single source of truth first. If a string, route, rule, or tool invocation is
  repeated, consolidate it before expanding it.
- Fail fast. Silent fallback is a bug unless the caller explicitly accepts
  best-effort behavior.
- Hooks are host adapters, not business logic. Shared behavior belongs in the
  event kernel, proxy middleware, policies, or service modules.
- Hook background work must detach stdio via `_hme_bg*`; lifecycle adapter
  starts/ends are mirrored by `event_kernel/hook_watchdog.js`.
- Filesystem state must have an owner. Update
  [state-files.json](../tools/HME/config/state-files.json) before adding a
  shared state writer.

## Fast Links

- Project orientation: [README.md](../README.md)
- Agent rules: [AGENTS.md](../AGENTS.md)
- Full HME reference: [self-coherence-full.md](self-coherence-full.md)
- Composition reference: [composition.md](composition.md)
