# HME hooks

Claude Code and Codex lifecycle hooks both route through the event-kernel
adapter for their host. The kernel routes to native handlers or the remaining
shell stages. Every remaining shell hook sources `helpers/_safety.sh` first for
the standard emit/block/streak/latency machinery.

Most reactive enrichment has migrated to the proxy middleware (`tools/HME/proxy/middleware/`). What stays here: **true pre-execution rejection** (block a tool before it runs), **lifecycle events** that Claude Code delivers only via hooks, and **user-facing output** that belongs in the terminal, not the agent's context.

## Layout

- `pretooluse/` -- fires before a tool runs; can block via exit 2 + `_emit_block`
- `posttooluse/` -- fires after a tool completes; observation + NEXUS state + activity emission
- `lifecycle/` -- `sessionstart`, `stop`, `precompact`, `postcompact`, `userpromptsubmit`
- `helpers/` -- `_safety.sh`, `_onboarding.sh`, `_nexus.sh`, `_tab_helpers.sh`; shared functions sourced by every hook
- `log-tool-call.sh` -- universal tool-call logger (session-transcript.jsonl + hme.log)
- `../event_kernel/statusline.js` -- Claude Code status line renderer (context-meter)
- `../event_kernel/native_hooks/` -- portable JS handlers for Agent, TodoWrite, ToolSearch, Glob streak, and diagnostics

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

`hooks.json` is the source of truth for live Claude Code hook registration.
Run `scripts/sync-claude-settings.py` to materialize it into
`~/.claude/settings.json`; `scripts/audit-claude-settings.py` fails if live
settings drift from this manifest.

`codex_hooks.json` is the source of truth for live Codex hook registration.
Run `scripts/sync-codex-settings.py` to materialize it into
`~/.codex/hooks.json` and route Codex Responses traffic through the
`codex_proxy` service. `scripts/audit-codex-settings.py` fails if the hooks or
provider config drift. Codex user hooks are non-managed hooks; if Codex reports
that hooks need review, approve them once from `/hooks` in the interactive CLI.
The `hme_codex` provider proxy is active independently of that hook review.

`.claude/settings.json` registers `node event_kernel/claude_adapter.js <Event>` for every Claude Code lifecycle event. The adapter POSTs hook stdin to the proxy lifecycle URL derived from `tools/HME/config/services.json` and relays the JSON response back. If the proxy is unreachable, it calls the same event-kernel dispatcher directly.

`.codex/hooks.json` registers `node event_kernel/codex_adapter.js <Event>` for
every supported Codex lifecycle/tool event. The Codex adapter uses the same
`/hme/lifecycle` bridge and same direct fallback, then strips or translates
Claude-only fields such as `updatedInput` before returning output to Codex.

Proxy health is bundle health: `services.json` marks `worker` as a required
child of `proxy`, so watchdogs and doctors treat proxy-up/worker-down as
unhealthy and restart the proxy bundle rather than reporting partial success.

Subprocess transfer uses filesystem IPC under `runtime/hme/event-ipc/`; hook
payloads are written once and redirected into child processes from a file.

```text
Claude Code event
       |
       v
node event_kernel/claude_adapter.js <Event>
       |
       +--- proxy alive? ---> POST /hme/lifecycle ---> proxy/lifecycle_bridge.js ---> event_kernel/dispatcher.js
       |
       \--- proxy down? ----> event_kernel/dispatcher.js
```

```text
Codex event
       |
       v
node event_kernel/codex_adapter.js <Event>
       |
       +--- proxy alive? ---> POST /hme/lifecycle ---> proxy/lifecycle_bridge.js ---> event_kernel/dispatcher.js
       |
       \--- proxy down? ----> event_kernel/dispatcher.js
```

### Event -> scripts (proxy-up path; same scripts run on direct fallback)

| Event | Scripts fired | Notes |
|---|---|---|
| `SessionStart` | `lifecycle/sessionstart.sh` | Session orientation, state reset, worker/proxy health surface. |
| `UserPromptSubmit` | `lifecycle/userpromptsubmit.sh` | Stale-state sweep, lifesaver scan, autocommit. |
| `PreToolUse` | `event_kernel/native_hooks/*` or `pretooluse/pretooluse_<tool>.sh` | Native first where ported; remaining shell gates can deny via `_emit_block` + exit 2. |
| `PermissionRequest` | JS policy registry | Codex approval prompts reuse the same deny policies where possible. |
| `PostToolUse` | `log-tool-call.sh` + native handlers or `posttooluse/posttooluse_<tool>.sh` | Universal logging, NEXUS state, activity emission, knowledge add. |
| `PreCompact` | `lifecycle/precompact.sh` | Flush KB, snapshot. |
| `PostCompact` | `lifecycle/postcompact.sh` | Reload KB. |
| `Stop` | `proxy/stop_chain` policies, with remaining shell stages behind `shell_policy.js` | First-deny-wins policy chain; shell stage input uses filesystem IPC. |

### Script inventory

Directly invoked shell entrypoints:

- `log-tool-call.sh`
- `sessionstart.sh`
- `userpromptsubmit.sh`
- `precompact.sh`
- `postcompact.sh`
- `canary.sh`
- `pretooluse_bash.sh`
- `pretooluse_check_pipeline.sh`
- `pretooluse_edit.sh`
- `pretooluse_grep.sh`
- `pretooluse_hme_primer.sh`
- `pretooluse_read.sh`
- `pretooluse_write.sh`
- `posttooluse_addknowledge.sh`
- `posttooluse_bash.sh`
- `posttooluse_edit.sh`
- `posttooluse_hme_review.sh`
- `posttooluse_pipeline_kb.sh`
- `posttooluse_read_kb.sh`
- `posttooluse_write.sh`
- `autocommit-direct.sh`
- `proxy-maintenance.sh`
- `proxy-supervisor.sh`
- `proxy-watchdog.sh`
- `universal-pulse-supervisor.sh`

### Direct-mode fallback (proxy down)

`claude_adapter.js` owns no Event -> hook routing. It resolves `PROJECT_ROOT` and calls `event_kernel/dispatcher.js`, so proxy-up and proxy-down modes use the same dispatcher and policy order. Proxy HTTP middleware still does not run while the daemon is down, but hook routing, JS policies, bash gates, the HME-tool primer, and Stop-chain semantics stay aligned.

### Helpers

- `_safety.sh` -- emit/block/streak/latency machinery; sourced by every hook first.
- `_autocommit.sh` -- 4-channel failsafe wrapper around `git commit`; called by `userpromptsubmit.sh`, `lifecycle/stop/autocommit.sh`, `direct/autocommit-direct.sh`.
- `_nexus.sh` -- read/write `tmp/hme-nexus.state` for EDIT/BRIEF/REVIEW tracking.
- `_check_errors_inline.sh` -- inline mid-turn `hme-errors.log` scan; fires from `posttooluse_*.sh`.
- `_signals.sh` -- append-only event bus at `output/metrics/hme-signals.jsonl`.
- `_resolve_bg_stub.sh` -- resolve Claude Code's "Command running in background" stubs to real output.

### Long-running supervisors (started by `direct/`)

Service metadata is centralized in `tools/HME/config/services.json`. The table
below is orientation only; doctors and pulse probes read the registry.

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
