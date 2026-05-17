# HME Inference Proxy

Authoritative MITM proxy between Claude Code and the Anthropic API. It owns context-efficiency, cache-correctness, HME enrichment, health/admin routes, and child supervision. Ports, URLs, PID labels, logs, process patterns, and supervision edges come from `tools/HME/config/services.json`; `supervisor/` keeps the worker and `llamacpp_daemon` as ps-tree children.

## Data flow

**Outgoing** (Claude Code -> Anthropic):
1. Strip boilerplate/noise, scrub stale `cache_control`, normalize TTLs.
2. Inject `HME_` tool schemas into `payload.tools` when enabled.
3. Inject session-status and jurisdiction context when applicable.
4. Run middleware `onRequest` hooks, then forward upstream.

**Return** (Anthropic -> Claude Code):
1. If `HME_*` tool_uses appear, `hme_dispatcher.js` runs a buffered continuation loop through the worker (`POST /tool/<name>`) until the response is HME-free.
2. Middleware `onToolResult` hooks enrich native tool results.
3. Final SSE/non-SSE response is rewritten as needed and forwarded.

Native tool_uses stream through unchanged. HME continuations buffer because the loop needs the full response.

## Running

```bash
node tools/HME/proxy/hme_proxy.js
export ANTHROPIC_BASE_URL=http://127.0.0.1:${HME_PROXY_PORT:-9099}
claude
```

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `HME_PROXY_PORT` | services.json | Listen port |
| `HME_WORKER_PORT` | services.json | Internal worker port |
| `HME_LLAMACPP_DAEMON_PORT` | services.json | Local-model daemon port |
| `HME_PROXY_UPSTREAM_HOST` | `api.anthropic.com` | Upstream host |
| `HME_PROXY_UPSTREAM_PORT` | `443` | Upstream port |
| `HME_PROXY_UPSTREAM_TLS` | `1` | `0` for plain HTTP tests |
| `HME_PROXY_INJECT` | `1` | `0` disables status/jurisdiction injection |
| `HME_PROXY_SUPERVISE` | `1` | `0` skips child supervision |

## Testing

```bash
node tools/HME/proxy/hme_proxy.js --test <<'EOF'
{"model":"claude","messages":[{"role":"user","content":"hi"},
 {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{}}]}]}
EOF
```

Exit `0` = clean, `1` = violation.

## Structure

- `hme_proxy.js` -- executable bootstrap and supervisor wiring
- `hme_proxy_claude.js` -- Claude/Anthropic request forwarding
- `hme_proxy_routes.js` -- health/admin/lifecycle/session/MCP route dispatch
- `hme_proxy_request_mutation.js` -- outgoing transforms, middleware, injected context
- `hme_proxy_headers.js` -- upstream header shaping and loopback OAuth injection
- `hme_proxy_context_budget.js` -- compaction thresholds and context-window estimates
- `hme_proxy_opus_gate.js` -- single-flight/min-gap serializer for interactive Opus
- `hme_proxy_response_trace.js` -- response dump/blank-response diagnostics
- `hme_proxy_response_send.js` -- SSE/non-SSE final response rewriting and Stop fallback
- `hme_proxy_fp_gate.js` -- FP-check upstream kill scanner
- `hme_proxy_upstream_failure.js` -- upstream failure classification, snapshots, retry
- `hme_proxy_codex.js` -- OmniRoute/Codex fallback helpers
- `hme_proxy_core.js` -- shared HME payload helpers and stop-reminder health
- `middleware/` -- per-tool enrichment modules (`{name,onRequest?,onToolResult?}`)
- `supervisor/` -- child process specs, health probes, pre-flight adoption
- `mcp_server/` -- proxy-native MCP SSE handler
- `hme_dispatcher.js` -- HME continuation loop
- `messages.js` / `context.js` -- message scanning, stripping, and injected context builders
- `../event_kernel/` -- canonical hook/lifecycle dispatcher

## Related

- `tools/HME/activity/emit.py` -- fire-and-forget activity emitter
- `tools/HME/service/worker.py` -- Python worker for `/tool/*`, `/enrich`, `/validate`
- `tools/HME/service/llamacpp_daemon/` -- local-model daemon package
- `src/scripts/pipeline/validators/check-hme-coherence.js` -- activity-stream gate

<!-- HME-DIR-INTENT
rules:
  - All Claude Code <-> Anthropic traffic is MITM'd here; never call Anthropic directly from HME code
  - Middleware modules in middleware/ export {name, onToolResult?, onRequest?} and auto-load at startup
  - Never add cache_control to system blocks; ttl=5m before ttl=1h makes Anthropic 400 (tools -> system -> messages order)
  - HME tool schemas are injected into payload.tools with HME_ prefix; Claude Code has no direct MCP connection to us for HME
-->
