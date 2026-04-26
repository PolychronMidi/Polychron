# `mcp_server/` — minimal MCP skeleton

In-process MCP (Model Context Protocol) server, hosted by `hme_proxy.js`
on the proxy port. Currently dormant — no `.mcp.json` registers this
server with Claude Code; HME tools reach the agent via Bash(`i/<tool>`)
shell wrappers + tool injection, not MCP. See repo-level [README.md](../../../../README.md)
and [doc/HME.md](../../../../doc/HME.md) for the active surface.

## What's here

Four files, ≤200 lines each, single concern per file:

| File           | Concern                                                       |
| -------------- | ------------------------------------------------------------- |
| `index.js`     | HTTP route handler for `/mcp/sse` + `/mcp/messages` + `/mcp/health` |
| `session.js`   | session-id ↔ SSE response stream map; 10-min TTL reaper        |
| `protocol.js`  | JSON-RPC + SSE framing primitives                             |
| `dispatcher.js`| forwards `tools/list` + `tools/call` to the Python worker    |

Low-level worker HTTP plumbing lives in [`../_worker_http.js`](../_worker_http.js)
(shared with `../worker_client.js` so both MCP and enrichment paths use
the same socket/timeout/JSON discipline).

## Activating

```bash
# 1. Drop a Claude Code MCP config:
cat > .mcp.json <<EOF
{
  "mcpServers": {
    "hme": {
      "transport": { "type": "sse", "url": "http://127.0.0.1:9099/mcp/sse" }
    }
  }
}
EOF
# 2. Restart Claude Code; HME tools appear under the `hme` MCP namespace.
```

## Why dormant

The previous fastmcp-based path had persistent bugs (transport hangs,
schema-cache desync, memory leaks under reload). The proxy-native
re-implementation in this directory is the minimal-correct skeleton.
HME's primary surface migrated to `i/<tool>` Bash wrappers because:

- Bash wrappers run inside the agent's session-budget (Max subscription),
  not raw API quota
- No long-lived SSE stream to manage; each `i/<tool>` invocation is
  independent and can't desync
- Stop-hook gates and policies hook into Bash execution naturally

The MCP route is preserved as a known-working fallback for users who
prefer the MCP-native UX, but is not the recommended path.

## Filesystem-IPC option (future, not implemented)

For maximum bug-proofing the worker dispatch could move from HTTP →
filesystem queue, mirroring the dispatcher pattern at
[`tools/HME/scripts/buddy_dispatcher.py`](../../scripts/buddy_dispatcher.py):

```
tmp/hme-tool-queue/
  pending/<req-id>.json          # {tool, args, timestamp}
  processing/<req-id>.json
  done/<req-id>.json             # {ok, result} | {ok:false, error}
```

Tradeoffs vs the current HTTP path:
- ✅ No port collisions, no stuck sockets, no transport-error class
- ✅ Atomic-mv claim semantics; supervisor can SIGKILL+restart worker
  mid-call without losing the request (it stays in `pending/`)
- ✅ Auditable (every call leaves a file trail)
- ❌ Higher latency per call (filesystem syscalls vs localhost HTTP, ~1-5ms tax)
- ❌ More complex polling logic on both sides
- ❌ Doesn't match the MCP wire spec (which mandates SSE over HTTP)

For the dormant MCP path specifically, filesystem-IPC isn't a fit
because the spec REQUIRES HTTP/SSE. Where filesystem-IPC IS the
right tool: HME-side internal worker dispatches that don't need to
match an external protocol. Already adopted there (see
`buddy_dispatcher.py`).

## Tests

No dedicated tests for this directory — the HME unit tests
(`tools/HME/tests/specs/`) exercise worker dispatch via
`worker_client.js` (which now shares `_worker_http.js`), so the shared
plumbing is covered transitively. Adding RuleTester-style fixtures for
the JSON-RPC framing is a future opportunity.
