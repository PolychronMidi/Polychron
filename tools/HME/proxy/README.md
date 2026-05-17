# HME Inference Proxy

The authoritative MITM proxy between Claude Code and the Anthropic API. It owns context-efficiency, cache-correctness, HME enrichment, health/admin routes, and child supervision. Ports, URLs, PID labels, logs, process patterns, and supervision edges come from `tools/HME/config/services.json`; `supervisor/` keeps the worker and `llamacpp_daemon` as ps-tree children.

## Data flow

**Outgoing** (Claude Code -> Anthropic):
1. Strip boilerplate acknowledgements, scrub stale `cache_control` markers
2. Inject HME tool schemas into `payload.tools` with `HME_` prefix (Claude Code has no direct MCP connection to us for HME)
3. Inject session-status block + jurisdiction context when applicable
4. Run middleware `onRequest` hooks; forward to Anthropic

**Return** (Anthropic -> Claude Code):
1. If the response contains `HME_*` tool_uses, `hme_dispatcher.js` enters a continuation loop: execute each HME tool via `POST /tool/<name>` on the worker, append `[assistant_response, user(tool_results)]`, retry Anthropic until the response is HME-free
2. Run middleware `onToolResult` hooks on native tool results (callers, bias-locks, KB bugfix warnings, dir rules)
3. Forward the HME-free final response to Claude Code

Native tool_uses stream through unchanged. HME turns buffer (streaming lost) because the continuation loop needs the full response.

## Running

```bash
# Start the proxy -- supervises worker + llamacpp_daemon automatically
node tools/HME/proxy/hme_proxy.js

# Point Claude Code at it
export ANTHROPIC_BASE_URL=http://127.0.0.1:${HME_PROXY_PORT:-9099}
claude
```

## Env vars

| Var | Default | Purpose |
-
| `HME_PROXY_PORT` | services.json | Listen port |
| `HME_WORKER_PORT` | services.json | Internal worker port |
| `HME_LLAMACPP_DAEMON_PORT` | services.json | Local-model daemon port |
| `HME_PROXY_UPSTREAM_HOST` | `api.anthropic.com` | Upstream host |
| `HME_PROXY_UPSTREAM_PORT` | `443` | Upstream port |
| `HME_PROXY_UPSTREAM_TLS` | `1` | `0` for plain HTTP (tests) |
| `HME_PROXY_INJECT` | `1` | `0` to disable status + jurisdiction injection |
| `HME_PROXY_SUPERVISE` | `1` | `0` to skip child supervision |

## Testing

```bash
node tools/HME/proxy/hme_proxy.js --test <<'EOF'
{"model":"claude","messages":[{"role":"user","content":"hi"},
 {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{}}]}]}
EOF
```

Exit `0` = clean, `1` = violation.

## Structure

- `hme_proxy.js` -- thin executable entrypoint and process-supervisor bootstrap
- `hme_proxy_core.js` -- shared helper functions, stop-reminder health, compaction helpers
- `hme_proxy_claude.js` -- Claude/Anthropic request handler and upstream orchestration
- `hme_proxy_codex.js` -- OmniRoute/Codex fallback helpers used by the Claude path
- `hme_proxy_response_trace.js` -- response dump/blank-response diagnostics
- `hme_proxy_response_send.js` -- SSE/non-SSE final response rewriting and Stop fallback
- `hme_proxy_fp_gate.js` -- FP-check upstream kill scanner
- `hme_proxy_upstream_failure.js` -- upstream failure classification, snapshots, and retry
- `hme_proxy_context_budget.js` -- compaction thresholds, context-window estimates, panic shrink
- `hme_proxy_headers.js` -- upstream header shaping and loopback OAuth injection
- `hme_proxy_request_mutation.js` -- outgoing request transforms, middleware, status/context injection
- `middleware/` -- per-tool enrichment modules; one file per concern
- `supervisor/` -- child process specs, health probing, pre-flight adoption
- `mcp_server/` -- SSE handler for `/mcp` (currently unused; HME goes via tool injection)
- `hme_dispatcher.js` -- HME continuation loop
- `messages.js` -- boilerplate strip + semantic redundancy strip
- `context.js` -- status + jurisdiction context builders
- `../event_kernel/` -- canonical hook/lifecycle dispatcher used by proxy-up
  and direct fallback paths

## Related

- `tools/HME/activity/emit.py` -- event emitter (proxy calls this fire-and-forget)
- `tools/HME/service/worker.py` -- Python worker serving `/tool/*`, `/enrich`, `/validate`
- `tools/HME/service/llamacpp_daemon/` -- local-model daemon package
- `src/scripts/pipeline/validators/check-hme-coherence.js` -- pipeline gate reading the activity stream

<!-- HME-DIR-INTENT
rules:
  - All Claude Code <-> Anthropic traffic is MITM'd here; never call Anthropic directly from HME code
  - Middleware modules in middleware/ export {name, onToolResult?, onRequest?} and auto-load at startup
  - Never add cache_control to system blocks -- Anthropic 400s when a ttl='5m' block precedes a ttl='1h' block (processing order is tools -> system -> messages)
  - HME tool schemas are injected into payload.tools with HME_ prefix; Claude Code has no direct MCP connection to us for HME
-->
