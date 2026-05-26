# HME OpenCode Universal Hook ABI

HME owns `hme-opencode-hook/v1` as the canonical bridge contract between native hooks, proxy surfaces, OMO, and OpenCode-compatible plugins.

## Boundary

The ABI is an internal HME contract. OpenCode compatibility shapes the phase names and plugin-facing concepts, but HME keeps final authority over lifecycle, stop-chain, tool safety, and stream rewriting.

## Core phases

These phases mirror OpenCode-compatible hook concepts:

- `chat.params` -- request/chat parameter observation or mutation.
- `permission.ask` -- permission mediation before risky actions.
- `tool.execute.before` -- pre-tool execution policy checks.
- `tool.execute.after` -- post-tool observation and validation.

## HME extension phases

These phases are mandatory HME extensions, not optional plugin conveniences:

- `stop.before` -- stop-chain and lifecycle completion enforcement.
- `stream.text_block` -- buffered stream text-block allow/drop/rewrite decisions.

They are explicit because existing HME semantics are stricter than generic OpenCode hooks. External plugins may participate only through declared capabilities; they cannot override mandatory HME denials.

## Observational phases

The contract also reserves low-risk observation phases for migration and shadow parity:

- `session.start`
- `session.end`
- `message.input`
- `message.output`
- `stream.delta`
- `policy.evaluate`
- `telemetry.event`

## Decision kinds

Universal hook decisions are normalized before host-specific translation:

- `allow`
- `deny`
- `modify`
- `rewrite`
- `drop`
- `inject`
- `ask_permission`
- `defer`

Provider adapters translate these decisions into Claude, Codex, Anthropic, OpenAI, OpenCode, or proxy-specific behavior. Unsupported host decisions must be explicit, never silent.

## Current scope

This phase adds the ABI contract, validators, OpenCode shadow-mode routing, and
env-gated live application for the small set of decisions HME can safely express
as HME-owned hook responses.

Implemented surfaces:

- `tools/HME/omo_bridge/contract.json`
- `tools/HME/omo_bridge/contract_validator.js`
- `tools/HME/omo_bridge/universal_event.js`
- `tools/HME/omo_bridge/universal_decision.js`
- `tools/HME/omo_bridge/shadow_runtime.js`
- `tools/HME/event_kernel/dispatcher.js`
- `tools/HME/tests/specs/omo_contract.test.js`

Shadowed dispatcher events:

- `SessionStart` -> `session.start`
- `Stop` -> `stop.before`
- `PreToolUse` -> `tool.execute.before`
- `PermissionRequest` -> `permission.ask`
- `PostToolUse` -> `tool.execute.after`

Enable shadow mode with `HME_OMO_ENABLED=1` and `HME_OMO_MODE=shadow`. Configure
the OMO source using `HME_OMO_SOURCE=path` plus `HME_OMO_PATH`, or
`HME_OMO_SOURCE=package` plus `HME_OMO_PACKAGE`. Optional controls are
`HME_OMO_REQUIRED_VERSION`, `HME_OMO_TIMEOUT_MS`, `HME_OMO_PHASES`, and
`HME_OMO_PRELOAD`. Per-phase timeout variables use the phase name uppercased
with dots replaced by underscores, for example
`HME_OMO_TIMEOUT_TOOL_EXECUTE_BEFORE_MS`. `HME_OMO_TOOL_BEFORE_WARM_ONLY=1`
skips cold `tool.execute.before` shadow observation until SessionStart preload
has initialized OMO.

In this workspace the installed package path is the current real-entrypoint
smoke target: `HME_OMO_SOURCE=package` and
`HME_OMO_PACKAGE=oh-my-openagent`. The development checkout at
`tools/oh-my-openagent` may not have `dist/index.js` until it is built. Use a
larger timeout, for example `HME_OMO_TIMEOUT_MS=10000`, when measuring cold
`tool.execute.before` startup.

HME remains authoritative. Shadow decisions, mutations, denials, plugin load
errors, invalid events, and timeouts are telemetry only and cannot change live
allow/deny, stop-chain, stream rewriting, permissions, provider routing,
secret/path policy, or capability filtering.

Enable live mode with `HME_OMO_ENABLED=1` and `HME_OMO_MODE=live`. Live mode uses
the same source and timeout controls but only applies supported decisions after
normalization and capability validation:

- `PreToolUse` / `tool.execute.before`: `deny`, or `modify` with target `tool.input`.
- `PermissionRequest` / `permission.ask`: `deny`.
- `Stop` / `stop.before`: `deny`, and only when the HME stop-chain did not already block.

OMO live failures are fail-open: missing builds, dependency/version failures,
invalid events, plugin errors, timeouts, and unsupported decisions fall through
to HME's native hook chain. Modified tool input is fed through downstream HME
write/policy/native-hook validation before the modification is returned to the
host. OMO does not bypass HME stop-chain, provider routing, stream rewriting,
permission policy, secret/path policy, or capability filtering.

Operational shadow telemetry is compact by design. HME writes phase, status,
decision kind, plugin result statuses, duration, and hashes to
`omo-shadow-decisions.jsonl` in the HME runtime directory. It does not write raw
messages, prompts, tool arguments, command strings, patches, or reasons. Use
`node tools/HME/scripts/omo-shadow-status.js` for recent status, decision, and
latency summaries. Add `--fail-on-unhealthy` with thresholds such as
`--max-timeout-rate` and `--max-p95-ms` to use the same data as a rollout gate.

Future expansion of live application must remain separately enabled,
phase-scoped, and tested against safety boundaries. External OMO output may not
override HME denials or mutate safety-critical surfaces unless HME explicitly
converts that observation into an HME-owned decision after policy validation.
