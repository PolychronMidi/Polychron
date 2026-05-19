# OMO Dependency Integration + smolagents/LangChain Synergy Plan

## Executive Summary

Polychron/HME should integrate OMO as a substantial maintained dependency, not assimilate or copy its internals into HME.

OMO is large and coherent enough to remain its own upstream project. HME's job is to depend on it through explicit adapters, versioned contracts, policy gates, and telemetry. We should avoid rewriting OMO features inside HME unless a small compatibility shim is necessary. The correct integration model is:

```text
HME core policy/proxy/coherence layer
  -> OMO dependency boundary
    -> OMO agents/features/plugins/context systems
  -> HME adapters for tool contracts, session state, telemetry, and safety gates
```

The already-built smolagents/LangChain bridge is still the right prerequisite. It gives HME a canonical tool contract that can be presented to LangChain-like consumers and to OMO integration surfaces without duplicating schemas.

Because OMO was originally built on OpenCode, the main runtime integration target is an OpenCode-plugin host shim inside HME. HME should instantiate OMO's plugin module as a dependency, translate HME's Claude/Codex/Omni proxy lifecycle into OpenCode-like plugin hook calls, then validate and apply OMO hook outputs through HME policy.

This plan replaces the earlier assimilation framing with a dependency-first architecture.

---

## Core Correction

### What we are not doing

We are not planning to:

- copy OMO feature implementations wholesale into HME
- fork OMO into HME modules by default
- manually port OMO tools one by one unless dependency boundaries require wrappers
- duplicate OMO's plugin/hook/session machinery inside HME
- make HME's internals a shadow implementation of OMO
- expose OMO mutating behavior directly to models without HME policy gates

### What we are doing

We are planning to:

- add OMO as a managed dependency
- define stable adapter boundaries between HME and OMO
- let OMO own its own comprehensive feature set
- let HME own proxy routing, coherence policy, tool contract normalization, telemetry, and enforcement
- connect OMO to HME's canonical smolagents/LangChain tool bridge
- wrap OMO behavior where necessary for safety, observability, and compatibility
- keep OMO updateable without rewriting HME each time

---

## Desired Dependency Model

OMO should be consumed as one of the following, in order of preference after evaluation:

### Option A: package dependency

If OMO exposes a package entrypoint suitable for runtime use, prefer package management:

```text
package.json / bun / npm dependency
```

Advantages:

- clear versioning
- easier updates
- standard lockfile tracking
- less local source noise
- explicit upstream boundary

Requirements:

- exported APIs are stable enough
- HME can import required modules without running OMO CLI side effects
- dependency build system is compatible with HME runtime
- license and distribution are acceptable

### Option B: git submodule or pinned external checkout

If OMO is not packaged cleanly but must remain as source:

```text
external/omo or references/omo as pinned dependency
```

Advantages:

- upstream history preserved
- no copied internals
- explicit update point
- patches can be tracked separately

Requirements:

- dependency path is configurable
- no hard-coded local absolute paths
- version/pin recorded
- HME tests can run without requiring global path assumptions

### Option C: vendored source only as last resort

Vendoring is least preferred. It should only happen if:

- package/submodule integration is impossible
- only a small stable subset is needed
- license allows it
- update strategy is explicit

Even then, vendored code must stay isolated under a dependency boundary, not intermingled with HME core.

---

## Architectural Boundary

## HME owns

- model proxy/routing
- Anthropic/Codex/OpenAI request/response normalization
- HME coherence hooks
- pre-write/pre-bash policy gates
- read-before-edit enforcement
- structured telemetry
- compaction policy and telemetry
- emergency upstream handling
- canonical HME tool definitions
- smolagents registry
- LangChain-compatible tool descriptors
- session-state evidence used by HME gates

## OMO owns

- OMO agents
- OMO plugin system
- OMO context injector internals
- OMO compaction/todo preservation logic
- OMO task/background/team features
- OMO command loading
- OMO hook implementations
- OMO internal session/task abstractions

## Adapter layer owns

- translating HME canonical tools into OMO-consumable tools
- translating OMO tool/plugin descriptors into HME policy-aware wrappers where needed
- propagating telemetry across the boundary
- mapping session identifiers
- mapping context injection lifecycle
- enforcing HME policy around OMO actions
- compatibility checks for OMO version/API changes

---

## Current Foundation: smolagents + LangChain Bridge

HME's canonical tools live in:

```text
tools/HME/hme_tools/
```

Current exports:

```text
--kind codex
--kind claude
--kind openai
--kind hme
--kind langchain
```

The new LangChain descriptor export provides a dependency-free bridge shape:

```json
{
  "name": "Read",
  "description": "...",
  "args_schema": { "type": "object", "properties": {}, "required": [] },
  "metadata": {
    "side_effect": "read",
    "approval": "never",
    "bridge_action": "read",
    "host_native": false,
    "policy": {}
  },
  "return_direct": false
}
```

Optional Python adapter:

```python
from hme_tools.langchain_adapter import (
    langchain_tool_descriptors,
    create_langchain_tools,
)
```

This is important because OMO and LangChain-style systems can consume the same canonical HME tool definitions without schema drift.

---

## OpenCode Plugin Host Shim

OMO was originally built as an OpenCode plugin. Its package entrypoint exports a plugin module whose server function returns OpenCode hook handlers such as:

```text
chat.params
chat.headers
chat.message
experimental.chat.messages.transform
experimental.chat.system.transform
tool.execute.before
tool.execute.after
command.execute.before
event
experimental.session.compacting
experimental.compaction.autocontinue
```

HME can use OMO in a middleware-proxy style by hosting that plugin interface rather than copying its internals.

Target flow:

```text
Claude/Codex/Omni request
  -> HME normalized lifecycle event
    -> OpenCode PluginInput shim
      -> OMO plugin hook
        -> HME validates hook output
          -> HME applies allowed mutation or blocks it
```

The host shim should provide:

```text
tools/HME/omo_bridge/opencode_host.js
tools/HME/omo_bridge/client_shim.js
tools/HME/omo_bridge/lifecycle_map.js
```

Responsibilities:

- instantiate OMO's plugin module from the configured dependency
- provide an OpenCode-like `PluginInput` with `directory`, `client`, and session APIs
- map HME request/middleware events into OMO hook inputs
- map OMO hook outputs back into HME payload mutations
- treat HME as the outer authority for policy, validation, and telemetry
- support shadow mode where hooks execute but outputs are observed rather than applied

Initial hook mapping:

```text
OMO chat.params                         -> HME request/model parameter mutation
OMO chat.headers                        -> HME upstream header mutation
OMO chat.message                        -> HME user/message middleware transform
OMO experimental.chat.messages.transform -> HME request payload/message transform
OMO experimental.chat.system.transform   -> HME system prompt transform
OMO tool.execute.before                 -> HME PreToolUse policy lifecycle
OMO tool.execute.after                  -> HME PostToolUse lifecycle
OMO experimental.session.compacting      -> HME compaction lifecycle
OMO experimental.compaction.autocontinue -> HME continuation/autocontinue lifecycle
```

High-risk areas that require shims or staged enablement:

- `input.client.session.*` calls need an HME-backed OpenCode client shim or a real OpenCode sidecar.
- OMO tool execution must route through HME canonical tools and policy gates.
- OMO storage assumptions must be classified as supported, shimmed, disabled, or sidecar-only.
- Message formats must be translated between Claude/Codex/HME and OpenCode-style records.

Rollout order:

1. Shadow-load OMO and call hooks without applying output.
2. Enable pure transforms: params, headers, system transform, message transform.
3. Enable tool lifecycle hooks under HME policy.
4. Enable compaction/context hooks.
5. Enable session/task/team/background features only after the client shim is mature.

---

## OMO Dependency Integration Goals

### Goal 1: Establish dependency pin and loader

Create a small OMO dependency loader that can resolve OMO from configured sources:

```text
package dependency
submodule/external checkout
reference checkout for development
```

Proposed module:

```text
tools/HME/omo_bridge/dependency.js
tools/HME/omo_bridge/dependency.py
```

Responsibilities:

- resolve OMO root/package
- detect version/commit
- verify expected entrypoints
- fail loud with actionable diagnostics
- never assume local absolute paths
- emit dependency health telemetry

Telemetry:

```json
{
  "event": "omo_dependency_resolved",
  "source": "package|submodule|reference|missing",
  "version": "...",
  "commit": "...",
  "status": "ok|error"
}
```

### Goal 2: Define OMO compatibility contract

Create a versioned contract file describing what HME expects from OMO:

```text
tools/HME/omo_bridge/contract.json
```

Example:

```json
{
  "contract_version": "hme-omo/v1",
  "required_entrypoints": [
    "context-injector",
    "hooks/anthropic-context-window-limit-recovery",
    "config/schema/dynamic-context-pruning"
  ],
  "optional_entrypoints": [
    "team-mode",
    "background-agent",
    "plugin-handlers"
  ]
}
```

The contract should be validated in tests against the configured OMO dependency.

### Goal 3: Keep tool contracts canonical in HME

HME tools should remain canonical in HMETool/smolagents. OMO should consume HME tools via descriptors/adapters rather than redefining them.

Required adapters:

```text
tools/HME/omo_bridge/hme_tools_to_omo.js
tools/HME/omo_bridge/hme_tools_to_omo.py
```

Input:

```text
canonicalLangChainTools()
canonicalToolMetadata()
```

Output:

- OMO-compatible tool descriptors
- OMO plugin registration objects if OMO exposes a plugin API
- policy metadata preserved

### Goal 4: Wrap OMO actions in HME policy

Any OMO-originated action that can mutate files, run shell commands, use network, or launch agents must pass through HME policy:

```text
OMO action request
  -> HME policy adapter
    -> pretool/prewrite/prebash/session checks
      -> allowed execution backend
```

No direct OMO write/shell execution should bypass HME.

### Goal 5: Bridge context systems without duplicating them

If OMO has a context injector, HME should depend on it rather than reimplement it. HME needs a bridge:

```text
HME middleware context event
  -> OMO context registration
  -> OMO injection lifecycle
  -> HME telemetry and budget guard
```

If OMO's injector cannot directly run in HME proxy, create a thin adapter that preserves OMO semantics.

### Goal 6: Use OMO dynamic pruning as dependency feature

OMO's dynamic pruning should be called as a dependency capability if available. HME should not rewrite the algorithm unless OMO cannot operate on HME payload shape.

Bridge target:

```text
HME Anthropic/Codex message payload
  -> OMO-compatible session/message representation
  -> OMO pruning capability
  -> HME payload patch/transform
  -> HME telemetry
```

### Goal 7: Preserve observability

Every OMO bridge call must produce HME telemetry:

```text
omo_dependency_resolved
omo_contract_validated
omo_context_registered
omo_context_injected
omo_pruning_started
omo_pruning_completed
omo_tool_registered
omo_tool_invoked
omo_tool_blocked
omo_bridge_error
```

---

## Proposed Repository Layout

```text
tools/HME/omo_bridge/
  README or module docstring later if requested
  dependency.js
  dependency.py
  contract.json
  contract_validator.js
  hme_tools_to_omo.js
  hme_tools_to_omo.py
  policy_adapter.js
  context_adapter.js
  pruning_adapter.js
  telemetry.js
  errors.js
```

Tests:

```text
tools/HME/tests/specs/omo_dependency.test.js
tools/HME/tests/specs/omo_contract.test.js
tools/HME/tests/specs/omo_tool_bridge.test.js
tools/HME/tests/specs/omo_policy_adapter.test.js
tools/HME/tests/specs/omo_context_adapter.test.js
tools/HME/tests/specs/omo_pruning_adapter.test.js
```

---

## Dependency Resolution Strategy

### Configuration knobs

Use environment/config, not hard-coded local paths:

```env
HME_OMO_ENABLED=0
HME_OMO_SOURCE=package|path|disabled
HME_OMO_PACKAGE=@.../oh-my-openagent
HME_OMO_PATH=<optional relative or configured external path>
HME_OMO_REQUIRED_VERSION=<semver/range>
HME_OMO_STRICT_CONTRACT=1
```

Default should be disabled until dependency health and policy gates are complete.

### Resolver behavior

1. If `HME_OMO_ENABLED != 1`, return disabled state.
2. If source is package, resolve package entrypoint.
3. If source is path, resolve path relative to repo/config, not local absolute.
4. Detect version:
   - package version if available
   - git commit if checkout
   - fallback content hash
5. Validate required entrypoints.
6. Emit telemetry.

### Failure behavior

Failure should be loud but non-catastrophic unless OMO is required for the request path:

```text
OMO disabled/unavailable -> HME native path continues
OMO required and unavailable -> clear diagnostic error
```

---

## Tool Bridge Plan

### Current HME canonical tool exports

HME already exports:

```js
canonicalToolSchemas()
canonicalToolMetadata()
canonicalLangChainTools()
```

### OMO bridge target

Create an adapter that can feed OMO an HME tool surface using the closest supported OMO API.

Pseudo-flow:

```js
const { canonicalLangChainTools } = require('../proxy/hme_tool_registry');
const { resolveOmo } = require('./dependency');

function hmeToolsForOmo() {
  const tools = canonicalLangChainTools();
  return tools.map(toOmoToolDescriptor);
}
```

### Policy preservation

Every descriptor must include:

- side effect
- approval policy
- idempotence
- max output bytes
- input aliases
- bridge action
- host native flag
- HME policy extras

OMO should see these, but HME remains enforcement authority.

### Tool invocation path

Preferred:

```text
OMO model/tool request
  -> OMO tool descriptor
  -> HME bridge action
  -> HME canonical tool runner
  -> HME hooks/policy
  -> result returned to OMO
```

Avoid:

```text
OMO directly calls shell/write/network without HME policy
```

---

## LangChain Synergy Plan

The LangChain adapter is not the final dependency integration, but it is a bridge pattern for OMO.

### Current state

Dependency-free descriptors exist.

Optional `StructuredTool` creation exists when `langchain_core` is installed.

### Next improvements

1. Add async support:

```python
async def ainvoke(...)
```

2. Add telemetry callback:

```python
create_langchain_tools(telemetry=emit)
```

3. Add policy-aware executor injection:

```python
create_langchain_tools(executor=HmePolicyExecutor())
```

4. Add compatibility tests with fake `StructuredTool` if real dependency absent.

5. Add optional extras group if package management supports it:

```text
hme[langchain]
```

### Why this helps OMO

If OMO accepts LangChain-style tools, HME can provide canonical tools directly. If OMO does not, the descriptor shape still acts as a clean intermediate contract.

---

## Context Bridge Plan

### Dependency-first approach

Do not port OMO's context injector unless necessary. First determine:

- does OMO expose context injector as importable API?
- can it operate outside OMO CLI runtime?
- can HME register context entries into it?
- can HME consume the resulting context text/messages?

### HME adapter responsibilities

```text
tools/HME/omo_bridge/context_adapter.js
```

Should provide:

```js
registerOmoContext(sessionId, entry)
consumeOmoContext(sessionId, budget)
clearOmoContext(sessionId, filter)
```

### Entry shape

```js
{
  source: 'hme:lifecycle' | 'hme:todo' | 'hme:compaction' | 'omo:...',
  id: 'stable-id',
  content: '...',
  priority: 'critical' | 'high' | 'normal' | 'low',
  ttl_ms: 0,
  metadata: {}
}
```

### HME safeguards

- max bytes per injection
- dedupe repeated entries
- telemetry on every injection
- no hidden context spam
- preserve current user request priority

---

## Dynamic Pruning Bridge Plan

### Dependency-first approach

Use OMO pruning capabilities as callable dependency functions if possible.

The adapter should translate HME payloads into the representation OMO expects, call OMO pruning, and translate changes back.

### Bridge API

```js
pruneWithOmo(payload, {
  sessionId,
  route,
  model,
  thresholdBytes,
  protectedTools,
  turnProtection,
}) -> {
  changed,
  beforeBytes,
  afterBytes,
  stats,
  payload
}
```

### Fallback

If OMO pruning cannot operate on HME payloads, implement only a minimal compatibility shim, not a full fork.

Fallback can do duplicate tool-result pruning only, but should remain under `omo_bridge` as compatibility glue.

### Telemetry

```json
{
  "event": "omo_pruning_completed",
  "route": "omni-context",
  "model": "...",
  "before_bytes": 0,
  "after_bytes": 0,
  "duplicates_pruned": 0,
  "protected_skipped": 0,
  "source": "omo|compat"
}
```

---

## Compaction and Telemetry Relationship

HME compaction remains the final authority because it sits in the proxy path and knows provider/model thresholds.

OMO pruning/context-preservation can become pre-compaction enrichment/pruning:

```text
HME payload
  -> OMO semantic pruning if enabled
  -> HME passthrough/omni compaction
  -> HME structural validation
  -> HME telemetry
```

Current telemetry should guide rollout.

### Current useful telemetry

`context_compaction` already shows:

- route
- model
- tier
- before/after bytes
- threshold bytes
- before/after messages
- messages dropped
- stale tool results elided
- orphan repairs
- emergency tail elision

### Rollout success metrics

After enabling OMO pruning bridge, expect:

- lower `messages_dropped`
- higher `after_messages`
- same or lower `orphan_tool_blocks_scrubbed`
- same or lower `emergency_tail_elided`
- visible `omo_pruning_completed` byte savings
- no increase in upstream context-limit errors

---

## Session and Task Bridge Plan

OMO has substantial session/task/team/background features. HME should not copy them. It should connect through boundary APIs.

### Adapter questions

- Can OMO sessions be addressed by HME session id?
- Does OMO expose task/todo state APIs?
- Does OMO team mode expose read-only status snapshots?
- Does OMO background-agent state have stable identifiers?

### Bridge shape

```js
getOmoSessionSnapshot(sessionId) -> {
  todos,
  tasks,
  agents,
  background_jobs,
  team_status,
  context_entries,
}
```

HME can then use snapshots for:

- compaction survival capsules
- status injection
- telemetry
- final answer checks

### Policy

Session/task reads are safe. Mutations must go through HME policy or explicit OMO bridge policy.

---

## OMO Plugin/Hook Bridge Plan

### Goal

Allow OMO plugins/hooks to run where appropriate without letting them bypass HME lifecycle policy.

### Bridge model

```text
HME lifecycle event
  -> OMO hook adapter
  -> OMO hook/plugin
  -> HME validates result
  -> HME applies or rejects mutation
```

### HME-owned validation

Any OMO hook result that mutates:

- system prompt
- tool schema
- messages
- file system
- command execution
- session state

must be validated by HME before applying.

### Telemetry

```json
{
  "event": "omo_hook_invoked",
  "hook": "...",
  "phase": "...",
  "result": "applied|blocked|noop|error",
  "bytes_added": 0
}
```

---

## Phased Implementation

## Phase 0: Correct plan and stabilize bridge

Status:

- LangChain descriptor export exists.
- Optional LangChain adapter exists.
- Plan corrected to dependency-first integration.
- OpenCode-plugin host shim model documented.
- `context_token_usage` telemetry exists for comparing estimated input tokens, provider usage, provider remaining-token headers, and active compaction thresholds before further tuning.

Validation:

```bash
python3 -m pytest -q tools/HME/tests/specs/test_langchain_adapter.py
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
```

## Phase 1: OMO dependency resolver

Deliverables:

```text
tools/HME/omo_bridge/dependency.js
tools/HME/omo_bridge/contract.json
tools/HME/omo_bridge/contract_validator.js
tools/HME/tests/specs/omo_dependency.test.js
tools/HME/tests/specs/omo_contract.test.js
```

Acceptance criteria:

- resolves disabled state cleanly
- resolves configured path/package without absolute path assumptions
- detects version/commit
- validates required entrypoints
- emits telemetry
- fails loud with clear diagnostic

## Phase 2: HME tools to OMO bridge

Deliverables:

```text
tools/HME/omo_bridge/hme_tools_to_omo.js
tools/HME/tests/specs/omo_tool_bridge.test.js
```

Acceptance criteria:

- all canonical HME tools are exported to OMO descriptor shape
- metadata preserved
- approval policy preserved
- no duplicate tool schema definitions
- mutating tools are clearly marked

## Phase 3: Policy adapter for OMO actions

Deliverables:

```text
tools/HME/omo_bridge/policy_adapter.js
tools/HME/tests/specs/omo_policy_adapter.test.js
```

Acceptance criteria:

- OMO shell/write/network/agent actions classified
- write/edit actions route through HME pre-write policy
- shell actions route through HME bash policy
- blocked actions produce clear errors
- telemetry emitted

## Phase 4: Context adapter

Deliverables:

```text
tools/HME/omo_bridge/context_adapter.js
tools/HME/tests/specs/omo_context_adapter.test.js
```

Acceptance criteria:

- HME can register context into OMO if available
- fallback disabled mode is safe
- context injection has byte limits
- duplicate context is avoided
- telemetry emitted

## Phase 5: OMO pruning adapter before HME compaction

Deliverables:

```text
tools/HME/omo_bridge/pruning_adapter.js
tools/HME/tests/specs/omo_pruning_adapter.test.js
```

Acceptance criteria:

- calls OMO pruning when available
- compatibility fallback is minimal and explicit
- HME structural validation runs after pruning
- `context_compaction` still emitted
- `omo_pruning_completed` emitted
- message drops decrease in live telemetry

## Phase 6: Session/task snapshot bridge

Deliverables:

```text
tools/HME/omo_bridge/session_adapter.js
tools/HME/tests/specs/omo_session_adapter.test.js
```

Acceptance criteria:

- reads OMO session/task/team state if available
- no mutation by default
- snapshot can feed compaction survival capsule or HME status injection
- telemetry emitted

## Phase 7: Optional hook/plugin bridge

Deliverables:

```text
tools/HME/omo_bridge/hook_adapter.js
tools/HME/tests/specs/omo_hook_adapter.test.js
```

Acceptance criteria:

- OMO hooks can be invoked from HME lifecycle events
- all mutations are validated by HME
- hooks can be disabled by config
- telemetry emitted

---

## Configuration Plan

Proposed env/config:

```env
HME_OMO_ENABLED=0
HME_OMO_SOURCE=disabled
HME_OMO_PATH=
HME_OMO_PACKAGE=
HME_OMO_REQUIRED_VERSION=
HME_OMO_STRICT_CONTRACT=1
HME_OMO_CONTEXT_BRIDGE=0
HME_OMO_PRUNING_BRIDGE=0
HME_OMO_TOOL_BRIDGE=0
HME_OMO_HOOK_BRIDGE=0
```

Default all bridges off. Enable one bridge at a time.

---

## Telemetry Plan

Existing HME events relevant to this integration:

```text
context_compaction
context_token_usage
```

`context_compaction` records compaction stage/tier, before/after bytes, before/after message counts, message drops, stale tool-result elisions, orphan-tool repairs, emergency tail elision, route, model, and threshold bytes.

`context_token_usage` records the response-boundary token/headroom comparison needed for safe threshold tuning:

```text
route
model
status
request_bytes
response_bytes
estimated_input_tokens
threshold_bytes
header_input_tokens_limit
header_input_tokens_remaining
header_input_tokens_used
usage_input_tokens
usage_output_tokens
estimated_vs_usage_delta
```

Planned OMO bridge events:

```text
omo_dependency_resolved
omo_contract_validated
omo_bridge_error
omo_tool_bridge_exported
omo_tool_invoked
omo_tool_blocked
omo_policy_checked
omo_context_registered
omo_context_injected
omo_pruning_started
omo_pruning_completed
omo_session_snapshot
omo_hook_invoked
```

Telemetry fields should include:

- bridge name
- OMO version/commit
- route/model where relevant
- before/after bytes where relevant
- action/result
- blocked reason
- source: package/path/disabled

---

## Safety Gates

Before enabling any OMO bridge by default:

1. Dependency resolver tests pass.
2. Contract validation tests pass.
3. OMO unavailable mode is safe.
4. Mutating OMO actions cannot bypass HME policy.
5. No local absolute paths are committed.
6. No duplicate canonical tool schema list is introduced.
7. HME precommit passes.
8. Focused bridge tests pass.
9. Live telemetry is available for every bridge action.
10. Rollback is a config flip.

---

## Test Matrix

### Existing tests to keep green

```bash
python3 -m pytest -q tools/HME/tests/specs/test_langchain_adapter.py
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
node --test tools/HME/tests/specs/codex_empty_bash_context.test.js
node --test tools/HME/tests/specs/proxy_extracted_modules.test.js
```

### New tests

```text
omo_dependency.test.js
omo_contract.test.js
omo_tool_bridge.test.js
omo_policy_adapter.test.js
omo_context_adapter.test.js
omo_pruning_adapter.test.js
omo_session_adapter.test.js
omo_hook_adapter.test.js
```

### Synthetic scenarios

1. OMO disabled: HME native behavior unchanged.
2. OMO path missing: diagnostic but no proxy crash.
3. OMO contract mismatch: bridge disabled with telemetry.
4. OMO tool bridge exports all HME canonical tools.
5. OMO attempts write: HME pre-write policy applies.
6. OMO attempts bash destructive command: HME destructive policy applies.
7. OMO pruning reduces payload bytes before HME compaction.
8. OMO context injection respects HME byte budget.
9. OMO hook tries to add excessive context: HME blocks/trims.
10. OMO dependency update changes entrypoint: contract test catches it.

---

## Compaction Tuning After OMO Bridge

Current HME compaction telemetry shows structural safety after increasing retained context. However, further tuning should wait until OMO pruning bridge is available.

Reason:

- threshold tuning keeps more bytes
- semantic pruning keeps more meaning per byte
- OMO dynamic pruning may reduce whole-message drops more effectively than further threshold increases

After OMO pruning bridge rollout, compare:

```text
before:
  messages_dropped
  after_messages
  orphan_tool_blocks_scrubbed
  emergency_tail_elided

after:
  messages_dropped
  after_messages
  omo_pruning_completed.bytes_saved
  orphan_tool_blocks_scrubbed
  emergency_tail_elided
```

Only tune thresholds further if:

- OMO pruning is stable
- context errors remain absent
- orphan/tail repairs remain zero
- model token telemetry still shows headroom

---

## Near-Term Next Actions

1. Implement OMO dependency resolver in disabled/path modes.
2. Add contract validator for expected OMO entrypoints.
3. Add HME-tools-to-OMO descriptor bridge using `canonicalLangChainTools()`.
4. Add policy adapter stubs for OMO-originated actions.
5. Keep all bridges disabled by default until tests and telemetry are complete.

---

## Success Criteria

OMO integration is successful when:

- OMO is a managed dependency, not copied internals.
- HME can resolve and validate OMO version/contract.
- HME can provide canonical tools to OMO without schema drift.
- OMO actions are policy-gated by HME.
- OMO context/pruning/session features can be invoked through adapters.
- OMO can be upgraded with contract tests catching breakage.
- All bridge actions are observable through telemetry.
- Disabling OMO instantly restores pure HME native behavior.

---

## Baseline Commands

```bash
python3 -m pytest -q tools/HME/tests/specs/test_langchain_adapter.py
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
node --test tools/HME/tests/specs/proxy_extracted_modules.test.js
PROJECT_ROOT=<repo-root> HOOK_PATH=<repo-root>/.git/hooks/pre-commit python3 tools/HME/scripts/precommit_validate.py
```
