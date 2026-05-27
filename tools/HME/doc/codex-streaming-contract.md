# Codex streaming tool-loop contract

Interactive Codex requests (`stream: true`) must stay coherent between the CLI, HME proxy logs, and OmniRoute logs.

## Contract

When HME executes a Codex tool loop server-side for a streamed request:

1. HME must open a client-visible SSE stream before or during the first server-side tool execution.
2. HME must emit at least one client-visible progress delta before the final assistant answer.
3. Visible progress may include the safe tool label and bounded result metadata, but must not stream full tool output by default.
4. HME must not forward executable duplicate tool-call events to the client while also executing the same tool server-side.
5. HME must not leak raw unsupported Claude-style tool calls such as `Bash`, `Read`, or `Agent` as client-executable calls.
6. HME must not return `508 Loop Detected` for bounded tool loops; it must finalize or return a safe bounded fallback.
7. HME must not ask the user to resend task context solely because of stale/incomplete/unsupported tool adapter noise.

## Correlation

Every Codex turn forwarded by HME should share these trace fields across response metrics and upstream request headers:

- `correlation_id`
- `session_id`
- `thread_id`
- `turn_id`
- `tool_loop_depth`
- `call_ids`
- upstream/final response id when available

HME sends equivalent upstream headers where possible:

- `x-hme-codex-correlation-id`
- `x-hme-codex-session-id`
- `x-hme-codex-thread-id`
- `x-hme-codex-turn-id`
- `x-hme-codex-tool-loop-depth`

## Hidden-loop violation

A hidden-loop violation is any streamed Codex turn where HME executes one or more server-side tool calls but records zero client-visible progress events.

Such cases are logged as:

```text
codex-hidden-tool-loop-violation
```

A healthy streamed server-side loop logs:

```text
codex-proxy-tool-loop-visible
```

and the final `response` event includes:

- `client_sse_started: true`
- `client_visible_progress_events > 0`
- `tool_loop_count > 0`
