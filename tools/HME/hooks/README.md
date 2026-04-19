# HME hooks

Claude Code lifecycle hooks registered in `hooks.json` — shell scripts that fire before tool calls, after tool calls, at session start, on stop, on pre/post compact, and on user prompt submit. Every hook sources `helpers/_safety.sh` first for the standard emit/block/streak/latency machinery.

Most reactive enrichment has migrated to the proxy middleware (`tools/HME/proxy/middleware/`). What stays here: **true pre-execution rejection** (block a tool before it runs), **lifecycle events** that Claude Code delivers only via hooks, and **user-facing output** that belongs in the terminal, not the agent's context.

## Layout

- `pretooluse/` — fires before a tool runs; can block via exit 2 + `_emit_block`
- `posttooluse/` — fires after a tool completes; observation + NEXUS state + activity emission
- `lifecycle/` — `sessionstart`, `stop`, `precompact`, `postcompact`, `userpromptsubmit`
- `helpers/` — `_safety.sh`, `_onboarding.sh`, `_nexus.sh`, `_tab_helpers.sh`; shared functions sourced by every hook
- `log-tool-call.sh` — universal tool-call logger (session-transcript.jsonl + hme.log)
- `statusline.sh` — Claude Code status line renderer (context-meter)

## Output channels

| Channel | Reaches agent? | Reaches terminal? | Use for |
-
| STDERR | Yes | Yes | LIFESAVER warnings, NEXUS state transitions |
| STDOUT (JSON decision) | Yes | Yes | Pre-tool blocks / allows with reason |
| `_emit_block` | Yes (as denial) | Yes | Reject tool call, cite rule + fix |
| `_emit_enrich_allow` | Yes (as context) | No | Silent KB enrichment |
| `hme.log` | No (can be read) | No | Debug trail |

## Block vs warn

Use `_emit_block "reason"` + `exit 2` only for rules the agent MUST NOT violate (ellipsis-stub placeholders, secret writes, hard architectural invariants). For soft guidance, prefer `_emit_enrich_allow` or silent telemetry — `_emit_block` burns agent attention hard.

<!-- HME-DIR-INTENT
rules:
  - Every hook MUST `source helpers/_safety.sh` first — provides emit/block/latency/streak machinery used by every other helper
  - Reactive tool-result enrichment belongs in `tools/HME/proxy/middleware/` — only shell hooks for pre-execution blocks + lifecycle events
  - Use `_emit_block` sparingly — it's a hard denial that interrupts the agent; prefer `_emit_enrich_allow` or silent activity events for soft guidance
  - Hooks must never log to `metrics/` — operational logs go to `log/`; metrics/ is composition data only
  - Lifecycle hooks (stop, precompact, postcompact, sessionstart) are the ONLY reliable way to run Claude Code lifecycle logic; use the right hook for the event
-->
