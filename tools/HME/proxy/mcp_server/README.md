# `mcp_server/` — minimal MCP skeleton

In-process MCP (Model Context Protocol) server, hosted by `hme_proxy.js`
on the proxy port. Currently dormant — no `.mcp.json` registers this
server with Claude Code; HME tools reach the agent via Bash(`i/<tool>`)
shell wrappers + tool injection, not MCP. See repo-level [README.md](../../../../README.md)
and [doc/HME.md](../../../../doc/HME.md) for the active surface.

## What's here

Four files, ≤200 lines each, single concern per file:

| File           | Concern                                                       |
| --- | --- |
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

## Filesystem-IPC hybrid (implemented, opt-in)

The MCP wire spec at the boundary (Claude Code ↔ proxy) is HTTP/SSE
and that's preserved. But the INTERNAL leg (proxy ↔ worker tool
dispatch) can route through the existing
[`tools/HME/service/worker_queue.py`](../../service/worker_queue.py)
filesystem watcher instead of HTTP. Activate via:

```
# .env
HME_WORKER_TRANSPORT=hybrid
```

Routing decision (in [`../_worker_transport.js`](../_worker_transport.js)):
- `POST /tool/<name>`, `POST /enrich`, `POST /enrich_prompt`,
  `POST /audit` → filesystem queue (worker_queue.py drains)
- Everything else (`GET /tools/list`, `GET /health`, `GET /version`,
  `GET /transcript`, `POST /reindex`, etc.) → HTTP

Wire (driven by worker_queue.py's existing schema):
- Request: `tmp/hme-worker-queue/<endpoint>/<jobId>.json` with
  `{jobId, endpoint, body, ts}` — atomic temp+rename
- Result: `tmp/hme-worker-results/<jobId>.json` — atomic temp+rename;
  caller unlinks after read

Tradeoffs vs HTTP-only:
- ✅ SIGKILL-survivable: if the worker dies mid-tool-call, the job
  file stays in the queue; the next worker boot's watcher picks it up
- ✅ Audit trail: every tool call leaves a result file
- ✅ No socket lifecycle issues (ECONNRESET, half-open sockets, port
  collisions); proxy and worker just read/write files
- ✅ Atomic-rename writes — never see partial reads
- ❌ ~1-5ms FS tax per call (negligible vs typical tool-call wall-time
  which is hundreds of ms to seconds)
- ❌ Polling-based on the worker side (50ms default; tunable via
  `HME_WORKER_FS_POLL_MS`) — not inotify

The MCP wire spec is fully unaffected: external clients keep talking
HTTP/SSE to `/mcp/*`. Same pattern as `_proxy_bridge.sh` ↔ proxy ↔
direct dispatch — boundary stays standards-compliant; internal legs
use whatever transport is most bug-proof for their workload.

Coverage: routing logic tested in
[`tools/HME/tests/specs/worker_transport_router.test.js`](../../tests/specs/worker_transport_router.test.js)
— 5 cases including hybrid-routes-tool-to-FS and hybrid-keeps-health-on-HTTP.

## Tests

No dedicated tests for this directory — the HME unit tests
(`tools/HME/tests/specs/`) exercise worker dispatch via
`worker_client.js` (which now shares `_worker_http.js`), so the shared
plumbing is covered transitively. Adding RuleTester-style fixtures for
the JSON-RPC framing is a future opportunity.
