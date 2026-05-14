# HME hooks

Claude Code lifecycle hooks registered in `hooks.json` -- shell scripts that fire before tool calls, after tool calls, at session start, on stop, on pre/post compact, and on user prompt submit. Every hook sources `helpers/_safety.sh` first for the standard emit/block/streak/latency machinery.

Most reactive enrichment has migrated to the proxy middleware (`tools/HME/proxy/middleware/`). What stays here: **true pre-execution rejection** (block a tool before it runs), **lifecycle events** that Claude Code delivers only via hooks, and **user-facing output** that belongs in the terminal, not the agent's context.

## Layout

- `pretooluse/` -- fires before a tool runs; can block via exit 2 + `_emit_block`
- `posttooluse/` -- fires after a tool completes; observation + NEXUS state + activity emission
- `lifecycle/` -- `sessionstart`, `stop`, `precompact`, `postcompact`, `userpromptsubmit`
- `helpers/` -- `_safety.sh`, `_onboarding.sh`, `_nexus.sh`, `_tab_helpers.sh`; shared functions sourced by every hook
- `log-tool-call.sh` -- universal tool-call logger (session-transcript.jsonl + hme.log)
- `statusline.sh` -- Claude Code status line renderer (context-meter)

## Output channels

| Channel | Reaches agent? | Reaches terminal? | Use for |
-
| STDERR | Yes | Yes | LIFESAVER warnings, NEXUS state transitions |
| STDOUT (JSON decision) | Yes | Yes | Pre-tool blocks / allows with reason |
| `_emit_block` | Yes (as denial) | Yes | Reject tool call, cite rule + fix |
| `_emit_enrich_allow` | Yes (as context) | No | Silent KB enrichment |
| `hme.log` | No (can be read) | No | Debug trail |

## Block vs warn

Use `_emit_block "reason"` + `exit 2` only for rules the agent MUST NOT violate (ellipsis-stub placeholders, secret writes, hard architectural invariants). For soft guidance, prefer `_emit_enrich_allow` or silent telemetry -- `_emit_block` burns agent attention hard.

## Dispatch tree

`.claude/settings.json` registers `bash _proxy_bridge.sh <Event>` for every Claude Code lifecycle event. The bridge POSTs the hook stdin to `http://127.0.0.1:9099/hme/lifecycle?event=<Event>` and relays the JSON response back. If the proxy is unreachable, it falls through to `direct_dispatch.sh <Event>`, which calls the same event-kernel dispatcher through `event_kernel/cli.js`.

```text
Claude Code event
       |
       v
bash _proxy_bridge.sh <Event>
       |
       +--- proxy alive? ---> POST /hme/lifecycle ---> proxy/lifecycle_bridge.js ---> event_kernel/dispatcher.js
       |
       \--- proxy down? ----> direct_dispatch.sh <Event> ---> event_kernel/cli.js ---> event_kernel/dispatcher.js
```

### Event -> scripts (proxy-up path; same scripts run on direct fallback)

| Event | Scripts fired | Notes |
|---|---|---|
| `SessionStart` | `direct/proxy-watchdog.sh`, `direct/proxy-supervisor.sh start`, `lifecycle/sessionstart.sh` | Watchdog respawns proxy; supervisor keeps it alive long-running. |
| `UserPromptSubmit` | `lifecycle/userpromptsubmit.sh`, `direct/autocommit-direct.sh userpromptsubmit`, `lifecycle/canary.sh` | Stale-state sweep, lifesaver scan, autocommit, canary. |
| `PreToolUse` | `pretooluse/pretooluse_<tool>.sh` (e.g. `_edit.sh`, `_write.sh`, `_bash.sh`) | Can deny via `_emit_block` + exit 2. |
| `PostToolUse` | `posttooluse/posttooluse_<tool>.sh` | NEXUS state, activity emission, knowledge add. |
| `PreCompact` | `lifecycle/precompact.sh` | Flush KB, snapshot. |
| `PostCompact` | `lifecycle/postcompact.sh` | Reload KB. |
| `Stop` | `lifecycle/stop/_preamble.sh` -> `detectors.sh` -> `holograph.sh` -> `lifesaver.sh` -> `evolver.sh` -> `post_hooks.sh` -> `autocommit.sh`, plus `direct/autocommit-direct.sh stop` | Detector chain runs first, then policies; can deny via decision:block. |

### Direct-mode fallback (proxy down)

`direct_dispatch.sh` owns no Event -> script routing. It resolves `PROJECT_ROOT` and calls `event_kernel/cli.js`, so proxy-up and proxy-down modes use the same dispatcher and policy order. Proxy HTTP middleware still does not run while the daemon is down, but hook routing, JS policies, bash gates, the HME-tool primer, and Stop-chain semantics stay aligned.

### Helpers

- `_safety.sh` -- emit/block/streak/latency machinery; sourced by every hook first.
- `_autocommit.sh` -- 4-channel failsafe wrapper around `git commit`; called by `userpromptsubmit.sh`, `lifecycle/stop/autocommit.sh`, `direct/autocommit-direct.sh`.
- `_nexus.sh` -- read/write `tmp/hme-nexus.state` for EDIT/BRIEF/REVIEW tracking.
- `_check_errors_inline.sh` -- inline mid-turn `hme-errors.log` scan; fires from `posttooluse_*.sh`.
- `_signals.sh` -- append-only event bus at `output/metrics/hme-signals.jsonl`.
- `_resolve_bg_stub.sh` -- resolve Claude Code's "Command running in background" stubs to real output.

### Long-running supervisors (started by `direct/`)

| Script | Pid file | Heartbeat | Purpose |
|---|---|---|---|
| `proxy-supervisor.sh` | `runtime/hme/proxy-supervisor.pid` | `/health` poll q10s, 3 misses -> respawn | Keep proxy alive between SessionStart events. |
| `universal-pulse-supervisor.sh` | `runtime/hme/universal-pulse-supervisor.pid` | `tmp/hme-universal-pulse.heartbeat` q15s, >90s stale -> respawn | Active probes for proxy/worker/daemon/CPU. |

<!-- HME-DIR-INTENT
rules:
  - Every hook MUST `source helpers/_safety.sh` first -- provides emit/block/latency/streak machinery used by every other helper
  - Reactive tool-result enrichment belongs in `tools/HME/proxy/middleware/` -- only shell hooks for pre-execution blocks + lifecycle events
  - Use `_emit_block` sparingly -- it's a hard denial that interrupts the agent; prefer `_emit_enrich_allow` or silent activity events for soft guidance
  - Hooks must never log to `output/metrics/` -- operational logs go to `log/`; metrics/ is composition data only
  - Lifecycle hooks (stop, precompact, postcompact, sessionstart) are the ONLY reliable way to run Claude Code lifecycle logic; use the right hook for the event
-->
