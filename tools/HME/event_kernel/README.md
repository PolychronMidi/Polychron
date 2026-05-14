# HME Event Kernel

The event kernel is the canonical dispatcher for HME lifecycle and tool events.
It exists outside `proxy/` so the proxy, Claude Code hooks, direct fallback, and
future agent-CLI adapters can share one routing table.

## Contract

`dispatcher.dispatchEvent(eventName, stdinJson)` returns:

```json
{"stdout":"","stderr":" ","exit_code":0}
```

Adapters translate that result into their host protocol. For example,
`cli.js` converts PreToolUse/Stop deny JSON into Claude-compatible exit `2`
with the deny reason on stderr.

## Adapters

- Proxy-up Claude Code hooks: `_proxy_bridge.sh` posts to `/hme/lifecycle`;
  `proxy/lifecycle_bridge.js` calls `event_kernel/dispatcher.js`.
- Proxy-down direct mode: `hooks/direct_dispatch.sh` calls
  `event_kernel/cli.js` directly.
- Compatibility: `proxy/hook_bridge.js` and `proxy/hook_envelope.js` re-export
  the event-kernel modules for old imports.

## Single Source Of Truth

Do not add Event -> script routing tables in adapters. Add or change routing in
`dispatcher.js`; adapters should only handle transport, protocol translation,
root resolution, and fail-loud behavior.
