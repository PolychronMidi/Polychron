# Plan

Reviewed proposals for HME work. Agent1 (orchestrator) + Agent2 (peer, forked
session) confer in chat.md; durable, user-approvable proposals land here. Nothing
in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from Agent1/Agent2 conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## Proposals

### P1 -- Stale-proof completion claims read as debt  [proposed]  (rank 1)
- intent: a "fixed/done" claim counts as proven only if a fresh (non-decayed) proof capsule names a file edited this turn, OR a same-turn Bash verify ran; otherwise it is proof-debt.
- seam: `proxy/stop_chain/policies/claim_proof.js` (record same-turn file_paths in _emitCapsule; consult freshProofCapsules + artifact intersect), `proxy/coherence_organs.js` (add optional `artifacts:[]` to normalizeProofCapsule), `proxy/claim_proof_guard.js` (hasProof can accept capsule evidence).
- net coherence: closes the project's core loop -- decay already exists but nothing refuses stale/cross-turn proof; makes the organ load-bearing and kills proof-laundering.
- bounded cost: low; reuses the transcript tool_use loop already in claim_proof + the existing shadow ladder. Fail-open: empty/unparsable capsule store or unknown artifacts -> allow. Non-strict = instruct, strict = deny (TODO #14a settled). Same-artifact match when file_paths are known; gracefully weakens to "any fresh proved capsule this session" only when artifacts can't be parsed -- never manufactures a false debt.
- NOT this: no hard-deny in non-strict, no "proof economy" enforcer, no new transcript pass.

### P2 -- One-shot UserPromptSubmit p95 bench  [proposed]  (rank 2)
- intent: attribute the ~1100ms p95 to a concrete step by replaying the hook against a captured stdin fixture, instead of waiting days for production samples.
- seam: new `scripts/bench-ups.sh` (~15 lines): feed a fixture payload to userpromptsubmit.sh x20 with HME_UPS_TIMING=1, then call the existing ups_timing.py. No hook change.
- net coherence: converts TODO #14b from "waiting" to "attributed"; measures the cold node/python sub-invocation floors (watchdog, liveness_gate, crying_wolf) instead of guessing.
- bounded cost: tiny. Caveat to record in output: cold-start isolation bounds the per-step FLOOR, not the production tail; the load-driven part of the p95 still needs real samples.
- NOT this: do not refactor/parallelize/strip hook steps before the bench says which step dominates -- measure first.

### P3 -- Causal braid auto-populated by resolvers  [proposed]  (rank 3)
- intent: incident resolvers that PROVE a fix already know the invariant / runtime-state / recurrence-guard; have them fill those braid fields so resolved incidents braid complete, not missing=[...].
- seam: `proxy/incident_resolvers.js` (verdict -> map to invariant/runtimeState/regressionTest; slots already exist on normalizeIncident), consumed by `scripts/why-coherence.js` mode=causal-braid.
- net coherence: makes `i/why mode=causal-braid` truthful for the classes resolvers cover (upstream-context-window, stale-runtime, autocommit) instead of mostly-empty chains.
- bounded cost: low-medium; covers only resolver-known classes -- hand-recorded incidents stay partial, which is real and acceptable.
- NOT this: do not force every incident to hand-author all 8 links; derive what the resolver knows, leave the rest truthfully missing.

### P4 -- Widen coherence-field vector to more ledgers  [declined by conferral]
- Agent2 + Agent1 agree: adding the vector to more producers with no consumer is decoration -> bloat. Only worth doing with a concrete telemetry-only (NOT model-visible) consumer. Skip until such a consumer exists. Flagged, not padded.

## Decision
Ranked P1 > P2 > P3 (P4 declined). If only one ships, ship P1. Awaiting human approve/deny per proposal.
