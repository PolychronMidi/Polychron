---
name: proxy
rules:
  - All Claude Code ↔ Anthropic traffic is MITM'd here; never call Anthropic directly from HME code
  - Middleware modules in middleware/ export {name, onToolResult?, onRequest?} and auto-load at startup
  - Never add cache_control to system blocks — Anthropic 400s when a ttl='5m' block precedes a ttl='1h' block (processing order is tools → system → messages)
  - HME tool schemas are injected into payload.tools with HME_ prefix; Claude Code has no direct MCP connection to us for HME
info: |
  Authoritative HTTP chokepoint at port 9099. Owns the process tree — supervises
  the worker (MCP server at 9098) and llamacpp_daemon (7735) as ps-tree children
  via supervisor/; a single pkill -P <proxy-pid> tears everything down.
  On outgoing: strips boilerplate, scrubs stale cache_control, injects HME tool
  schemas + session status + jurisdiction context.
  On return: if the response contains HME_* tool_uses, runs a continuation loop
  (hme_dispatcher.js) executing tools via POST /tool/<name> until the response
  is HME-free, then forwards that to Claude Code. Native tool_uses stream through.
  Every completed tool_use fires the middleware pipeline for enrichment (callers,
  bias-locks, KB bugfix warnings, etc).
children:
  middleware/: Per-tool enrichment modules — one file per concern (read_context, edit_context, bash_enrichment, nexus_tracking, etc). Runs post-tool-result.
  supervisor/: Child process specs, health probing, adoption logic. Pre-flight health probe prevents EADDRINUSE restart loops.
  mcp_server/: SSE handler Claude Code talks to at /mcp for any native MCP tools we expose (currently none — HME goes via tool injection, not MCP).
---

# HME Inference Proxy

The authoritative MITM proxy between Claude Code and Anthropic. Everything visible to the model passes through here — this is where context-efficiency, cache-correctness, and HME enrichment all live.

## Running

```bash
# Start the proxy (supervises worker + llamacpp_daemon automatically)
node tools/HME/proxy/hme_proxy.js

# Point Claude Code at it
export ANTHROPIC_BASE_URL=http://127.0.0.1:9099
claude
```

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `HME_PROXY_PORT` | `9099` | Listen port |
| `HME_MCP_PORT` | `9098` | Internal worker port |
| `HME_LLAMACPP_DAEMON_PORT` | `7735` | Local-model daemon port |
| `HME_PROXY_UPSTREAM_HOST` | `api.anthropic.com` | Upstream host |
| `HME_PROXY_UPSTREAM_PORT` | `443` | Upstream port |
| `HME_PROXY_UPSTREAM_TLS` | `1` | `0` for plain HTTP (tests) |
| `HME_PROXY_INJECT` | `1` | `0` to disable jurisdiction/status injection |
| `HME_PROXY_SUPERVISE` | `1` | `0` to skip child supervision |

## Testing

```bash
node tools/HME/proxy/hme_proxy.js --test <<'EOF'
{"model":"claude","messages":[{"role":"user","content":"hi"},
 {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{}}]}]}
EOF
```

Exit `0` = clean, `1` = violation.

## Related

- `tools/HME/activity/emit.py` — event emitter (proxy calls this fire-and-forget)
- `tools/HME/mcp/worker.py` — Python worker serving `/tool/*`, `/enrich`, `/validate`
- `tools/HME/mcp/llamacpp_daemon.py` — local-model daemon for arbiter/coder tasks
- `scripts/pipeline/validators/check-hme-coherence.js` — pipeline gate reading the activity stream
