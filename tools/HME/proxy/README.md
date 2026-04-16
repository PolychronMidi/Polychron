# HME Inference Proxy

Phase 2 of [../../doc/openshell_features_to_mimic.md](../../../doc/openshell_features_to_mimic.md). A thin HTTP chokepoint between Claude Code and the Anthropic API — observes every inference call, emits structured events into `metrics/hme-activity.jsonl`, and detects coherence violations (write-bearing tool calls in conversations that never invoked HME read).

## What it does

1. **Logs every inference call** — `inference_call` event per POST to `/v1/messages`, with model, message count, tool call count, and session hash.
2. **Scans message history** — looks for `mcp__HME__read` / `mcp__HME__before_editing` tool_use blocks before any `Edit` / `Write` / `NotebookEdit` / `mcp__HME__edit` tool_use. If a write appears without a prior read, emits `coherence_violation` with `source=proxy`.
3. **Passes everything through** — streaming SSE responses pipe verbatim so token latency is preserved. Upstream errors surface as 502 with a JSON error body.

## Running it

```bash
# Start the proxy
node tools/HME/proxy/hme_proxy.js

# Point Claude Code at it
export ANTHROPIC_BASE_URL=http://127.0.0.1:9099
claude    # or however you launch Claude Code
```

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `HME_PROXY_PORT` | `9099` | Listen port |
| `HME_PROXY_UPSTREAM_HOST` | `api.anthropic.com` | Upstream host |
| `HME_PROXY_UPSTREAM_PORT` | `443` | Upstream port |
| `HME_PROXY_UPSTREAM_TLS` | `1` | `0` to use plain HTTP upstream (tests) |
| `CLAUDE_PROJECT_DIR` | `/home/jah/Polychron` | Resolves `tools/HME/activity/emit.py` |

## Testing

Test mode reads a JSON payload from stdin and prints the scan result without listening:

```bash
node tools/HME/proxy/hme_proxy.js --test <<'EOF'
{"model":"claude","messages":[{"role":"user","content":"hi"},
 {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{}}]}]}
EOF
```

Exit code `0` = clean, `1` = violation detected.

## Design notes

**Stateless.** No in-memory session map. Every request carries the full message history, so we scan that history rather than tracking cross-call state. A restart loses nothing.

**Session identity** is a stable 32-bit hash of the first 500 chars of the first user message. Same conversation → same hash. Good enough for correlating events in the activity stream.

**No system prompt injection in v1.** Observability only — the proxy does not modify requests. Injection is a v2 enhancement once the observation signal has been validated.

**Emit best-effort.** `emit.py` calls are fire-and-forget (detached + unref). If Python is missing or the script fails, the proxy still forwards the request — activity logging never blocks traffic.

## Related files

- `tools/HME/activity/emit.py` — shared event emitter CLI
- `tools/HME/mcp/server/tools_analysis/activity_digest.py` — reader (`status mode='activity'`)
- `scripts/pipeline/validators/check-hme-coherence.js` — Phase 3 pipeline gate that reads the same JSONL
