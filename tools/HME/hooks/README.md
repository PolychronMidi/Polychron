# HME hooks

Claude Code and Codex hooks enter through `event_kernel/*_adapter.js`. The kernel chooses native JS handlers first, then shell stages. Shell hooks source `helpers/_safety.sh` before doing anything.

Keep here only what must be a hook: pre-execution denials, lifecycle events, and terminal-facing output. Reactive enrichment belongs in `tools/HME/proxy/middleware/`.

## Layout

- `pretooluse/` -- before a tool runs; may block with exit 2 + `_emit_block`
- `posttooluse/` -- after a tool completes; logging, NEXUS state, activity emission
- `lifecycle/` -- `sessionstart`, `stop`, `precompact`, `postcompact`, `userpromptsubmit`
- `helpers/` -- shared safety, onboarding, NEXUS, tab, signal, and IPC helpers
- `direct/` -- watchdog/supervisor entrypoints launched outside normal tool hooks
- `../event_kernel/native_hooks/` -- portable JS handlers for tools and diagnostics

## Output channels

| Channel | Reaches agent? | Reaches terminal? | Use for |
|---|---|---|---|
| STDERR | Yes | Yes | LIFESAVER warnings, NEXUS transitions |
| STDOUT JSON | Yes | Yes | Pre-tool allow/block decisions |
| `_emit_block` | Yes | Yes | Hard rejection with rule + fix |
| `_emit_enrich_allow` | Yes | No | Silent KB enrichment |
| `hme.log` | No | No | Debug trail |

Use `_emit_block "reason"` only for rules the agent MUST NOT violate. For soft guidance, prefer `_emit_enrich_allow` or silent telemetry.

## Dispatch

`hooks.json` and `codex_hooks.json` are the live manifests. Sync them with:

```bash
tools/HME/scripts/sync-claude-settings.py
tools/HME/scripts/sync-codex-settings.py
```

Audit drift with the matching `audit-*settings.py` scripts. Codex user hooks may need one-time approval from `/hooks`; provider routing remains active independently through `codex_proxy`.

Proxy-up path:

```text
Host event -> *_adapter.js -> POST /hme/lifecycle -> proxy/lifecycle_bridge.js -> event_kernel/dispatcher.js
```

Proxy-down fallback:

```text
Host event -> *_adapter.js -> event_kernel/dispatcher.js
```

Both paths use the same dispatcher and policy order. Proxy HTTP middleware is absent only while the daemon is down.

### Events

| Event | Scripts fired | Notes |
|---|---|---|
| `SessionStart` | `lifecycle/sessionstart.sh` | Session orientation, state reset, bundle health. |
| `UserPromptSubmit` | `lifecycle/userpromptsubmit.sh` | Stale-state sweep, lifesaver scan, autocommit. |
| `PreToolUse` | native JS or `pretooluse/pretooluse_<tool>.sh` | Pre-execution gates can deny. |
| `PermissionRequest` | JS policy registry | Codex approval prompts reuse deny policies. |
| `PostToolUse` | `log-tool-call.sh` + native/shell handlers | Logging, NEXUS, activity, KB. |
| `PreCompact` | `lifecycle/precompact.sh` | Flush KB and snapshot. |
| `PostCompact` | `lifecycle/postcompact.sh` | Reload KB. |
| `Stop` | `proxy/stop_chain` + shell fallback | First-deny-wins stop policy chain. |

### Shell entrypoints

- `log-tool-call.sh`
- `sessionstart.sh`, `userpromptsubmit.sh`, `precompact.sh`, `postcompact.sh`, `canary.sh`
- `pretooluse_bash.sh`, `pretooluse_check_pipeline.sh`, `pretooluse_edit.sh`, `pretooluse_grep.sh`, `pretooluse_hme_primer.sh`, `pretooluse_read.sh`, `pretooluse_write.sh`
- `posttooluse_addknowledge.sh`, `posttooluse_bash.sh`, `posttooluse_edit.sh`, `posttooluse_hme_review.sh`, `posttooluse_pipeline_kb.sh`, `posttooluse_read_kb.sh`, `posttooluse_write.sh`
- `autocommit-direct.sh`, `proxy-maintenance.sh`, `proxy-supervisor.sh`, `codex-proxy-supervisor.sh`, `proxy-watchdog.sh`, `universal-pulse-supervisor.sh`

### Helpers

- `_safety.sh` -- emit/block/streak/latency machinery; source first.
- `_autocommit.sh` -- failsafe commit wrapper used by prompt/stop/direct paths.
- `_nexus.sh` -- `tmp/hme-nexus.state` EDIT/BRIEF/REVIEW tracking.
- `_check_errors_inline.sh` -- inline `hme-errors.log` scan.
- `_signals.sh` -- append-only event bus in `tools/HME/runtime/metrics/`.
- `_resolve_bg_stub.sh` -- resolves Claude Code background-command stubs.

### Supervisors (`direct/`)

Service metadata lives in `tools/HME/config/services.json`; doctors and pulse probes read that registry.

| Script | Pid file | Heartbeat | Purpose |
|---|---|---|---|
| `proxy-supervisor.sh` | `tools/HME/runtime/proxy-supervisor.pid` | `/health` q10s, 3 misses -> respawn | Keep proxy alive between sessions. |
| `codex-proxy-supervisor.sh` | `tools/HME/runtime/codex-proxy-supervisor.pid` | `codex_proxy` health poll | Keep Codex routing alive. |
| `universal-pulse-supervisor.sh` | `tools/HME/runtime/universal-pulse-supervisor.pid` | `tmp/hme-universal-pulse.heartbeat` q15s | Active proxy/worker/daemon/CPU probes. |

<!-- HME-DIR-INTENT
rules:
  - Every hook MUST `source helpers/_safety.sh` first -- provides emit/block/latency/streak machinery used by every other helper
  - Reactive tool-result enrichment belongs in `tools/HME/proxy/middleware/` -- only shell hooks for pre-execution blocks + lifecycle events
  - Use `_emit_block` sparingly -- it's a hard denial that interrupts the agent; prefer `_emit_enrich_allow` or silent activity events for soft guidance
  - Hooks must never log to `src/output/metrics/` -- operational logs go to `log/`; HME metrics go to tools/HME/runtime/metrics
  - Lifecycle hooks (stop, precompact, postcompact, sessionstart) are the ONLY reliable way to run Claude Code lifecycle logic; use the right hook for the event
-->
