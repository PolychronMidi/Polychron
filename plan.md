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

### P1 -- Stale-proof completion claims read as debt  [done]  (rank 1)
- intent: a "fixed/done" claim counts as proven only if a fresh (non-decayed) proof capsule names a file edited this turn, OR a same-turn Bash verify ran; otherwise it is proof-debt.
- seam: `proxy/stop_chain/policies/claim_proof.js` (record same-turn file_paths in _emitCapsule; consult freshProofCapsules + artifact intersect), `proxy/coherence_organs.js` (add optional `artifacts:[]` to normalizeProofCapsule), `proxy/claim_proof_guard.js` (hasProof can accept capsule evidence).
- net coherence: closes the project's core loop -- decay already exists but nothing refuses stale/cross-turn proof; makes the organ load-bearing and kills proof-laundering.
- bounded cost: low; reuses the transcript tool_use loop already in claim_proof + the existing shadow ladder. Fail-open: empty/unparsable capsule store or unknown artifacts -> allow. Non-strict = instruct, strict = deny (TODO #14a settled). Same-artifact match when file_paths are known; gracefully weakens to "any fresh proved capsule this session" only when artifacts can't be parsed -- never manufactures a false debt.
- NOT this: no hard-deny in non-strict, no "proof economy" enforcer, no new transcript pass.

### P2 -- One-shot UserPromptSubmit p95 bench  [done]  (rank 2)
- intent: attribute the ~1100ms p95 to a concrete step by replaying the hook against a captured stdin fixture, instead of waiting days for production samples.
- seam: new `scripts/bench-ups.sh` (~15 lines): feed a fixture payload to userpromptsubmit.sh x20 with HME_UPS_TIMING=1, then call the existing ups_timing.py. No hook change.
- net coherence: converts TODO #14b from "waiting" to "attributed"; measures the cold node/python sub-invocation floors (watchdog, liveness_gate, crying_wolf) instead of guessing.
- bounded cost: tiny. Caveat to record in output: cold-start isolation bounds the per-step FLOOR, not the production tail; the load-driven part of the p95 still needs real samples.
- NOT this: do not refactor/parallelize/strip hook steps before the bench says which step dominates -- measure first.

### P3 -- Causal braid auto-populated by resolvers  [done]  (rank 3)
- intent: incident resolvers that PROVE a fix already know the invariant / runtime-state / recurrence-guard; have them fill those braid fields so resolved incidents braid complete, not missing=[...].
- seam: `proxy/incident_resolvers.js` (verdict -> map to invariant/runtimeState/regressionTest; slots already exist on normalizeIncident), consumed by `scripts/why-coherence.js` mode=causal-braid.
- net coherence: makes `i/why mode=causal-braid` truthful for the classes resolvers cover (upstream-context-window, stale-runtime, autocommit) instead of mostly-empty chains.
- bounded cost: low-medium; covers only resolver-known classes -- hand-recorded incidents stay partial, which is real and acceptable.
- NOT this: do not force every incident to hand-author all 8 links; derive what the resolver knows, leave the rest truthfully missing.

### P4 -- Widen coherence-field vector to more ledgers  [declined by conferral]
- Agent2 + Agent1 agree: adding the vector to more producers with no consumer is decoration -> bloat. Only worth doing with a concrete telemetry-only (NOT model-visible) consumer. Skip until such a consumer exists. Flagged, not padded.

### P5 -- Close the P1 proof-laundering hole Agent2's post-impl review caught  [done]  (correctness fix to shipped P1)
- IMPLEMENTED: proof = a same-turn verify; a prior-turn capsule never substitutes for verifying this-turn edits (H1+H2 both resolved by removing the capsuleBacks allow-path entirely, which was the launder seam). The capsule store still records artifacts + decays. Removed the now-unused capsuleBacksArtifacts (no dead weight). H3 moot (no capsule-backed synthetic event remains). claim_proof_guard.js untouched. Regression test pins: same-turn verify -> allow; prior capsule + this-turn re-edit + no verify -> NOT allow. coherence_substrate 23/23, claim_proof+stop_chain 20/20.
- bug (real): P1 as shipped lets a prior-turn capsule back a THIS-TURN re-edit. Flow: turn1 edits+verifies fileX (mints proved capsule, artifacts=[X]); turn2 re-edits X, runs no verify, claims "done" -> the fresh prior capsule intersects editedFiles -> capsuleBacks=true -> the unverified re-edit passes. That is exactly the proof-laundering P1's NOT-guard forbids (strict-mode escape).
- fix (Agent2 H1+H2+H3, one file `proxy/stop_chain/policies/claim_proof.js`): (H1) a capsule backs a file only if its proof is NEWER than that file's edit -- since prior-turn capsules always predate this-turn edits, edited-turn files require a same-turn verify; capsule-backing's only safe job is a no-edit restatement of proved+unchanged work. (H2) edits-present + unparsable file_paths -> require verify (drop the any-fresh-capsule fallback; apply_patch/MultiEdit are common here, so the fallback is a frequent launder path, not a rare corner). (H3) tag the synthetic proof event proof_class='derived' (not 'executed') when backing is a capsule, so i/why mode=debt signal/noise stays honest.
- net coherence: makes P1 actually honor its own anti-laundering guard; without it P1 shipped "green but launderable in strict mode."
- bounded cost: one file, shadow-safe, fail-open preserved; update the two P1 tests to assert a this-turn re-edit is NOT capsule-backed.
- NOT this: no NLP on claim text to back no-edit restatements (Agent2: editsThisTurn=0 -> instruct is an acceptable cheap false-debt, not worth NLP); no guard.js coupling (boundary stays: guard = pure claim-vs-evidence, policy owns capsule->event + decay/IO).

## Decision
P1 > P2 > P3 implemented + verified (coherence_substrate 24/24, claim_proof+stop_chain 20/20, ownership 41/41, bench-ups smoke OK). P4 declined. POST-IMPL CONFERRAL (Agent2): P2 bench job DONE (cold floor ~140ms proves the ~1100ms p95 is load/contention, not per-step code -> defer to live samples, no further bench work); P3 clean, no notes; P1 has a real laundering hole -> P5 proposed as the bounded fix. Awaiting human approve/deny on P5.
