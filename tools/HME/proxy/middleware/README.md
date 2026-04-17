# Proxy middleware

Per-tool enrichment and side-effect modules. The proxy's `messages.js` pipeline pairs each `tool_use` block with its matching `tool_result` block (by id), then dispatches each pair through every middleware module's `onToolResult` handler. `onRequest` handlers fire once per Anthropic request after strip/scan, before injection.

Each module owns a narrow concern — callers lookup, bias-bound warnings, directory rules, KB bugfix validation, activity telemetry, NEXUS state tracking. All auto-loaded at proxy startup by `index.js`.

## Module shape

```js
module.exports = {
  name: 'my_enricher',

  // Fired per (tool_use, tool_result) pair. Dedup'd by tool_use.id process-wide.
  onToolResult({ toolUse, toolResult, session, ctx }) { ... },

  // Fired per outgoing Anthropic request after strip + scan, before inject.
  onRequest({ payload, scan, session, ctx }) { ... },
};
```

## Idempotency

Because the in-memory `_processed` LRU is cleared on proxy restart, every historical tool_result re-enters the pipeline. Footer-appending modules must use `ctx.hasHmeFooter(toolResult)` as a guard before writing — otherwise footers stack N-deep in the replayed history.

## Context

- `ctx.emit({event, ...fields})` — fire-and-forget activity event
- `ctx.nexusAdd/Mark/ClearType/Count` — NEXUS state file operations
- `ctx.hasHmeFooter(toolResult)` — idempotency guard (checks for `[HME` marker)
- `ctx.markDirty()` — signal that the payload mutated; proxy re-serializes before forwarding
- `ctx.warn(...)` — prefixed stderr (must use `Acceptable warning:` format)
- `ctx.PROJECT_ROOT` — absolute project root

## Related

- `tools/HME/proxy/messages.js` — pipeline entry point, pairing logic
- `tools/HME/proxy/worker_client.js` — thin HTTP client for `/validate` and `/enrich` RAG endpoints

<!-- HME-DIR-INTENT
rules:
  - Modules must export `{name, onToolResult?, onRequest?}` — anything else is a load-time error
  - Footer-appending middleware MUST guard with `ctx.hasHmeFooter(toolResult)` — proxy restart replays history and stacks footers without it
  - Call `ctx.markDirty()` when you mutate the payload so the proxy re-serializes before forwarding upstream
  - Every footer must start with `[HME` so the shared idempotency guard detects it
  - Keep per-tool-call budget tight — max ~180 chars per footer; prefer compact `key=value` over prose
-->
