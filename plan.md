# Plan

Driver + peers confer here; durable, user-approvable proposals land here. Nothing in
this file is implemented until the user marks it approved.

## Status legend

- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

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

## Phase 15 (done) -- Project boundary map + hot/cold path minimalism

Evidence is tracked in `tools/HME/config/phase-evidence.json`; this anchor remains so
phase-evidence verification can bind plan claims to machine-readable artifacts.

## Phase 16 (done) -- Phase-inference firewall

Evidence is tracked in `tools/HME/config/phase-evidence.json`; this anchor remains so
phase-evidence verification can bind plan claims to machine-readable artifacts.

## Phase Omega (done) -- Causal Self-Coherence Field

Consult source: `teams/runtime/output/omega-causal-self-coherence-1781113894/`.
Implementation trace: `teams/runtime/output/phase-omega-implementation/_coherence-trace.json`.
The shipped subset turns self-coherence from a list of alarms into causal,
machine-checkable routes: every proof claim must identify artifacts, causal paths,
verifier IDs, forbidden paths checked, and open risks.

### Shipped subset

1. **Causal proof schema and compact trace (done).**
   - Artifacts: `tools/HME/config/coherence-proof.schema.json`,
     `tools/HME/scripts/invariants/check_coherence_proof.py`,
     `tools/HME/tests/fixtures/coherence-trace.sample.json`,
     `teams/runtime/output/phase-omega-implementation/_coherence-trace.json`.
   - Proof: schema/sample validation, negative control for missing
     `causal_path_ids`, and hash-backed trace validation with
     `check_coherence_proof.py --verify-hashes`.

2. **Dead mechanism reaper (done).**
   - Artifacts: `tools/HME/config/invariants/proxy.json`,
     `tools/HME/scripts/invariants/check_source_grep_invariant.py`,
     `teams/rounds/consult_from_context.py`,
     `tools/HME/proxy/read_chain_driver.js`,
     `tools/HME/proxy/hme_proxy_request_mutation.js`,
     `tools/HME/tests/specs/read_chain_e2e.test.js`,
     `tools/HME/tests/specs/consult_from_context.test.py`.
   - Retired paths: consult FIFO/readq typing, `submit_read_queue_to_pty`,
     `readq!`, local-session `[HME_READ_CHAIN] $prompt`, stale PTY/provenance
     prompt proof, side-session `claude -p` proof driver, and synthetic
     `hme_consult_auto_read_*` request mutation.
   - Accepted route: host task-notification -> proxy `read_chain_driver` ->
     native `Read` tool_use with `hme_read_chain__...` ID. The current proof
     collector accepts only that causal ID shape for consult read proof.

3. **Typed shortcut and route causal paths (done).**
   - Artifacts: `tools/HME/config/causal-paths.json`,
     `tools/HME/scripts/invariants/check_causal_paths.py`,
     `tools/HME/config/shortcuts.json`.
   - Covered lanes: `rr` wire read-chain, `cc` local-session compact, and
     consult task-notification read-chain.
   - Negative controls reject restored `readq` shortcuts and local-session
     read-chain marker typing.

4. **Executable invariant topology with thresholded coverage (done).**
   - Artifacts: `tools/HME/config/invariant-topology.json`,
     `tools/HME/scripts/invariants/check_invariant_topology.py`,
     `tools/HME/scripts/invariants/check_source_grep_bijection.py`.
   - Topology now covers source-grep bijection, env failfast, retired
     consult/read-chain routes, causal paths, proof schema, artifact lifecycle,
     runtime freshness, failure alchemy, and the topology validator itself.
   - Coverage metadata requires at least nine nodes and explicitly requires
     source-grep bijection, env failfast, artifact lifecycle, runtime freshness,
     and failure alchemy nodes.
   - Negative control: removing a required topology node reports both missing
     required coverage and below-threshold coverage.

5. **Artifact lifecycle lattice (done).**
   - Artifacts: `tools/HME/config/artifact-lifecycle.json`,
     `tools/HME/scripts/invariants/check_artifact_lifecycle.py`.
   - Classes include source, config, generated, vendored, runtime, metric, proof,
     transcript, ephemeral, fixture, migration-baseline, and retired.
   - The checker rejects unclassified tracked paths and unallowlisted tracked
     runtime paths; metric schema/freshness requirements are explicit.

6. **Runtime freshness and context thermodynamics seed (done).**
   - Artifacts: `tools/HME/config/runtime-freshness.json`,
     `tools/HME/scripts/invariants/check_runtime_freshness.py`.
   - The shipped config defines freshness windows, task-output polling guard
     metadata, duplicate hook-banner budgets, stale-log labeling, and bounded
     context-evidence rules.
   - Remaining refinement #25 will distinguish current blocking autocommit
     errors from historical alert text with timestamp windows.

7. **Failure alchemy workflow (done).**
   - Artifacts: `tools/HME/config/failure-alchemy.json`,
     `tools/HME/scripts/invariants/check_failure_alchemy.py`,
     `tools/HME/tests/specs/phase_omega_validators.test.py`.
   - The workflow encodes the accepted outcomes for failures: fix, regression
     test, invariant, or dead-mechanism deletion. Labels such as
     "preexisting/probably/noted/later" are forbidden.
   - Negative controls reject missing forbidden labels and missing Phase Omega
     causal proof fields.

### Verification snapshot

- `python3 tools/HME/scripts/pipeline/hme/run-invariant-battery.py`:
  `Invariant Battery: 180/180 passed`.
- Focused consult/read-chain proof cleanup:
  `python3 tools/HME/tests/specs/consult_from_context.test.py` passed 8 tests;
  `node --test tools/HME/tests/specs/read_chain_e2e.test.js` passed 5 tests.
- Stale live-path proof references outside explicit tests/runtime: no matches for
  nonce provenance, `claude-print`, PTY proof, proof-pending wording,
  `HME_CONSULT_NATIVE_READ_PROOF_DRIVER`, or synthetic consult auto-read
  injection.
- Python spec sweep previously recorded in TODO #17: `PY_FILES=50 PY_FAILS=0`.
- Phase Omega validator negative controls recorded in TODO #19: 4 tests OK.

### Remaining refinements

- `#18` remains blocked on host/client transcript behavior: queue consumption is
  observed, but recent Claude transcripts still contain zero actual
  `hme_read_chain__` tool_use/tool_result rows. Do not replace this with manual
  Reads, FIFO/readq, `/hme/spawn`, or task-output polling.
- `#24` expand invariant topology from seed nodes to thresholded coverage for
  env failfast, source-grep bijection, artifact lifecycle, runtime freshness, and
  failure alchemy.
- `#25` add autocommit-error freshness checks so historical hook alerts are not
  reused as current blocking evidence.
- `#26` audit and either restore or explicitly retire
  `TodoMergeHookConsistencyVerifier` without fake-green coverage loss.
- `#27` add a guard/workflow check for repeated forbidden `/hme/spawn` attempts
  after the first block.

### Global acceptance criteria for the shipped subset

- `run-invariant-battery` passes 180/180.
- Proof traces are compact, hash-backed, and schema-checked.
- No forbidden read-chain/control-plane live-path grep hits remain outside
  explicit fixtures/tests/runtime evidence.
- Task-notification consult read-chain emits `hme_read_chain__...` Read tool_use
  IDs and consumes the queue without typing control tokens into user input.
- Runtime-health proof metadata includes freshness windows.
- Every new validator has at least one negative control or a tracked follow-up.
- Retired mechanisms are deleted or blocked outside explicit regression fixtures.
- No dashboards, giant narrative traces, duplicate ledgers, broad rewrite
  campaigns, aesthetic-only verifiers, or agent fan-out for local checks.
