# HME self-coherence TODO

## Phase: typed coherence substrate

- [x] Coherence event ledger: every policy/tool/test/claim/failure can emit a compact event with kind, subject, intent, evidence, coherence delta, entropy delta, obligations, and expiry.
- [x] Proof-carrying context: classify claims as observed, executed, derived, hypothesis, policy, or stale; block/soften unsupported completion claims.
- [x] Context metabolism: raw trace -> extracted facts -> verified facts -> durable invariants -> compact doctrine -> obsolete facts composted.
- [x] Coherence budgets: track token, latency, false-positive, false-negative, user-attention, hook-noise, test-runtime, branch, and stale-state costs.
- [x] Invariant mesh: graph services, state files, middleware, routes, decisions, tests, incidents, and resolvers.
- [x] Failure ontology: typed incidents with status, root cause, fixed_by, regression_test, resolver, and proof; suppress LIFESAVER ghosts only after proof.
- [x] Agent immune system: detect readless edits, unsupported done claims, workaround ceremony, context stuffing, and hypothesis-free debugging.
- [x] Self-healing policies: measure whether each deny/rewrite/instruct prevented a real failure or created noise; narrow or retire weak policies.
- [x] Coherence-aware tests: every LIFESAVER class has a resolver, every mutating middleware has idempotency evidence, every state file has an owner.
- [x] Multi-scale review: subtoken/provenance, function contracts, module boundaries, middleware lifecycle, request path, runtime ecology, portability.

## Concrete implementation backlog

- [x] Add `coherence_events` state file + schema + append helper.
- [x] Add typed incident registry with resolver registry and `resolved` proof rows.
- [x] Add resolvers for upstream context-window escapes and stale-runtime/proxy-liveness ghosts.
- [x] Add `i/why mode=proof`, `i/why mode=debt`, and `i/why mode=mesh` query commands.
- [x] Add context metabolism module for facts, decay, contradiction pointers, and compacted doctrine candidates.
- [x] Add claim proof guard for completion/fixed/all-done language against same-turn evidence.
- [x] Add invariant mesh builder tying dispatcher routes, middleware manifest, state-files, service registry, tests, and incidents.
- [x] Add tests proving typed incidents, resolver suppression, event ledger appends, mesh queries, metabolism decay, and proof guard behavior.
