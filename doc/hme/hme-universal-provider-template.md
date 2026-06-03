# Universal Hook Provider Template

A new host must add adapter edges; policy code must not change.

## Required checklist

1. Event extraction: convert native lifecycle/tool/stream payloads into `hme-opencode-hook/v1` events.
2. Session identity: preserve session id, cwd/project root, provider, model, and agent when available.
3. Tool/permission representation: map tool name, input, output, permission target, and risk into canonical fields.
4. Decision application path: translate universal decisions back to host outputs without silent degradation.
5. Capability map entry: classify every ABI phase as `unsupported`, `advisory`, or `enforcement`.
6. Golden fixtures: add inbound and outbound fixtures before enabling live routing.
7. Shadow parity: run comparator telemetry before live enforcement.
8. Cleanup gate: remove old host-specific policy only after parity and focused suites pass.

## Capability meanings

- `unsupported`: host cannot apply this phase/decision; safety-critical unsupported decisions fail closed.
- `advisory`: host can observe and emit telemetry/effects, but cannot enforce live behavior.
- `enforcement`: host can apply allow/deny/mutate/rewrite decisions through a translator.

## Minimal files

```text
tools/HME/omo_bridge/adapters/<host>_inbound.js
tools/HME/omo_bridge/translators/<host>_decision.js
tools/HME/tests/fixtures/universal_hooks/<host>.json
tools/HME/tests/specs/universal_hook_<host>.test.js
```
