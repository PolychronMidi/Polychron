# Codex tool-loop graph

HME's Codex tool loop is represented as an explicit small graph instead of unbounded recursive proxy branches.

This is LangGraph-style orchestration implemented in-process for the current CommonJS proxy. The graph shape is intentionally small so it can later be swapped to LangGraphJS `StateGraph` without changing the proxy contract.

## State

The graph state records:

- `correlation_id`, `session_id`, `thread_id`, `turn_id`
- route and response kind (`json` / `sse`)
- current `tool_loop_depth` (observability only — no cap is imposed)
- collected tool calls
- actionable tool calls
- skipped malformed tool calls
- duplicate call IDs
- approval-gated calls
- selected decision and invariant

## Nodes

```text
inspect_response
  -> execute_tools
  -> malformed_tool_fallback
  -> duplicate_tool_fallback
  -> interrupt_before_tool
  -> final
```

The proxy only executes tools after the graph returns `execute_tools`. There is no depth limit and no "finalization" stage; the tool loop runs as long as the upstream model keeps requesting tools, the same way the Anthropic/Claude route does. Context pressure is handled exclusively by the shared `passthrough_compact` path at the configured high-water fraction.

## Invariants

The graph encodes invariants directly rather than relying on detector sprawl:

- `visible_progress_required`: streamed server-side tool execution must emit client-visible progress.
- `no_duplicate_tool_execution`: a call ID already executed in the turn cannot execute again.
- `no_raw_tool_leakage`: malformed tool calls are converted into a fallback path, not raw client tool calls.
- `human_approval_gate`: destructive or write-capable tools can interrupt before execution when HITL is enabled.

## Checkpoints

Each graph transition writes best-effort durable checkpoints to:

```text
tools/HME/runtime/codex-tool-loop-checkpoints.jsonl
tools/HME/runtime/codex-tool-loop-checkpoints/<correlation_id>.json
```

Checkpoints are compact observability records, not full prompt/history dumps. They contain routing state, call summaries, decision, invariant, and trace IDs.

## Human approval

Set:

```text
HME_CODEX_HITL=1
```

to make the graph return `interrupt_before_tool` before:

- `Edit`
- `Write`
- destructive `Bash` commands such as `rm`, `git reset --hard`, `git clean`, force push, recursive chmod/chown, etc.

Current proxy behavior for an interrupt is a bounded final response with the checkpoint ID. A future UI/Studio bridge can resume from the checkpoint after approval.

## LangGraphJS migration seam

The current module is:

```text
tools/HME/proxy/codex_tool_loop_graph.js
```

It exposes a pure decision function:

```js
runCodexToolLoopGraph({ target, source, parsed, calls, executed_call_ids, response_kind })
```

This seam mirrors a future LangGraphJS `StateGraph`: state in, node transitions, checkpoint writes, decision out.
