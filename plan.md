# OMO/OpenCode Universal Hook Foundation Plan

Status: the initial ABI contract, golden fixture backbone, and adapter module phase are complete. `hme-opencode-hook/v1` is defined in `tools/HME/omo_bridge/contract.json`, validated by `contract_validator.js`, with event/decision validators, golden roundtrip fixtures, inbound adapters, outbound translators, and focused OMO tests. Live hook routing is unchanged.

This plan covers the remaining migration from OMO bridge to HME-owned OpenCode-compatible universal hook foundation.

## Operating invariants

- HME owns final enforcement. OpenCode compatibility shapes the ABI; it does not weaken HME policy.
- Mandatory HME denials outrank plugin allows.
- Provider-specific behavior stays at adapter/translator edges.
- Shadow mode precedes live routing for every enforcement phase.
- Unsupported host decisions are explicit failures or telemetry, never silent no-ops.
- Stream/SSE routing moves last.
- Every phase ships tests before live behavior changes.

## Completed initial phase

Implemented and verified:

- Versioned ABI: `hme-opencode-hook/v1`.
- Core phases: `chat.params`, `permission.ask`, `tool.execute.before`, `tool.execute.after`.
- HME extensions: `stop.before`, `stream.text_block`.
- Observational reserved phases: `session.start`, `session.end`, `message.input`, `message.output`, `stream.delta`, `policy.evaluate`, `telemetry.event`.
- Universal event validator: `tools/HME/omo_bridge/universal_event.js`.
- Universal decision validator: `tools/HME/omo_bridge/universal_decision.js`.
- Contract validator rejects missing/unknown ABI versions.
- HME extension phases documented in `doc/hme-opencode-universal-hook-abi.md`.
- Existing OMO bridge tests plus new ABI tests pass.

## Phase 1: golden adapter fixture backbone

Status: complete.

Goal: make provider translation testable before routing any live behavior through the ABI.

### Work

- Add fixtures under `tools/HME/tests/fixtures/universal_hooks/`.
- Cover inbound native event to universal event for:
  - Claude pre-tool.
  - Claude stop.
  - Codex tool/lifecycle event.
  - Anthropic proxy request.
  - Anthropic stream text block.
  - OpenAI tool/function call.
  - OpenCode/OMO native hook event.
- Cover universal decision to host output for:
  - deny.
  - allow.
  - modify `chat.params`.
  - drop/rewrite `stream.text_block` where supported.
- Add `tools/HME/tests/specs/universal_hook_adapters.test.js`.

### Acceptance

- Fixtures are deterministic and small.
- No live routing changes.
- Tests prove adapter shape for every supported host family.
- Fixture expected outputs include ABI version and phase.
- Missing required event fields are rejected by validators.

## Phase 2: adapter modules

Status: complete.

Goal: formalize inbound/outbound seams without changing behavior.

### Work

Add focused modules:

```text
tools/HME/omo_bridge/adapters/claude_inbound.js
tools/HME/omo_bridge/adapters/codex_inbound.js
tools/HME/omo_bridge/adapters/anthropic_inbound.js
tools/HME/omo_bridge/adapters/openai_inbound.js
tools/HME/omo_bridge/adapters/opencode_inbound.js
tools/HME/omo_bridge/translators/claude_decision.js
tools/HME/omo_bridge/translators/codex_decision.js
tools/HME/omo_bridge/translators/anthropic_decision.js
tools/HME/omo_bridge/translators/openai_decision.js
tools/HME/omo_bridge/translators/opencode_decision.js
```

### Acceptance

- Each adapter consumes one host shape and emits a validated universal event.
- Each translator consumes one universal decision and emits a host-shaped result.
- Translators use a host capability map.
- Unsupported decisions return explicit unsupported-result objects.
- No adapter file exceeds 350 LOC.

## Phase 3: host capability map

Status: scaffolded by Phase 2; full capability matrix hardening is next.

Goal: make host limits explicit before plugins or routing rely on decisions.

### Work

- Add `tools/HME/omo_bridge/host_capabilities.js`.
- Define supported decision kinds by host and phase.
- Expose helpers:
  - `supportsDecision(host, phase, decision)`.
  - `unsupportedDecision(host, phase, decision)`.
- Add tests for every phase in `hme-opencode-hook/v1`.

### Acceptance

- Claude/Codex native hooks cannot silently claim unsupported `chat.params` mutation.
- Proxy hosts explicitly support request mutation and stream rewrite where implemented.
- OpenCode host supports direct OpenCode-compatible phases.
- Unsupported safety-critical denials fail closed where applicable.

## Phase 4: shadow comparator

Goal: compare native HME decisions against universal ABI decisions without affecting live behavior.

### Work

- Upgrade `tools/HME/proxy/middleware/20a_omo_shadow_bridge.js` into a parity comparator.
- Add compact telemetry events:
  - `universal_hook.shadow_match`.
  - `universal_hook.shadow_mismatch`.
  - `universal_hook.adapter_error`.
- Compare reason codes and decision kinds, not full bulky payloads.
- Ensure shadow path cannot block or mutate live flow.

### Acceptance

- Shadow comparator is read-only.
- Mismatch logs include host, phase, decision kind, reason code, and adapter name.
- Payloads are redacted or summarized.
- Tests cover match, mismatch, adapter error, and shadow disabled.

## Phase 5: OpenCode-compatible plugin host shell

Goal: run project/OpenCode-shaped plugins through HME-controlled capability and decision normalization.

### Work

- Evolve `tools/HME/omo_bridge/opencode_host.js`.
- Register plugins by phase.
- Run plugins in deterministic order.
- Normalize plugin outputs through `universal_decision.js`.
- Enforce capability declarations.
- Add per-phase timeout handling.
- Route side effects through approved `effects`, never direct unchecked mutation.

### Acceptance

- Plugin thrown errors are contained.
- Plugin timeout behavior is phase-specific.
- Observe-only plugins cannot deny, mutate, or rewrite.
- Invalid plugin decisions are rejected.
- Mandatory HME kernel plugins outrank optional plugins.
- Tests cover allow, deny, modify, invalid decision, timeout, throw, and capability violation.

## Phase 6: decision resolver

Goal: deterministic composition of multiple HME/plugin decisions.

### Work

- Add `tools/HME/omo_bridge/decision_resolver.js`.
- Implement precedence:
  - critical deny.
  - deny.
  - ask permission.
  - drop/rewrite/inject/modify.
  - allow/defer.
- Add conflict handling for same-target mutations.
- Preserve plugin order for compatible modifications.

### Acceptance

- HME kernel deny cannot be overridden.
- Multiple compatible `chat.params` patches compose deterministically.
- Conflicting patches produce explicit conflict denial.
- Effects are merged only after decision validation.
- Resolver tests cover all precedence paths.

## Phase 7: low-risk observation routing

Goal: route non-mutating phases through the universal ABI in shadow, then live once parity holds.

### Work

Start with:

- `session.start`.
- `telemetry.event`.
- `message.input` observation.
- `message.output` observation.
- `tool.execute.after` observation.

### Acceptance

- No live decisions change during shadow.
- Parity logs remain stable across focused HME tests.
- Live switch only enables observation/telemetry effects.
- Failure in optional observation plugin logs and continues.

## Phase 8: `chat.params` routing

Goal: use OpenCode-compatible request mutation while preserving HME proxy controls.

### Work

- Add proxy inbound adapters for Anthropic/OpenAI request bodies.
- Allow trusted plugins to propose `modify` decisions for `chat.params`.
- Apply patches only through host translators.
- Add host-specific patch validation.

### Acceptance

- Existing proxy request tests pass.
- Unsupported host params are rejected explicitly.
- Mutations are logged with compact reason codes.
- Context budget and model routing rules remain authoritative.
- Optional plugin failure does not corrupt upstream requests.

## Phase 9: `permission.ask` and `tool.execute.before`

Goal: migrate safety-sensitive tool gates only after shadow parity is reliable.

### Work

- Convert current tool permission gates into mandatory universal policies.
- Route Claude/Codex/proxy tool events through inbound adapters.
- Translate universal denials back to existing host outputs.
- Keep old path in comparator until parity is stable.

### Acceptance

- Bash/file/network policy tests pass.
- Deny/allow outputs match current behavior.
- Plugin allow cannot override HME deny.
- Plugin modify of tool input is disabled unless explicitly capability-enabled.
- Failure in mandatory policy fails closed.

## Phase 10: `stop.before` stop-chain migration

Goal: make stop-chain enforcement a mandatory universal phase while preserving first-deny-wins behavior.

### Work

- Wrap current stop-chain `WORK_CHECKS` as kernel policy for `stop.before`.
- Map Claude/Codex/proxy stop/lifecycle events into universal events.
- Translate denials back to host-specific stop responses.
- Keep current stop-chain tests as behavior contract.

### Acceptance

- Stop-chain, lifecycle, and universalization tests pass.
- Bare completion, nothing-missed, speculation, detector verdict, auto-completeness, FP gate, and parent-task debt behavior is unchanged.
- Strategy order remains explicit.
- Host-specific response text remains stable unless intentionally changed.

## Phase 11: `stream.text_block` and stream rewrite migration

Goal: move stream rewriting to universal text-block decisions after all lower-risk phases are stable.

### Work

- Use existing SSE text-block buffering as provider adapter edge.
- Emit universal `stream.text_block` events for buffered text blocks.
- Convert stop-hook rewriters into universal rewrite/drop policies.
- Translate `allow`, `drop`, and `rewrite` decisions back into valid provider streams.

### Acceptance

- Existing SSE rewrite and integration tests pass.
- Text-block buffer edge tests pass.
- Malformed stream input does not crash the proxy.
- Held blocks flush correctly on unexpected events.
- No cross-block state leakage.
- Latency overhead is measured.

## Phase 12: provider expansion template

Goal: make “anything” support repeatable.

### Work

- Document the minimum adapter checklist for a new host:
  - event extraction.
  - session identity.
  - tool/permission representation.
  - decision application path.
  - host capability map entry.
  - golden fixtures.
- Add a stub fixture/test template.

### Acceptance

- Adding a provider requires no policy-layer changes.
- New providers fail tests until capability and adapter fixtures are explicit.
- Docs distinguish unsupported, advisory-only, and enforcement-capable hosts.

## Phase 13: cleanup and deprecation

Goal: remove duplicate host-specific policy logic only after universal paths are live and stable.

### Work

- Identify old code paths superseded by universal adapters.
- Keep compatibility shims until tests prove parity.
- Delete only when concerns are covered elsewhere.
- Update docs and contract tests.

### Acceptance

- No duplicated provider-specific policy branches remain where universal policy owns behavior.
- Public facade exports remain stable or are intentionally migrated.
- Full HME and focused proxy/OMO suites pass.
- Runtime telemetry confirms no shadow mismatches for migrated phases.

## Verification lanes

Run these as relevant per phase:

```text
node --test tools/HME/tests/specs/omo_contract.test.js
node --test tools/HME/tests/specs/omo_*.test.js
node --test tools/HME/tests/specs/universal_hook_*.test.js
node --test tools/HME/tests/specs/proxy_*contract*.test.js
node --test tools/HME/tests/specs/stop_chain.test.js
node --test tools/HME/tests/specs/*lifecycle*.test.js
node --test tools/HME/tests/specs/sse_*test.js
```

Before stopping after implementation:

- `git status --short` must be clean after commit/autocommit.
- Touched files must remain under 350 LOC unless already ignored.
- Same-turn evidence must name tests run and outcomes.
