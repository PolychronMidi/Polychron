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

This phase adds the ABI contract and validators only. It does not route live hooks through the ABI.

Implemented surfaces:

- `tools/HME/omo_bridge/contract.json`
- `tools/HME/omo_bridge/contract_validator.js`
- `tools/HME/omo_bridge/universal_event.js`
- `tools/HME/omo_bridge/universal_decision.js`
- `tools/HME/tests/specs/omo_contract.test.js`
