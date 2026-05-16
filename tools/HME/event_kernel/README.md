# HME Event Kernel

The event kernel is the canonical dispatcher for HME lifecycle and tool events.
It exists outside `proxy/` so the proxy, Claude Code hooks, Codex hooks, direct
fallback, and future agent-CLI adapters can share one routing table.

## Contract

`dispatcher.dispatchEvent(eventName, stdinJson)` returns:

```json
{"stdout":"","stderr":" ","exit_code":0}
```

Adapters translate that result into their host protocol. `claude_adapter.js`
wraps the result for Claude Code, while `codex_adapter.js` relays Codex-native
JSON and filters unsupported fields such as `updatedInput`.

## Process IPC

All subprocess boundaries use `fs_ipc.js`: the kernel writes hook input to
`tools/HME/runtime/event-ipc/<invocation>/stdin.json`, runs the child with stdin
redirected from that file, then removes the invocation directory. This keeps
event handling independent of Claude Code, Codex, shell pipes, or Node
synchronous-spawn input behavior.

## Adapters

- Proxy-up Claude Code hooks: `claude_adapter.js` posts to `/hme/lifecycle`;
  `proxy/lifecycle_bridge.js` calls `event_kernel/dispatcher.js`.
- Proxy-down direct mode: `claude_adapter.js` calls `dispatcher.js` directly.
- Proxy-up Codex hooks: `codex_adapter.js` posts to `/hme/lifecycle`;
  `proxy/lifecycle_bridge.js` calls the same dispatcher.
- Proxy-down Codex direct mode: `codex_adapter.js` calls `dispatcher.js`
  directly and translates the result to Codex hook output.

## Single Source Of Truth

Do not add Event -> script routing tables in adapters. Add or change routing in
`dispatcher.js`; adapters should only handle transport, protocol translation,
root resolution, and fail-loud behavior.

Native tool handlers live under `native_hooks/`; shell hooks remain behind the
dispatcher or Stop-chain policy adapter until their behavior is ported.

Claude Code settings are also manifest-driven: edit
`tools/HME/hooks/hooks.json`, then run `tools/HME/scripts/sync-claude-settings.py`.
`tools/HME/scripts/audit-claude-settings.py` compares live `~/.claude/settings.json`
against that manifest.

Codex settings are manifest-driven too: edit
`tools/HME/hooks/codex_hooks.json`, then run
`tools/HME/scripts/sync-codex-settings.py`. That writes `~/.codex/hooks.json`, enables
`features.hooks`, and registers the `hme_codex` Responses provider at the
service-registry `codex_proxy` port. `tools/HME/scripts/audit-codex-settings.py` checks
the live Codex files against those registries. Codex treats user hooks as
non-managed hooks, so the first interactive Codex launch may require `/hooks`
review before the hook adapter runs; the provider proxy path is not gated by
that review.

The same sync path generates `tools/HME/runtime/codex-model-catalog.json` from
Codex's live `~/.codex/models_cache.json` and points `model_catalog_json` at
the generated file. HME replaces `base_instructions` and
`model_messages.instructions_template` with
`doc/templates/canonical-system-prompt.md`, replaces
`personality_pragmatic` with `doc/templates/AGENTS.md`, and sets model catalog
`context_window`/`max_context_window` plus root `model_context_window` to
`1050000`.
