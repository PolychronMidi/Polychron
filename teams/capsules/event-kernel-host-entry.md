# Context Capsule: review event-kernel host entry/adapters

## artifact
tools/HME/event_kernel/host_hook_entry.js and tools/HME/event_kernel/host_adapter_common.js -- the host hook entrypoint and shared adapter plumbing that drain stdin, suppress lifecycle hooks for team peers, choose host adapters, relay lifecycle events through /hme/lifecycle, and fall back to direct event-kernel dispatch when the proxy is unavailable.

## goal
Find decision-changing correctness/safety flaws in the event-kernel host-entry path that could hang hooks, drop or corrupt hook decisions, leak peer lifecycle events into the driver lifecycle, fail open/closed incorrectly during proxy outages, or route a host event through the wrong adapter. Cite function/block + fix.

## constraints
This code runs inside host hook processes; it must be bounded, non-recursive, and valid for Claude/Codex/OpenCode. Team peers are driver forks with full context/tools but HME_TEAM_PEER=1 must suppress driver lifecycle hooks for their ephemeral `claude -p` sub-sessions without bypassing tool/permission policy hooks. Proxy-down fallback is intentional, but fallback must preserve valid host hook output. Avoid style findings and do not review dispatcher.js internals here except where host_adapter_common calls lifecycle.dispatch().

## rubric
Classify P0/P1/P2. For each finding: function/block, exact failure mode, one-line fix. Reject speculative host behavior without evidence. Prefer unbounded waits/buffers, env/root resolution, stale process state, stdin handling, proxy timeout/fallback, and peer lifecycle bypass bugs.

## coverage
included: full source for host_hook_entry.js including arg, eventFromArg, adapterForHost, shouldBypassPeerLifecycle, failSafeStdout, readStdinBounded, spawnSync timeout/killSignal, stdin forwarding, stdout/stderr relay, and exit status; full source for host_adapter_common.js including OversizeStdinError, _stdinTooLargeResult, readStdin, resolveRoot, append, maintenanceActive, postLifecycle response cap, _postLifecycleOrNull, and runHostAdapter.
excluded: dispatcher.js internals, host-specific adapter finalRelay normalization, hook shell scripts, proxy /hme/lifecycle route implementation, ask-peer.sh.

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/event_kernel/host_hook_entry.js
- tools/HME/event_kernel/host_adapter_common.js

