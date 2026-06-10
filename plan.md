# Plan

Driver + peers confer here; durable, user-approvable proposals land here. Nothing in
this file is implemented until the user marks it approved.

## Status legend

- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented and verified

## Standing constraints

- No surface compliance: only intent-equivalent causal behavior counts.
- Local deterministic verification runs inline. Do not use mesh or background agents
  for checks that can be run directly.
- Every accepted failure becomes one of: fix, regression test, invariant, or dead
  mechanism deletion. No "preexisting" bucket.
- Proof artifacts must be compact, machine-checkable, and link to files, hashes,
  verifier IDs, and runtime evidence. No giant narrative ledgers.
- Control-plane tokens must not leak into user-visible input. Read-chain proof must
  be proxy-emitted native Read tool_use blocks, not typed prompts, PTY pokes, or
  FIFO/readq bridge text.
- Runtime health evidence must carry freshness windows. Stale log lines are history,
  not current proof.
- Broad multi-file transformations are forbidden while the repo is red. Repair order
  is: diagnose exact failure, smallest patch, syntax check, targeted test,
  regression/invariant, broad suite, compact proof trace.

## Phase Omega (proposed) -- Causal Self-Coherence Field

Consult source: `teams/runtime/output/omega-causal-self-coherence-1781113894/`.
Red, blue, and synthesis converged on seven workstreams. This phase turns
self-coherence from a list of alarms into a causal field: every action, shortcut,
route, proof, artifact, invariant, and final report must be tied to the route that
actually caused it.

### Workstream 1 -- Causal proof schema and compact coherence trace

Scope: define one minimal proof shape before adding more guard machinery.

Deliver:

- `tools/HME/config/coherence-proof.schema.json`
- a tiny validator for the schema
- one sample `_coherence-trace.json` fixture

Required proof fields:

- intent
- artifacts touched
- causal path IDs
- verifier IDs
- proof artifacts
- forbidden paths checked
- open risks

Acceptance:

- Schema test passes.
- Sample trace validates.
- Trace uses paths, hashes, IDs, and artifact links, not prose dumps.
- A proof claim with free-text provenance but no machine-checkable route fails.

### Workstream 2 -- Dead mechanism reaper

Scope: remove or block retired mechanisms across code, config, tests, and docs so
they cannot re-enter through stale compatibility paths.

Initial retired paths:

- consult FIFO/readq typing
- `submit_read_queue_to_pty`
- `readq!`
- `[HME_READ_CHAIN] $prompt` local-session bridge expansion
- stale PTY/nonce proof wording except explicit historical fixtures
- foreign `/proc/<pid>/fd` or `/dev/ptmx` poke paths

Acceptance:

- Source invariant forbids retired consult/read-chain routes outside explicit test
  fixtures.
- `shortcuts.json` has no `readq` local-session shortcut.
- Task-notification read-chain emits `hme_read_chain__...` Read tool_use IDs without
  typing control tokens into user input.
- Deletion requires replacement causal proof or an invariant proving the route is
  unreachable.

### Workstream 3 -- Typed shortcut and route causal paths

Scope: shortcuts and routes are not string expansions; they are typed causal
transitions with allowed and forbidden emitters.

Extend shortcut/route metadata with:

- intent
- lane
- allowed emitter
- forbidden emitters
- proof ID shape
- negative control

Initial coverage:

- `rr`: wire lane, proxy emits native Read chain, proof ID `hme_read_chain__...`
- `cc`: local-session lane, REPL-local `/compact`, never API payload mutation
- task-notification consult queue: host task-notification request, proxy consumes
  `latest-consult-read-queue.json`, emits Read tool_use directly

Acceptance:

- Wire shortcuts never type local-session input.
- Local-session shortcuts never become API payloads.
- Task-notification read-chain works without user-visible control markers.
- Negative controls prove forbidden lanes fail.

### Workstream 4 -- Executable invariant topology

Scope: make invariant relationships executable, not decorative.

Deliver:

- `tools/HME/config/invariant-topology.json`
- topology validator

Each invariant entry must declare:

- intent
- scope
- watched class
- watcher of
- watched by
- known escape vectors
- negative-control fixture

Acceptance:

- Validator fails on orphan topology nodes.
- Validator fails on unresolved watcher edges.
- Validator fails on source-grep rules without invariant shards.
- Validator fails on topology entries that lack runnable checks or negative
  controls.

### Workstream 5 -- Artifact lifecycle lattice

Scope: every path class has a lifecycle and commit policy.

Deliver:

- `tools/HME/config/artifact-lifecycle.json`
- invariant/pre-commit check for unknown or misplaced tracked paths

Lifecycle classes:

- source
- generated
- runtime
- metric
- proof
- transcript
- ephemeral
- fixture
- migration-baseline
- retired

Acceptance:

- Newly tracked paths must match a lifecycle rule.
- Runtime artifacts cannot be committed without an explicit allowlist.
- Proof and metric artifacts must declare schema and freshness or TTL policy.
- Retired artifacts cannot still be referenced outside explicit regression fixtures.

### Workstream 6 -- Runtime freshness and context thermodynamics

Scope: runtime and context evidence must be fresh, bounded, and not censor current
failures.

Deliver:

- runtime freshness helper
- first-pass context entropy checks

Measure and bound:

- duplicate boilerplate
- stale task-output paths
- repeated hook banners
- oversized historical logs
- stale runtime errors reused as current proof

Acceptance:

- Runtime health proof cites timestamp and freshness window.
- Stale errors are labeled historical.
- Current failures remain visible until fixed.
- Task-output polling remains blocked by regression tests.
- Context redaction is lifecycle-aware and cannot hide current failing evidence.

### Workstream 7 -- Failure alchemy workflow

Scope: encode the repair discipline so green tests cannot be produced through broad,
blind damage.

Required repair order:

1. diagnose exact failure
2. make the smallest patch
3. run syntax check
4. run targeted test
5. add regression test or invariant, or delete the dead mechanism
6. run broad suite
7. emit compact proof trace

Acceptance:

- A workflow test or invariant rejects broad multi-file transformations while syntax
  or targeted tests are red.
- Every resolved failure cites one of: fix, test, invariant, deletion.
- Final answers cite exact proof artifacts and commands, not vibes.

## Immediate commits after approval

1. Add coherence proof schema, validator, and sample trace fixture.
2. Add dead-mechanism reaper invariant for consult/read-chain paths.
3. Extend shortcut/route metadata and tests for `rr`, `cc`, task-notification
   read-chain, and retired `readq`.
4. Seed invariant topology from existing invariant shards and source-grep bijection.
5. Add artifact lifecycle lattice and tracked-path lifecycle check.
6. Add runtime freshness helper and first context-entropy tests.
7. Add failure-alchemy workflow guard and produce a final compact proof trace.

## Global acceptance criteria for Phase Omega

- `run-invariant-battery` passes 173/173.
- Full JS and Python spec suites pass.
- No forbidden read-chain/control-plane grep hits remain.
- Live task-notification read-chain proof emits `hme_read_chain__...` Read tool_use
  IDs and consumes the queue without typing into user input.
- Runtime-health proof includes freshness windows.
- Every new mechanism has at least one negative control.
- Every retired mechanism disappears from code, config, tests, and docs except
  explicit regression fixtures.
- No dashboards, giant narrative traces, duplicate ledgers, broad rewrite campaigns,
  aesthetic-only verifiers, or agent fan-out for local checks.
