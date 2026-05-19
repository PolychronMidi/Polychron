# OMO Integration + smolagents/LangChain Synergy Plan

## Executive Summary

Polychron/HME is moving toward a comprehensive integration of the reference project:

```text
<reference-repo-root>
```

The goal is not a shallow copy. The goal is a coherent assimilation: preserve HME's existing strengths -- proxy routing, coherence guards, self-healing hooks, structured telemetry, smolagents canonical tool definitions, and Claude/Codex/OpenAI bridging -- while absorbing OMO's mature agent orchestration, context injection, dynamic pruning, compaction recovery, task/session features, team-mode concepts, and plugin-style extension surfaces.

A prerequisite has already begun: HME's canonical smolagents tool registry now exports LangChain-compatible descriptors and an optional Python LangChain adapter. This creates a stable interop seam:

```text
HMETool canonical source
  -> Codex/OpenAI schema
  -> Claude/native-looking schema
  -> HME policy metadata
  -> LangChain StructuredTool-compatible descriptor
  -> optional real StructuredTool instances when langchain_core is installed
```

This plan lays out the complete path from current state to robust OMO integration.

---

## Guiding Principles

### 1. One source of truth for tool contracts

Tool schema drift is one of the highest-risk integration failures. HME must keep a single canonical tool definition source:

```text
tools/HME/hme_tools/
```

The canonical tool source is currently smolagents `Tool` subclasses enriched with HME metadata. All downstream surfaces must derive from this source:

- Claude/native-looking tool schema
- Codex/OpenAI Responses schema
- HME policy metadata
- LangChain descriptors
- optional LangChain `StructuredTool` instances
- OMO/plugin adapter contracts
- validation/approval policy
- tool execution bridge metadata

No manually duplicated `Read/Edit/Bash/...` tool lists except tiny test fixtures with explicit purpose.

### 2. Integrate through stable seams, not invasive rewrites

OMO is comprehensive. Full integration should happen through adapter layers first:

- tool adapter
- context injector adapter
- session/task adapter
- compaction/pruning adapter
- plugin/hook adapter
- telemetry adapter

Only after stable behavior is observed should internals be unified.

### 3. Preserve HME coherence policy

OMO features must not bypass HME coherence protections:

- pre-write/read-before-edit enforcement
- exact edit matching and autocorrection
- anti-no-op/noise guards
- context-burn minimization
- compaction structural integrity
- task/brief continuity
- lifecycle hook policy
- emergency valve behavior

Any OMO feature that writes files, launches commands, mutates task state, or injects context must go through HME policy surfaces.

### 4. Favor semantic pruning before message dropping

Current telemetry shows HME whole-message dropping works structurally, but it is still coarse. OMO's dynamic pruning ideas should be integrated before pushing thresholds further:

- duplicate tool output pruning
- superseded write/read pruning
- old errored tool pruning
- protected recent turn window
- protected tools
- compaction survival capsule

The long-term target is fewer whole-message drops and more retention of meaningful reasoning/task state.

### 5. Every integration point needs telemetry

Integration must be observable. Every new pruning, context injection, tool adaptation, and OMO bridge action needs structured telemetry with stable event names.

---

## Current HME State

### Existing strengths

HME already has:

- proxy routing and overdrive model routing
- OmniRoute/Codex/Claude request mutation paths
- smolagents canonical tool registry
- JS registry bridge for canonical tools
- Codex native tool loop integration
- structured pre-write and post-tool hook system
- context budget/compaction logic
- structured `context_compaction` telemetry
- edit failure recovery and pre-execution Edit/Update -> Read rewrite
- session read cache
- emergency upstream valve
- HME activity telemetry
- lifecycle/precommit validation

### Recent completed work

#### smolagents/LangChain bridge

Implemented:

```text
tools/HME/hme_tools/base.py
  langchain_tool_schema(tool)

tools/HME/hme_tools/export.py
  --kind langchain

tools/HME/proxy/hme_tool_registry.js
  canonicalLangChainTools()

tools/HME/hme_tools/langchain_adapter.py
  langchain_tool_descriptors()
  create_langchain_tools()
```

Tests:

```text
tools/HME/tests/specs/smolagents_tool_registry.test.js
tools/HME/tests/specs/test_langchain_adapter.py
```

#### Compaction telemetry

Added `context_compaction` events from `passthrough_compact.js`:

```js
{
  event: 'context_compaction',
  route,
  model,
  stage,
  tier,
  before_bytes,
  after_bytes,
  threshold_bytes,
  before_messages,
  after_messages,
  messages_dropped,
  stale_tool_results_elided,
  orphan_tool_blocks_scrubbed,
  emergency_tail_elided,
  keep_min
}
```

#### Context tuning

Current env tuning increased retained context:

```env
HME_PROXY_CONTEXT_FRACTION=0.99
HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST=2.4
HME_PROXY_REMAINING_FRACTION=0.85
HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION=0.08

HME_PROXY_COMPACT_START_FRACTION=0.88
HME_PROXY_COMPACT_GEAR1_TARGET=0.88
HME_PROXY_COMPACT_GEAR2_TARGET=0.94
HME_PROXY_COMPACT_GEAR3_TARGET=0.985
HME_PROXY_COMPACT_GEAR1_END=0.94
HME_PROXY_COMPACT_GEAR2_END=0.985
```

Effective threshold for `gpt-5.5-high/xhigh` is now approximately:

```text
646,272 bytes
```

Telemetry after the prior threshold increase remained structurally clean:

```text
orphan_tool_blocks_scrubbed = 0
emergency_tail_elided = 0
```

---

## OMO Reference Surface Summary

Reference repo:

```text
<reference-repo-root>
```

Important directories discovered during quick sweep:

```text
src/features/context-injector/
src/hooks/compaction-context-injector/
src/hooks/compaction-todo-preserver/
src/hooks/anthropic-context-window-limit-recovery/
src/config/schema/dynamic-context-pruning.ts
src/hooks/anthropic-context-window-limit-recovery/pruning-deduplication.ts
src/hooks/anthropic-context-window-limit-recovery/pruning-tool-output-truncation.ts
src/features/team-mode/
src/features/background-agent/
src/tools/
src/plugin/
src/plugin-handlers/
src/hooks/
src/agents/
```

### High-value OMO features

#### 1. Context injector

OMO has a pending context collector with:

- per-session context entries
- unique source/id deduplication
- priorities: `critical`, `high`, `normal`, `low`
- registration order
- consume-on-inject semantics

This is highly compatible with HME middleware context injection.

#### 2. Dynamic context pruning schema

OMO config supports:

- turn protection
- protected tools
- deduplication
- supersede writes
- purge errors

This provides an excellent conceptual model for improving HME pre-drop compaction.

#### 3. Deduplication pruning

OMO computes stable tool signatures:

```ts
toolName::JSON.stringify(sortedInput)
```

Then keeps newest duplicate calls and truncates older duplicate outputs.

This is directly useful for HME where repeated `Read`, `Grep`, `Bash`, status, and log commands can dominate context.

#### 4. Tool output truncation by call ID

OMO can map duplicate call IDs to stored tool outputs and truncate them.

HME does not use exactly the same OpenCode storage layout, but the idea maps well to Anthropic-style `tool_use.id` and `tool_result.tool_use_id` blocks.

#### 5. Context window limit recovery

OMO includes:

- token limit error parser
- deduplication recovery
- aggressive truncation
- summarize retry
- empty message sanitization before summarize

HME has proactive compaction but can borrow these as reactive recovery paths.

#### 6. Compaction context/todo preservation

OMO has explicit compaction hooks to preserve important state. HME should implement a similar survival capsule.

---

## Target Architecture

### A. Canonical Tool Contract Layer

#### Current

```text
tools/HME/hme_tools/tools.py
  HMETool subclasses
```

#### Target

Keep HMETool canonical, but expand exports/adapters:

```text
HMETool
  -> hme_schema
  -> openai/codex schema
  -> claude schema
  -> langchain descriptor
  -> optional LangChain StructuredTool
  -> OMO tool descriptor
  -> OMO plugin tool wrapper
```

#### Required enhancements

1. Add explicit OMO export kind if needed:

```bash
python3 tools/HME/hme_tools/export.py --kind omo
```

This may initially mirror `langchain` plus HME metadata.

2. Add canonical tool family predicates in metadata:

- edit family
- write family
- read family
- shell family
- network family
- agent/delegation family

3. Add versioned schema metadata:

```json
{
  "schema_version": "hme-tools/v1",
  "source": "smolagents",
  "capabilities": [...]
}
```

4. Add compatibility tests:

- HME schema parity
- LangChain descriptor parity
- optional StructuredTool instantiation if dependency exists
- OMO descriptor shape
- no drift between registry exports

---

### B. Tool Execution Adapter Layer

#### Current

HME uses:

- `run_tool.py`
- `validate_tool.py`
- JS `hme_tool_registry.js`
- Codex native tool loop
- structured Node tool backend

#### Target

Add a unified adapter facade:

```text
tools/HME/hme_tools/adapters/
  codex.py/js
  claude.py/js
  langchain.py
  omo.py
```

Initial implementation can be thin wrappers around existing registry functions.

#### Requirements

- all tool calls validate required fields through canonical metadata
- aliases are honored consistently
- approval policy is preserved
- bridge action is preserved
- native-host tools are marked clearly
- output byte limits are enforced
- background/run semantics are visible in metadata

#### LangChain-specific target

`create_langchain_tools()` should eventually support:

- sync invocation
- optional async invocation
- callback telemetry hooks
- Runnable-compatible metadata
- tool error normalization

Possible future API:

```python
create_langchain_tools(
    executor: HmeToolExecutor | None = None,
    telemetry: Callable[[dict], None] | None = None,
    strict: bool = True,
)
```

---

### C. OMO Tool Assimilation Layer

OMO has its own tools and plugin model. The integration should not blindly import everything into HME's model-facing surface.

#### Phase 1: inventory

Create an inventory of OMO tools:

```text
src/tools/**
src/features/**/tools/**
src/plugin-handlers/**
```

For each tool:

- name
- description
- input schema
- side effect class
- execution backend
- required runtime dependencies
- maps to existing HME tool?
- safe to expose to model?
- needs HME policy gate?
- test coverage present?

#### Phase 2: classify

Classes:

1. Native equivalent exists
   - map to HME canonical tool
2. Safe new read-only tool
   - add as HMETool subclass
3. Mutating tool
   - add only after policy gate and tests
4. Agent/team orchestration tool
   - expose through HME agent/task abstractions
5. Internal helper
   - do not expose to model
6. Deprecated/noisy/bloat-prone
   - skip

#### Phase 3: adapter

Add OMO adapter descriptors without changing model surface:

```text
omoToolDescriptors()
```

Then selectively promote tools into HMETool canonical registry.

---

### D. Context Injector Layer

#### Problem

HME currently has many middleware and hooks that inject context independently. This risks:

- duplicate reminders
- noisy context
- inconsistent priority
- context-burn
- stale injected state
- weak compaction recovery

#### OMO feature to adopt

OMO's `ContextCollector` pattern:

- register context by session/source/id
- priority sort
- consume-on-inject
- dedupe by key

#### HME target module

Create:

```text
tools/HME/proxy/context_injector.js
```

API:

```js
registerContext(sessionId, {
  source,
  id,
  content,
  priority,       // critical/high/normal/low
  ttl_ms,
  phase,
  metadata,
})

getPendingContext(sessionId, options)
consumePendingContext(sessionId, options)
clearContext(sessionId, filter)
```

#### Priority semantics

```text
critical: safety/coherence/current task survival
high: active files, validation failures, current blockers
normal: helpful project/module context
low: tips/reminders/nonessential guidance
```

#### Required features

- per-session storage
- TTL expiration
- max bytes per priority
- dedupe by `source:id`
- optional persistent backing in HME runtime
- telemetry:
  - `context_registered`
  - `context_injected`
  - `context_dropped_ttl`
  - `context_dropped_budget`

#### Migration plan

Move context emissions from middleware into collector gradually:

- lifesaver injection
- todo/status injection
- read context
- directory context
- background dominance
- skill reminders
- compaction survival capsule

---

### E. Compaction Survival Capsule

#### Problem

Whole-message dropping retains recent messages but may lose important old state.

#### Target

Before or after compaction, inject a compact high-priority survival capsule:

```text
[HME compaction survival capsule]
Current objective: ...
Active phase: ...
Recently changed files: ...
Recently read files: ...
Open todos: ...
Known blockers/errors: ...
Last validation evidence: ...
Background jobs: ...
Important decisions: ...
Do not repeat dropped context unless needed.
```

#### Inputs

- session_state
- recent file writes
- recent reads
- todo state
- verification evidence
- failed writes/tool errors
- background task registry
- compaction telemetry
- user request summary if available

#### Placement

Options:

1. Insert as first surviving user message after compaction marker.
2. Use context injector to inject into next request.
3. Both, with dedupe.

Preferred:

- immediate compact marker for local coherence
- context injector for next-turn state continuity

#### Telemetry

```js
{
  event: 'compaction_survival_capsule',
  session,
  route,
  bytes,
  fields_present,
  source_messages_dropped,
}
```

---

### F. Dynamic Context Pruning Layer

#### Problem

Current HME compaction pipeline:

1. stale tool result microcompaction
2. optional local summary/session notes
3. whole-message dropping
4. orphan scrub
5. emergency tail elision

The missing middle is semantic pruning.

#### OMO-inspired strategy order

Before whole-message dropping:

1. Turn-protected stale tool result microcompaction
2. Duplicate tool result pruning
3. Superseded write/input pruning
4. Old errored tool pruning
5. Oversized read/grep/bash output truncation by class
6. Optional local summary/session notes
7. Whole-message dropping only if still over threshold

#### Config

Add env/config knobs:

```env
HME_PROXY_DYNAMIC_PRUNING=1
HME_PROXY_PRUNE_TURN_PROTECTION=3
HME_PROXY_PRUNE_DEDUP=1
HME_PROXY_PRUNE_SUPERSEDED_WRITES=1
HME_PROXY_PRUNE_PURGE_ERRORS=1
HME_PROXY_PRUNE_NOTIFICATION=minimal
```

Protected tools:

```text
TodoWrite
TodoRead
TaskCreate
TaskUpdate
Read of active edited file
Edit
Write
Agent final outputs
verification commands
session state tools
```

#### Duplicate pruning algorithm

For each `tool_use`:

- extract tool name
- canonicalize input JSON with sorted keys
- create signature:

```text
name::stableJson(input)
```

- group by signature
- keep newest full result
- replace older result content with:

```text
(hme-proxy compact: duplicate {tool} result elided; newest duplicate retained later in context; original was N bytes)
```

Need to preserve tool_use/tool_result pairing validity.

#### Superseded write pruning

If a file was written/edited and later read, older write input/result can sometimes be reduced:

- never remove write existence
- never remove current active file diff evidence
- replace large content payloads with markers when subsequent Read gives current state

Marker:

```text
(hme-proxy compact: prior Write/Edit payload elided because file was read later at turn T)
```

#### Purge errored tool inputs

Old failed commands often burn context. After N turns:

- preserve error summary
- drop huge command output/input if not current blocker

#### Telemetry

Extend `context_compaction` or emit companion events:

```js
{
  event: 'context_pruning',
  route,
  model,
  stage: 'duplicate_tool_result' | 'superseded_write' | 'purge_error',
  before_bytes,
  after_bytes,
  bytes_saved,
  tool_results_pruned,
  protected_skipped,
  turn_protection_skipped,
}
```

---

### G. Token Limit Recovery Layer

#### Current

HME has proactive compaction and upstream emergency handling.

#### Target

Add OMO-inspired context-window recovery after upstream token-limit errors:

1. Parse provider error.
2. If context/token-limit:
   - run dynamic pruning at aggressive level
   - retry once
3. If still too large:
   - run summarize/survival capsule
   - retry once
4. If still failing:
   - trip emergency valve/pass through or reduce request safely

#### Requirements

- no infinite retry loops
- retry telemetry
- preserve original payload dump for debugging
- never silently drop current user request
- never create orphan tool_result blocks

#### Telemetry

```js
{
  event: 'context_limit_recovery',
  provider,
  model,
  phase,
  before_bytes,
  after_bytes,
  retry_status,
  strategy,
}
```

---

### H. Session/Task Assimilation Layer

OMO includes session recovery, background agents, team mode, task/todo preservers.

HME already has:

- session state
- task tools/reminders
- background task tracking
- lifesaver/error escalation
- team-role routing

Integration should produce one coherent session/task state surface.

#### Target module

```text
tools/HME/proxy/session_context_snapshot.js
```

API:

```js
snapshotSession(sessionId) -> {
  objective,
  phase,
  todos,
  files_read,
  files_written,
  verification_evidence,
  failed_tools,
  background_jobs,
  active_roles,
  compact_summary,
}
```

This powers:

- survival capsule
- OMO context injector
- task recovery
- team mailbox/status
- final response coherence checks

#### OMO team-mode integration

Initial approach:

- inspect OMO `src/features/team-mode/**`
- map concepts to HME team roles
- do not expose all tools immediately
- integrate mailbox/status as read-only context first
- promote mutating team tools later

---

## Implementation Phases

## Phase 0: Stabilize current bridge

Status: mostly complete.

### Deliverables

- [x] LangChain descriptor export from HMETool
- [x] JS `canonicalLangChainTools()`
- [x] optional Python `create_langchain_tools()`
- [x] tests for descriptor parity
- [x] dependency-optional failure behavior

### Follow-ups

- [ ] Add OMO descriptor export kind if needed.
- [ ] Add adapter docs after API settles.
- [ ] Add version metadata to exports.
- [ ] Add schema drift audit in precommit.

### Validation

```bash
python3 -m pytest -q tools/HME/tests/specs/test_langchain_adapter.py
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
```

---

## Phase 1: OMO Inventory and Mapping

### Goal

Know exactly what OMO offers before importing behavior.

### Tasks

1. Build inventory script:

```text
tools/HME/scripts/omo_inventory.py
```

Input:

```text
<reference-repo-root>
```

Output:

```text
tools/HME/runtime/omo_inventory.json
```

Fields:

```json
{
  "path": "...",
  "kind": "tool|hook|feature|agent|schema|plugin",
  "name": "...",
  "description": "...",
  "side_effect": "read|write|shell|network|agent|unknown",
  "dependencies": [],
  "candidate_mapping": "existing_hme_tool|new_tool|internal|skip",
  "risk": "low|medium|high",
  "notes": "..."
}
```

2. Generate summary report:

```text
omo_inventory_summary
```

3. Add tests for inventory parser on fixtures.

### Acceptance criteria

- all OMO `src/tools`, `src/hooks`, `src/features`, `src/agents`, `src/plugin*` are classified
- no write/shell/network tool can be marked low risk without explicit policy mapping
- inventory is reproducible

---

## Phase 2: Context Injector Port

### Goal

Create HME's priority context collector inspired by OMO.

### Tasks

1. Implement:

```text
tools/HME/proxy/context_injector.js
```

2. Add tests:

```text
tools/HME/tests/specs/context_injector.test.js
```

Test cases:

- priority ordering
- dedupe by source/id
- consume clears session
- TTL expiration
- byte budget trims low priority first
- session isolation

3. Add telemetry:

- `context_registered`
- `context_consumed`
- `context_dropped_budget`
- `context_dropped_ttl`

4. Integrate one low-risk middleware source first, probably status/todo or lifesaver.

### Acceptance criteria

- no duplicate injection for same source/id
- critical context survives budget trimming
- middleware can register context without directly mutating payload

---

## Phase 3: Compaction Survival Capsule

### Goal

Reduce coherence loss from whole-message dropping.

### Tasks

1. Implement:

```text
tools/HME/proxy/compaction_survival_capsule.js
```

2. Use `session_state` to build compact summary.

3. Integrate into `passthrough_compact.js` after message drops.

4. Register capsule with context injector for next request.

5. Add tests:

- capsule includes current objective when present
- includes recent writes/reads
- includes validation evidence
- stays under byte budget
- inserted marker remains user-role safe
- no orphan tool blocks

6. Telemetry:

```text
compaction_survival_capsule
```

### Acceptance criteria

- compaction with 900+ message drops leaves clear state capsule
- capsule does not repeat huge logs/tool outputs
- telemetry records byte size and fields included

---

## Phase 4: Dynamic Pruning Before Message Drop

### Goal

Adopt OMO's semantic pruning before coarse message dropping.

### Tasks

1. Implement stable JSON canonicalizer:

```text
tools/HME/proxy/stable_json.js
```

2. Implement duplicate tool result pruning:

```text
tools/HME/proxy/context_pruning.js
```

API:

```js
pruneDuplicateToolResults(payload, options) -> stats
```

3. Integrate into `shrinkForPassthrough()` between microcompact and message drop.

4. Add protected tools and turn protection.

5. Add tests:

- duplicate Read result pruned, newest kept
- duplicate Bash status command pruned
- protected Todo/Write/Edit not pruned
- recent turn protected
- tool_use/tool_result pairing remains valid
- byte savings telemetry emitted

6. Add telemetry:

```text
context_pruning
```

### Acceptance criteria

- duplicate pruning reduces bytes before message drops
- whole-message drops decrease in telemetry
- no orphan tool block increase
- no emergency tail elision increase

---

## Phase 5: Token Limit Recovery

### Goal

Reactive recovery when upstream rejects context.

### Tasks

1. Add token-limit error parser per provider.

2. Add recovery strategies:

- dynamic pruning retry
- survival capsule + aggressive truncation retry
- emergency fallback

3. Integrate with upstream failure handling.

4. Add tests with synthetic provider errors:

- Anthropic-style token limit error
- OpenAI/Codex context length error
- retry succeeds
- retry stops after bounded attempts
- emergency valve not tripped for recoverable first attempt

5. Telemetry:

```text
context_limit_recovery
```

### Acceptance criteria

- no infinite retries
- original user message preserved
- tool block structure valid after recovery

---

## Phase 6: OMO Tool/Plugin Adapter

### Goal

Prepare full OMO integration without exposing unsafe tools prematurely.

### Tasks

1. Add OMO adapter module:

```text
tools/HME/omo_adapter/
```

2. Add descriptor reader for OMO tools/plugins.

3. Map OMO tools into categories:

- existing HME canonical tool
- new HMETool candidate
- internal-only
- blocked/unsafe

4. Add an OMO descriptor export:

```bash
python3 tools/HME/hme_tools/export.py --kind omo
```

5. Add tests:

- OMO descriptor shape
- policy mapping exists for every mutating tool
- no unknown side effects default to allowed

### Acceptance criteria

- OMO inventory can be consumed by HME without side effects
- no OMO mutating behavior bypasses pre-write/pre-bash policy

---

## Phase 7: Selective OMO Feature Assimilation

### Candidate order

1. Context injector concepts
2. Dynamic pruning/recovery
3. Compaction todo/context preservation
4. Session recovery sanitizers
5. Background task manager ideas
6. Team-mode mailbox/status as read-only
7. OMO command/plugin loading
8. Agent prompt libraries
9. Full OMO tool execution surface

### Non-goals at this stage

- wholesale replacement of HME proxy
- bypassing HME hooks
- exposing all OMO tools immediately
- adding mandatory LangChain dependency
- adding noisy documentation/context injection without telemetry

---

## Telemetry Plan

### Existing event

```text
context_compaction
```

### New proposed events

```text
context_registered
context_consumed
context_dropped_budget
context_dropped_ttl
context_pruning
compaction_survival_capsule
context_limit_recovery
omo_inventory_generated
omo_tool_mapped
omo_tool_blocked
langchain_tool_invoked
langchain_tool_error
```

### Dashboard questions

1. How many bytes are saved by semantic pruning before message drop?
2. Are whole-message drops decreasing?
3. Are orphan/tail emergency repairs still zero?
4. Which tools generate the most duplicate output?
5. How often does survival capsule inject?
6. Does context-limit recovery avoid emergency valve trips?
7. Which OMO tools are mapped/blocked?

---

## Safety and Coherence Gates

### Required before merging each phase

- focused tests pass
- precommit validation passes
- no new unchecked duplicate tool lists
- no direct OMO mutating tool exposure without policy
- no markdown/docs creation unless requested
- structured telemetry exists for new behavior
- compaction tests preserve tool-use graph validity

### Invariants

1. Current user message is never dropped.
2. Assistant `tool_use` and user `tool_result` remain coherent.
3. Protected tools are never pruned aggressively.
4. Edit/Write never bypass prior-read/write policy.
5. Bash destructive policy remains canonical.
6. OMO tools cannot execute by default without classification.
7. LangChain adapter remains optional dependency.
8. smolagents remains tool contract source of truth unless deliberately replaced.

---

## Test Matrix

### Unit tests

```text
smolagents_tool_registry.test.js
test_langchain_adapter.py
context_injector.test.js
context_pruning.test.js
compaction_survival_capsule.test.js
context_limit_recovery.test.js
omo_inventory.test.py
omo_adapter.test.py
```

### Integration tests

```text
proxy_extracted_modules.test.js
proxy_boundary_contract.test.js
codex_empty_bash_context.test.js
pre_write_and_session_state.test.js
edit_failure_recovery.test.js
```

### Synthetic scenarios

1. Repeated Read same file 20 times.
2. Repeated grep same query 20 times.
3. Long Bash log output repeated.
4. Active Edit after Read should not prune needed context.
5. Todo state survives compaction.
6. Background job result survives via capsule.
7. OMO tool descriptor is blocked until classified.
8. Token limit error triggers pruning retry.

---

## Near-Term Next Actions

### Immediate next step

Implement Phase 1 inventory script for OMO:

```text
tools/HME/scripts/omo_inventory.py
```

This should be read-only and safe.

### Then

Implement Phase 2 context injector.

### Then

Implement Phase 4 duplicate tool result pruning before whole-message drop.

The pruning layer should likely happen before further context-threshold tuning, because telemetry shows current message drops still remove around 900+ messages per compaction. Increasing the threshold helps, but semantic pruning will preserve more useful context per byte.

---

## Open Questions

1. Should OMO become a vendored dependency, a git submodule, or an external reference copied into HME modules?
2. Should LangChain remain optional forever, or become an optional extra install group?
3. Should OMO's plugin model be adapted to HME hooks, or should HME expose a compatibility plugin host?
4. What is the canonical naming convention for OMO-derived tools?
5. Which OMO agents map to HME team roles?
6. Should the context injector be purely in-memory, runtime-persistent, or both?
7. Should compaction survival capsules be inserted into payloads, injected next-turn, or both?
8. How aggressive can duplicate pruning be before it hides important historical evidence?

---

## Success Criteria

The integration is successful when:

- HME can consume OMO tool/context/session features through typed adapters.
- Tool schema drift is eliminated across smolagents, Codex, Claude, LangChain, and OMO.
- Compaction retains more semantic context with fewer whole-message drops.
- Context injection is priority-based, deduped, and observable.
- OMO features cannot bypass HME policy gates.
- Optional LangChain integration works when installed and fails loud when absent.
- Telemetry makes every compaction/pruning/recovery decision explainable.
- Precommit and focused suites remain green.

---

## Current Baseline Commands

```bash
python3 -m pytest -q tools/HME/tests/specs/test_langchain_adapter.py
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
node --test tools/HME/tests/specs/proxy_extracted_modules.test.js
PROJECT_ROOT=<repo-root> HOOK_PATH=<repo-root>/.git/hooks/pre-commit python3 tools/HME/scripts/precommit_validate.py
```

---

## Appendix: Current LangChain Descriptor Shape

Example descriptor shape:

```json
{
  "name": "Read",
  "description": "Read a file by absolute path...",
  "args_schema": {
    "type": "object",
    "properties": {
      "file_path": { "type": "string" },
      "offset": { "type": "integer" },
      "limit": { "type": "integer" },
      "pages": { "type": "string" }
    },
    "required": ["file_path"],
    "additionalProperties": false
  },
  "metadata": {
    "side_effect": "read",
    "approval": "never",
    "idempotent": true,
    "max_output_bytes": 200000,
    "input_aliases": { "file_path": ["file"] },
    "bridge_action": "read",
    "host_native": false,
    "policy": {
      "context_guard": true,
      "requires_absolute_path": true
    }
  },
  "return_direct": false
}
```

This descriptor should be considered the primary low-friction interop contract for LangChain and OMO until full tool execution adapters are mature.
