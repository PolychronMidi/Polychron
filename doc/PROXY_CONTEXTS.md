# HME proxy bounded contexts

The proxy is large (107 files / ~14.5K lines). To keep coupling
manageable while a full physical reorganization happens incrementally,
this document declares the **bounded contexts** every new or migrated
file should belong to. A file lives in exactly one context;
cross-context dependencies should go through a single façade per
context, never reach into another context's internals.

## Contexts

### request_mutation

Transforms the inbound client request before dispatch.

- `hme_proxy_request_mutation.js`, `messages.js`, `context.js`,
  `compactor*.js`, `prompt_spam_guard.js`, all `middleware/*` modules.
- Façade: `hme_proxy_request_mutation.mutateClaudeRequest`.

### upstream_dispatch

Resolves upstream + sends the request. Owns OmniRoute selection,
overdrive routing, and the http(s) transport layer.

- `upstream.js`, `overdrive_route.js`, `omniroute_client.js`,
  `omniroute_protocol.js`, `model_route_resolver.js`,
  `model_route_health.js`, `swap_state_store.js`, `hme_proxy_headers.js`,
  `service_registry.js`, `hme_proxy.js`.
- Façade: `hme_proxy_claude.handleRequest` (the Anthropic entrypoint).

### response_transform

Buffers and rewrites the upstream response into Anthropic-compatible
SSE/JSON.

- `hme_proxy_anthropic_response.js`, `legacy_swap_response.js`,
  `sse_slop_rewriter.js`, `sse_stop_hook_rewriters.js`,
  `codex_response_forwarder.js`, `codex_tool_text.js`,
  `codex_omniroute.js`, `zen_translator.js`, `reasoning_to_thinking.js`,
  `hme_proxy_response_send.js`, `hme_proxy_response_trace.js`,
  `omni_tool_loop.js`.
- Façade: `hme_proxy_anthropic_response.handleAnthropicResponseComplete`.

### failure_policy

Classifies failures, decides retry/fallback action, persists route
quarantines, refreshes OAuth tokens. Pure functions where possible.

- `omni_failure_policy.js` (the policy table),
  `hme_proxy_upstream_failure.js`, `hme_proxy_codex.js`,
  `hme_proxy_connection_errors.js`, `failure_classification.js`,
  `model_route_health.js` (cooldowns).
- Façade: `hme_proxy_upstream_failure.handleUpstreamFailureOrSuccess`.

### lifecycle_bridge

Maps Claude Code lifecycle events (PreToolUse, PostToolUse,
SessionStart, Stop, UserPromptSubmit) into the portable event kernel.

- `lifecycle_bridge.js`, `hme_proxy_routes.js`, `start_marker.js`,
  `hme_dispatcher.js`, `supervisor/*.js`.
- Façade: `lifecycle_bridge.handleLifecycleRoute`.

### infra (shared primitives)

Below all the contexts; should not depend on any of them.

- `hme_config.js`, `subprocess.js`, `lifecycle_state.js`, `hme_paths.js`,
  `shared/*.js`, `_dump.js`, `proxy_route_metrics.js`,
  `config_loader.js`.

## Rules

1. **One façade per context.** Cross-context calls go through the
   declared façade module. Reaching into a different context's helper
   file is a refactor smell.
2. **Pure helpers stay in infra.** Anything that doesn't depend on
   another context belongs in infra so all contexts can use it without
   pulling in a sibling context.
3. **State lives in `lifecycle_state.js`.** Direct `fs.readFileSync` of
   runtime markers is forbidden in new code.
4. **Shell-outs go through `subprocess.js`.** Direct `child_process`
   imports outside `subprocess.js` are deprecated.
5. **Env reads go through `hme_config.js`.** Direct `_hmeRequireEnv`
   calls in new code are deprecated.

These rules are advisory until a verifier enforces them; for now they
exist so new code and incremental migrations have a clear target.

## Adopt-incrementally migration order

Smallest-blast-radius first; each step is a separate commit:

1. Infra helpers in place: `hme_config.js`, `subprocess.js`,
   `lifecycle_state.js`, `omni_failure_policy.js`.
2. Migrate one shell-out call site at a time to `subprocess.runSync`.
3. Migrate one state-file read at a time to `lifecycle_state`.
4. Migrate one env read at a time to `hme_config.load()`.
5. After enough leaves move, lift the façades into per-context
   directories (`proxy/contexts/<name>/index.js`).
